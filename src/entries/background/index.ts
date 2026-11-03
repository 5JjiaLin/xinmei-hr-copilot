import { Repository } from '../../storage/repository';
import { TaskRunner } from '../../orchestrator/task-runner';
import { MockBossAdapter, MockGreetingAdapter, MockReplyAdapter } from '../../adapters/mock/adapters';
import type { FixtureBridge } from '../../adapters/contracts';

// 仅扩展自有页面之间通信；没有 Content Script、远程页面或真实账号入口。
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
const ready = runner.recover();
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

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void chrome.storage.local.set({ mode: 'MOCK', externalAccess: false });
});
chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  const message = raw as { type?: string; jd?: unknown; candidateId?: unknown };
  void (async () => {
    await ready;
    switch (message.type) {
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
        await exclusive(() => runner.start(message.jd as string)); void pump(); return;
      case 'PAUSE': await exclusive(() => runner.control('pause')); return;
      case 'STOP': await exclusive(() => runner.control('stop')); return;
      case 'RESUME': await exclusive(() => runner.control('resume')); void pump(); return;
      case 'RECONCILE': await exclusive(() => runner.reconcile()); return;
      case 'SCAN_REPLIES': await exclusive(() => runner.scanReplies()); return;
      case 'HANDOFF':
        if (typeof message.candidateId !== 'string') throw new Error('CANDIDATE_MISMATCH');
        await exclusive(() => runner.handoff(message.candidateId as string)); return;
      case 'CLEAR': {
        const run = await repo.latest();
        if (run && !['STOPPED', 'COMPLETED'].includes(run.status)) throw new Error('STOP_BEFORE_CLEAR');
        await exclusive(() => repo.clear()); return;
      }
      default: throw new Error('COMMAND_INVALID');
    }
  })().then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false,
    error: error instanceof Error ? error.message : 'COMMAND_FAILED' }));
  return true;
});
