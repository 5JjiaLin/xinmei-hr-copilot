import { Repository } from '../../storage/repository';
import { TaskRunner } from '../../orchestrator/task-runner';
import { MockBossAdapter, MockGreetingAdapter, MockReplyAdapter } from '../../adapters/mock/adapters';
import type { FixtureBridge } from '../../adapters/contracts';
import { BossBrowserBridge, BossLocalStore } from '../../adapters/boss/browser-bridge';
import { BossOperations } from '../../orchestrator/boss-operations';
import type { BossMode } from '../../adapters/boss/protocol';

// 保留原合成演示；真实页面通过独立的带文档身份的桥接器操作。
class LocalFixtureBridge implements FixtureBridge {
  private channel = new BroadcastChannel('hr-local-fixture-v1');
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor() {
    this.channel.onmessage = event => {
      const message = event.data as { kind: string; id: string; data: unknown; error?: string };
      if (message.kind !== 'response') return;
      const item = this.pending.get(message.id); if (!item) return;
      clearTimeout(item.timer); this.pending.delete(message.id);
      message.error ? item.reject(new Error(message.error)) : item.resolve(message.data);
    };
  }
  request<T>(action: string, payload?: unknown): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('FIXTURE_TIMEOUT')); }, 2500);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.channel.postMessage({ kind: 'request', id, action, payload });
    });
  }
}
const repo = new Repository();
const bridge = new LocalFixtureBridge();
const runner = new TaskRunner(repo, new MockBossAdapter(bridge), new MockGreetingAdapter(bridge), new MockReplyAdapter(bridge));
const bossBridge = new BossBrowserBridge();
const boss = new BossOperations(new BossLocalStore(), bossBridge);
const ready = Promise.all([runner.recover(), boss.recover()]);
let pumping = false;
let tail: Promise<unknown> = ready;
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.catch(() => {});
  return result;
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while ((await repo.latest())?.status === 'RUNNING') {
      await exclusive(() => runner.step());
      // 仅让出消息事件队列，非页面条件等待。
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { pumping = false; }
}
let bossPumping = false;
async function pumpBoss() {
  if (bossPumping) return;
  bossPumping = true;
  try {
    while (boss.snapshot().run?.status === 'RUNNING') {
      await exclusive(() => boss.step());
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { bossPumping = false; }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void chrome.storage.local.set({ mode: 'MOCK', externalAccess: false });
});
chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  const message = raw as { type?: string; jd?: unknown; candidateId?: unknown; mode?: unknown; limit?: unknown };
  void (async () => {
    await ready;
    if (message.type === 'BOSS_PAUSE' || message.type === 'BOSS_STOP') {
      await boss.interrupt();
      await exclusive(() => boss.control(message.type === 'BOSS_STOP' ? 'stop' : 'pause')); return;
    }
    switch (message.type) {
      case 'BOSS_STATUS': return boss.snapshot().run;
      case 'BOSS_CONNECT': return bossBridge.connect();
      case 'BOSS_START': {
        if (typeof message.mode !== 'string' || !['BROWSE', 'GREET_ALL'].includes(message.mode) || typeof message.limit !== 'number') throw new Error('BATCH_INVALID');
        await exclusive(async () => {
          if ((await repo.latest())?.status === 'RUNNING') throw new Error('ACTIVE_RUN_EXISTS');
          const connection = await bossBridge.connect();
          if (!connection.target || !connection.probe.supported || !connection.probe.identity) throw new Error(connection.probe.reason);
          await boss.start(connection.target, connection.probe.identity, message.mode as BossMode, message.limit as number);
        });
        void pumpBoss(); return;
      }
      case 'BOSS_RESUME': await exclusive(() => boss.control('resume')); void pumpBoss(); return;
      case 'BOSS_CLEAR': await exclusive(() => boss.clear()); return;
      case 'STATUS': return { run: await repo.latest(), operations: await repo.operations() };
      case 'OPEN_FIXTURE': {
        const url = chrome.runtime.getURL('mock.html');
        const tabs = await chrome.tabs.query({});
        const found = tabs.find(tab => tab.url === url);
        if (found?.id !== undefined) await chrome.tabs.update(found.id, { active: true });
        else await chrome.tabs.create({ url });
        return;
      }
      case 'START':
        if (typeof message.jd !== 'string') throw new Error('JD_INVALID');
        await exclusive(async () => {
          if (boss.snapshot().run?.status === 'RUNNING') throw new Error('ACTIVE_RUN_EXISTS');
          await runner.start(message.jd as string);
        }); void pump(); return;
      case 'PAUSE': await exclusive(() => runner.control('pause')); return;
      case 'STOP': await exclusive(() => runner.control('stop')); return;
      case 'RESUME': await exclusive(() => runner.control('resume')); void pump(); return;
      case 'RECONCILE': await exclusive(() => runner.reconcile()); return;
      case 'SCAN_REPLIES': await exclusive(() => runner.scanReplies()); return;
      case 'HANDOFF':
        if (typeof message.candidateId !== 'string') throw new Error('CANDIDATE_MISMATCH');
        await exclusive(() => runner.handoff(message.candidateId as string)); return;
      case 'CLEAR': {
        await exclusive(async () => {
          const run = await repo.latest();
          if (run && !['STOPPED', 'COMPLETED'].includes(run.status)) throw new Error('STOP_BEFORE_CLEAR');
          await repo.clear();
        }); return;
      }
      default: throw new Error('COMMAND_INVALID');
    }
  })().then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false,
    error: error instanceof Error ? error.message : 'COMMAND_FAILED' }));
  return true;
});
