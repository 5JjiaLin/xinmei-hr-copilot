import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BossOperations } from '../../src/orchestrator/boss-operations';
import type { BossCommand, BossPort, BossState, BossStore, BossTarget } from '../../src/adapters/boss/protocol';
const target = { tabId: 1, frameId: 2, documentId: 'doc-1' };
const identity = { account: 'synthetic-account', job: 'synthetic-job' };
class World implements BossStore, BossPort {
  state: BossState = { ledger: {} }; calls: BossCommand[] = []; sent = 0;
  result = 'CONFIRMED'; empty = false; partial = false;
  async load() { return structuredClone(this.state); }
  async save(state: BossState) { this.state = structuredClone(state); }
  async call<T>(_target: typeof target, command: BossCommand): Promise<T> {
    this.calls.push(command);
    let result: unknown;
    if (command.action === 'next') result = this.empty ? { scrolled: true } : { candidate: `candidate-${command.seen!.length + 1}`, scrolled: command.seen!.length > 0 };
    if (command.action === 'read') result = { reachedBottom: !this.partial, characters: 100 };
    if (command.action === 'greet') { assert.ok(Object.values(this.state.ledger).includes('SENDING')); this.sent++; result = { status: this.result }; }
    return result as T;
  }
}
async function finish(runner: BossOperations) {
  for (let i = 0; i < 100 && runner.snapshot().run?.status === 'RUNNING'; i++) await runner.step();
}
test('动作闭环滚动发现后续批次，读完关闭返回，不等待回复', async () => {
  const world = new World(); const runner = new BossOperations(world, world);
  await runner.start(target, identity, 'GREET_ALL', 3); await finish(runner);
  const run = runner.snapshot().run!;
  assert.equal(run.status, 'COMPLETED'); assert.equal(run.read, 3); assert.equal(run.sent, 3);
  assert.equal(run.listScrolls, 2);
  assert.deepEqual(world.calls.filter(c => !['begin', 'cancel'].includes(c.action)).map(c => c.action),
    Array.from({ length: 3 }, () => ['next', 'open', 'read', 'greet', 'close']).flat());
  assert.equal(JSON.stringify(world.state).includes('resumeText'), false);
});
test('只浏览模式不调用发送；详细规则未配置也不使用假模型', async () => {
  const world = new World(); const runner = new BossOperations(world, world);
  await runner.start(target, identity, 'BROWSE', 2); await finish(runner);
  assert.equal(world.sent, 0); assert.equal(runner.snapshot().run!.seen.length, 2);
});
test('未知发送暂停，拒绝继续；新任务仍按账号和候选人去重', async () => {
  const world = new World(); world.result = 'UNKNOWN'; const runner = new BossOperations(world, world);
  await runner.start(target, identity, 'GREET_ALL', 1); await finish(runner);
  assert.equal(runner.snapshot().run!.reason, 'SEND_UNKNOWN');
  await assert.rejects(runner.control('resume'), /SEND_UNKNOWN/);
  await runner.control('stop'); world.result = 'CONFIRMED';
  await runner.start(target, { ...identity, job: 'second-job' }, 'GREET_ALL', 1); await finish(runner);
  assert.equal(world.sent, 1); assert.equal(runner.snapshot().run!.skipped, 1);
});
test('没有新卡片不误报列表结束，有限重试后暂停', async () => {
  const world = new World(); world.empty = true; const runner = new BossOperations(world, world);
  await runner.start(target, identity, 'BROWSE', 3); await finish(runner);
  assert.equal(runner.snapshot().run!.reason, 'LIST_STALLED'); assert.equal(world.calls.filter(c => c.action === 'next').length, 3);
});
test('简历没读到底不得发送', async () => {
  const world = new World(); world.partial = true; const runner = new BossOperations(world, world);
  await runner.start(target, identity, 'GREET_ALL', 1); await finish(runner);
  assert.equal(world.sent, 0); assert.equal(runner.snapshot().run!.reason, 'RESUME_INCOMPLETE');
});
test('正在读取时停止，迟到返回不能触发打招呼', async () => {
  const world = new World(); const original = world.call.bind(world);
  let release: (() => void) | undefined;
  world.call = async <T>(target: BossTarget, command: BossCommand): Promise<T> => {
    if (command.action === 'read') await new Promise<void>(resolve => { release = resolve; });
    return original<T>(target, command);
  };
  const runner = new BossOperations(world, world); await runner.start(target, identity, 'GREET_ALL', 1);
  await runner.step(); await runner.step(); const pending = runner.step();
  await runner.interrupt(); release!(); await pending; await runner.control('stop');
  await runner.step(); assert.equal(world.sent, 0); assert.equal(runner.snapshot().run!.status, 'STOPPED');
});
test('发送中后台重启保留 UNKNOWN，取消旧会话，不自动重发', async () => {
  const world = new World(); const runner = new BossOperations(world, world);
  await runner.start(target, identity, 'GREET_ALL', 1);
  const state = runner.snapshot(); state.run!.phase = 'SENDING'; state.run!.current = 'candidate-1';
  await world.save(state);
  const recovered = new BossOperations(world, world); await recovered.recover();
  assert.equal(recovered.snapshot().run!.status, 'PAUSED');
  assert.ok(Object.values(recovered.snapshot().ledger).includes('UNKNOWN'));
  assert.equal(world.calls.at(-1)!.action, 'cancel'); await assert.rejects(recovered.control('resume'), /SEND_UNKNOWN/);
});
