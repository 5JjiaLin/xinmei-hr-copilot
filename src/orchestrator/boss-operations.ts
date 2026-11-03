import { hashText } from '../shared/types';
import type { BossCommand, BossIdentity, BossLedger, BossMode, BossPort, BossRun, BossState, BossStore, BossTarget } from '../adapters/boss/protocol';

// 此阶段只编排页面操作，不使用 Mock 筛选结果决定真实招呼。
export class BossOperations {
  private state: BossState = { ledger: {} };
  private generation = 0;
  constructor(private store: BossStore, private port: BossPort) {}
  async recover() {
    this.state = await this.store.load();
    const run = this.state.run;
    if (!run || run.status !== 'RUNNING') return;
    await this.interrupt();
    if (run.phase === 'SENDING' && run.current) this.state.ledger[await this.key(run, run.current)] = 'UNKNOWN';
    run.status = 'PAUSED'; this.event('WORKER_RESTARTED'); await this.save();
  }
  snapshot(): BossState { return structuredClone(this.state); }
  private event(reason: string) {
    const run = this.state.run!; run.reason = reason;
    run.events.push({ at: new Date().toISOString(), reason }); run.events = run.events.slice(-100);
  }
  private save() { return this.store.save(structuredClone(this.state)); }
  private key(run: BossRun, candidate: string) { return hashText(JSON.stringify([run.identity.account, candidate])); }
  private command(action: BossCommand['action'], run: BossRun): BossCommand {
    return { channel: 'hr-boss-v1', action, session: run.session, deadline: Date.now() + 25_000,
      identity: run.identity, ...(run.current ? { candidate: run.current } : {}), seen: run.seen };
  }
  private call<T>(action: BossCommand['action'], run: BossRun) { return this.port.call<T>(run.target, this.command(action, run)); }
  // 不进入业务队列：正在等待 DOM 的操作会立即收到取消。
  async interrupt() {
    this.generation++;
    const run = this.state.run;
    if (run) await this.call('cancel', run).catch(() => {});
  }
  async start(target: BossTarget, identity: BossIdentity, mode: BossMode, limit: number) {
    if (this.state.run && !['STOPPED', 'COMPLETED'].includes(this.state.run.status)) throw new Error('ACTIVE_RUN_EXISTS');
    if (!['BROWSE', 'GREET_ALL'].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('BATCH_INVALID');
    const generation = this.generation;
    const run: BossRun = { id: crypto.randomUUID(), target, identity, mode, limit, session: crypto.randomUUID(),
      status: 'RUNNING', phase: 'NEXT', reason: 'STARTED', seen: [], read: 0, sent: 0, skipped: 0, listScrolls: 0, events: [] };
    // 先记录会话，启动过程中收到停止也能准确取消它。
    this.state.run = run; await this.save();
    try {
      if (generation !== this.generation) throw new Error('CANCELLED');
      await this.call('begin', run);
      if (generation !== this.generation) { await this.call('cancel', run); throw new Error('CANCELLED'); }
      this.event(mode === 'BROWSE' ? 'BROWSE_STARTED' : 'GREET_ALL_STARTED'); await this.save();
    } catch (error) {
      run.status = 'PAUSED'; this.event('START_FAILED'); await this.save(); throw error;
    }
  }
  async control(action: 'pause' | 'stop' | 'resume') {
    const run = this.state.run; if (!run || ['STOPPED', 'COMPLETED'].includes(run.status)) return;
    if (action === 'resume') {
      if (run.status !== 'PAUSED') throw new Error('RUN_NOT_PAUSED');
      if (run.phase === 'SENDING') throw new Error('SEND_UNKNOWN');
      run.session = crypto.randomUUID();
      const generation = this.generation;
      await this.call('begin', run);
      if (generation !== this.generation) { await this.call('cancel', run); throw new Error('CANCELLED'); }
      run.status = 'RUNNING';
    } else run.status = action === 'stop' ? 'STOPPED' : 'PAUSED';
    this.event(action.toUpperCase()); await this.save();
  }
  async step() {
    const run = this.state.run; if (!run || run.status !== 'RUNNING') return;
    const generation = this.generation;
    const check = () => { if (generation !== this.generation) throw new Error('CANCELLED'); };
    try {
      switch (run.phase) {
        case 'NEXT': {
          if (run.seen.length >= run.limit) { run.status = 'COMPLETED'; this.event('BATCH_FINISHED'); await this.call('cancel', run); break; }
          const result = await this.call<{ candidate?: string; scrolled: boolean; end?: boolean }>('next', run); check();
          if (result.scrolled) run.listScrolls++;
          if (result.candidate) { run.current = result.candidate; run.phase = 'OPEN'; this.event('CANDIDATE_FOUND'); }
          else if (result.end) { run.status = 'COMPLETED'; this.event('LIST_FINISHED'); await this.call('cancel', run); }
          else {
            // 没有新卡片不能推断全部结束；有界停止并说明原因，允许人工检查后继续。
            const trailing = run.events.slice(-3).filter(e => e.reason === 'LIST_NO_PROGRESS').length;
            if (trailing >= 2 || run.listScrolls >= 30) throw new Error('LIST_STALLED');
            this.event('LIST_NO_PROGRESS');
          }
          break;
        }
        case 'OPEN':
          await this.call('open', run); check(); run.phase = 'READ'; this.event('RESUME_OPENED'); break;
        case 'READ': {
          const result = await this.call<{ reachedBottom: boolean; characters: number }>('read', run); check();
          if (!result.reachedBottom || result.characters < 1) throw new Error('RESUME_INCOMPLETE');
          run.read++; run.phase = run.mode === 'GREET_ALL' ? 'GREET' : 'CLOSE'; this.event('RESUME_READ'); break;
        }
        case 'GREET': {
          const key = await this.key(run, run.current!); check();
          if (this.state.ledger[key]) { run.skipped++; run.phase = 'CLOSE'; this.event('LEDGER_SKIPPED'); break; }
          this.state.ledger[key] = 'SENDING'; run.phase = 'SENDING'; this.event('SENDING');
          await this.save(); check(); // 页面点击之前持久化；崩溃后绝不自动重发。
          const result = await this.call<{ status: 'CONFIRMED' | 'UNKNOWN' | 'ALREADY_CONTACTED' }>('greet', run);
          if (result.status === 'CONFIRMED' || result.status === 'ALREADY_CONTACTED') {
            this.state.ledger[key] = 'CONFIRMED';
            if (result.status === 'CONFIRMED') run.sent++; else run.skipped++;
            run.phase = 'CLOSE'; this.event(result.status); check();
          } else { this.state.ledger[key] = 'UNKNOWN'; throw new Error('SEND_UNKNOWN'); }
          break;
        }
        case 'CLOSE':
          await this.call('close', run); check(); run.seen.push(run.current!); delete run.current;
          run.phase = 'NEXT'; this.event('RETURNED_TO_LIST'); break;
        case 'SENDING': throw new Error('SEND_UNKNOWN');
      }
    } catch (error) {
      if (run.phase === 'SENDING' && run.current) this.state.ledger[await this.key(run, run.current)] = 'UNKNOWN';
      run.status = 'PAUSED';
      const reason = error instanceof Error && /^[A-Z_]{3,50}$/.test(error.message) ? error.message : 'PAGE_DISCONNECTED';
      this.event(reason); await this.call('cancel', run).catch(() => {});
    }
    await this.save();
  }
  async clear() {
    if (this.state.run && !['COMPLETED', 'STOPPED'].includes(this.state.run.status)) throw new Error('STOP_BEFORE_CLEAR');
    // 删除任务可保留防重复账本；清空账本仅在扩展数据管理里另行处理。
    delete this.state.run; await this.save();
  }
}
