import type { RecruitmentPageAdapter, GreetingAdapter, ReplyAdapter, SendContext } from '../adapters/contracts';
import { MockScreeningEngine } from '../ai/mock-engine';
import { Repository } from '../storage/repository';
import { assertCandidate, assertIdentity } from './guards';
import { hashText, operationKey, type Run, type Operation, type CandidateTask } from '../shared/types';

export class TaskRunner {
  constructor(
    private repo: Repository, private page: RecruitmentPageAdapter,
    private greeting: GreetingAdapter, private reply: ReplyAdapter,
    private ai = new MockScreeningEngine()
  ) {}

  async start(jd: string): Promise<Run> {
    const old = await this.repo.latest();
    if (old && !['STOPPED', 'COMPLETED'].includes(old.status)) throw new Error('ACTIVE_RUN_EXISTS');
    const observation = await this.page.observe();
    assertIdentity(observation.job, observation);
    const profile = this.ai.profile(jd);
    const job = { ...observation.job, jdText: jd, jdHash: await hashText(jd),
      criteriaVersion: profile.version, capturedAt: new Date().toISOString() };
    const cards = await this.page.listCandidates(job);
    assertIdentity(job, await this.page.observe());
    const unique = new Map<string, CandidateTask>();
    for (const card of cards) {
      assertCandidate(job, card);
      const existing = unique.get(card.candidateId);
      if (existing && existing.snapshot.cardText !== card.cardText) throw new Error('DUPLICATE_ID_CONFLICT');
      unique.set(card.candidateId, { snapshot: card, phase: 'DISCOVERED' });
    }
    const run: Run = {
      id: 'active', taskId: crypto.randomUUID(), revision: old ? old.revision + 1 : 0,
      mode: 'MOCK', status: 'RUNNING', reasonCode: 'STARTED', job, profile,
      modelVersion: 'mock-literal-v1', candidates: [...unique.values()], events: []
    };
    this.log(run, 'STARTED');
    if (!await this.repo.save(run, old?.revision ?? null)) throw new Error('STALE_REVISION');
    return run;
  }

  async control(command: 'pause' | 'resume' | 'stop'): Promise<void> {
    const run = await this.required();
    if (['STOPPED', 'COMPLETED'].includes(run.status)) return;
    if (command === 'resume') {
      if (run.status !== 'PAUSED') throw new Error('RUN_NOT_PAUSED');
      if (run.candidates.some(c => ['SENDING', 'UNKNOWN'].includes(c.phase))) throw new Error('RECONCILIATION_REQUIRED');
      assertIdentity(run.job, await this.page.observe());
      run.status = 'RUNNING';
    } else run.status = command === 'stop' ? 'STOPPED' : 'PAUSED';
    await this.commit(run, command.toUpperCase());
  }

  // Worker 启动不盲目续发：发送中变 UNKNOWN，其余中间态暂停，显式恢复后继续。
  async recover(): Promise<void> {
    const run = await this.repo.latest();
    if (!run || ['STOPPED', 'COMPLETED'].includes(run.status)) return;
    for (const candidate of run.candidates) {
      if (candidate.phase === 'SENDING') {
        const op = await this.repo.operation(run.job.accountScope, candidate.snapshot.candidateId);
        candidate.phase = 'UNKNOWN'; run.status = 'PAUSED';
        if (op) await this.commit(run, 'SEND_INTERRUPTED', candidate, { ...op, state: 'UNKNOWN', revision: op.revision + 1 });
      }
    }
    if (run.status === 'RUNNING') { run.status = 'PAUSED'; await this.commit(run, 'WORKER_RESTARTED'); }
  }

  async step(): Promise<void> {
    const run = await this.repo.latest();
    if (!run || run.status !== 'RUNNING') return;
    const started = performance.now();
    const candidate = run.candidates.find(c => ['DISCOVERED', 'QUICK_PASS', 'RESUME_EXTRACTED', 'DEEP_PASS', 'PREPARED'].includes(c.phase));
    try {
      assertIdentity(run.job, await this.page.observe());
      if (!candidate) {
        run.status = run.candidates.some(c => ['WAITING_REPLY', 'REPLIED', 'HR_HANDOFF'].includes(c.phase)) ? 'WAITING_REPLIES' : 'COMPLETED';
        await this.commit(run, 'QUEUE_FINISHED'); return;
      }
      const snapshot = candidate.snapshot;
      assertCandidate(run.job, snapshot);
      switch (candidate.phase) {
        case 'DISCOVERED': {
          candidate.quick = this.ai.screen(snapshot, run.profile, false);
          candidate.phase = candidate.quick.decision === 'PASS' ? 'QUICK_PASS' : candidate.quick.decision === 'REJECT' ? 'REJECTED' : 'UNCERTAIN';
          break;
        }
        case 'QUICK_PASS': {
          const resume = await this.page.openResume(run.job, snapshot.candidateId);
          assertIdentity(run.job, await this.page.observe());
          assertCandidate(run.job, resume, snapshot.candidateId);
          candidate.snapshot = { ...resume, resumeHash: await hashText(resume.resumeText ?? '') };
          candidate.phase = resume.sourceQuality === 'COMPLETE' ? 'RESUME_EXTRACTED' : 'UNCERTAIN';
          if (candidate.phase === 'UNCERTAIN') candidate.reasonCode = 'INSUFFICIENT_INFO';
          break;
        }
        case 'RESUME_EXTRACTED': {
          candidate.deep = this.ai.screen(snapshot, run.profile, true);
          candidate.phase = candidate.deep.decision === 'PASS' ? 'DEEP_PASS' : candidate.deep.decision === 'REJECT' ? 'REJECTED' : 'UNCERTAIN';
          // 简历仅在分析阶段暂存；证据结果保留，全文及时移除。
          delete candidate.snapshot.resumeText;
          break;
        }
        case 'DEEP_PASS': {
          const previous = await this.repo.operation(run.job.accountScope, snapshot.candidateId);
          if (previous) {
            candidate.phase = 'SKIPPED'; candidate.reasonCode = 'ALREADY_CONTACTED_OR_UNRESOLVED'; break;
          }
          candidate.phase = 'PREPARED';
          const op: Operation = {
            key: operationKey(run.job.accountScope, snapshot.candidateId), operationId: crypto.randomUUID(),
            runId: run.taskId, accountScope: run.job.accountScope, jobId: run.job.platformJobId,
            candidateId: snapshot.candidateId, state: 'PREPARED', revision: 0
          };
          await this.commit(run, 'PREPARED', candidate, op, started); return;
        }
        case 'PREPARED': {
          const op = await this.repo.operation(run.job.accountScope, snapshot.candidateId);
          if (!op || op.state !== 'PREPARED' || op.runId !== run.taskId) throw new Error('LEDGER_CONFLICT');
          assertIdentity(run.job, await this.page.observe());
          candidate.phase = 'SENDING';
          op.state = 'SENDING'; op.revision += 1;
          await this.commit(run, 'SENDING', candidate, op, started);
          let result;
          try { result = await this.greeting.send(this.context(run, candidate, op)); }
          catch { result = { status: 'UNKNOWN' as const, reason: 'SEND_RESULT_LOST' }; }
          // 如中途有控制写入，旧结果不得覆盖；SENDING 留待恢复核对。
          const latest = await this.repo.latest();
          if (latest?.revision !== run.revision) return;
          if (result.status === 'CONFIRMED' && result.receiptId) {
            candidate.phase = 'WAITING_REPLY'; op.state = 'CONFIRMED'; op.receiptId = result.receiptId;
          } else if (result.status === 'FAILED') {
            candidate.phase = 'FAILED'; op.state = 'FAILED'; candidate.reasonCode = 'GREETING_FAILED';
            run.status = 'PAUSED';
          } else { candidate.phase = 'UNKNOWN'; op.state = 'UNKNOWN'; run.status = 'PAUSED'; }
          op.revision += 1;
          await this.commit(run, op.state, candidate, op, started); return;
        }
      }
      await this.commit(run, candidate.reasonCode ?? candidate.phase, candidate, undefined, started);
    } catch (error) {
      if (error instanceof Error && error.message === 'STALE_REVISION') return;
      run.status = 'PAUSED';
      // 日志只保留白名单原因，不落原始异常和网页文本。
      const reason = error instanceof Error ? error.message : '';
      await this.commit(run, /^(JOB_CHANGED|ACCOUNT_CHANGED|SOURCE_CHANGED|PAGE_UNHEALTHY|CANDIDATE_MISMATCH|LEDGER_CONFLICT|FIXTURE_UNAVAILABLE|FIXTURE_TIMEOUT|RISK_BLOCKED)$/.test(reason) ? reason : 'STEP_FAILED', candidate);
    }
  }

  async reconcile(): Promise<void> {
    const run = await this.required();
    if (run.status !== 'PAUSED') throw new Error('RUN_NOT_PAUSED');
    assertIdentity(run.job, await this.page.observe());
    for (const candidate of run.candidates.filter(c => c.phase === 'UNKNOWN')) {
      const op = await this.repo.operation(run.job.accountScope, candidate.snapshot.candidateId);
      if (!op || op.state !== 'UNKNOWN' || op.runId !== run.taskId) throw new Error('LEDGER_CONFLICT');
      const result = await this.greeting.reconcile(this.context(run, candidate, op));
      assertIdentity(run.job, await this.page.observe());
      if (result.status === 'CONFIRMED' && result.receiptId) {
        candidate.phase = 'WAITING_REPLY';
        await this.commit(run, 'RECONCILED', candidate, { ...op, state: 'CONFIRMED', revision: op.revision + 1, receiptId: result.receiptId });
      }
    }
  }

  async scanReplies(): Promise<void> {
    const run = await this.required();
    if (run.status !== 'WAITING_REPLIES') return;
    assertIdentity(run.job, await this.page.observe());
    for (const message of await this.reply.list()) {
      if (message.direction !== 'CANDIDATE' || message.jobId !== run.job.platformJobId || message.accountScope !== run.job.accountScope) continue;
      const candidate = run.candidates.find(c => c.snapshot.candidateId === message.candidateId && c.phase === 'WAITING_REPLY');
      if (!candidate) continue;
      const op = await this.repo.operation(run.job.accountScope, message.candidateId);
      if (op?.state !== 'CONFIRMED' || op.runId !== run.taskId) continue;
      candidate.phase = 'REPLIED'; await this.commit(run, 'CANDIDATE_REPLY', candidate);
    }
  }

  async handoff(candidateId: string): Promise<void> {
    const run = await this.required();
    if (run.status !== 'WAITING_REPLIES') throw new Error('HANDOFF_NOT_READY');
    const candidate = run.candidates.find(c => c.snapshot.candidateId === candidateId && ['REPLIED', 'HR_HANDOFF'].includes(c.phase));
    if (!candidate) throw new Error('REPLY_NOT_FOUND');
    assertIdentity(run.job, await this.page.observe());
    await this.reply.open(run.job, candidateId);
    candidate.phase = 'HR_HANDOFF'; await this.commit(run, 'HR_HANDOFF', candidate);
  }

  private context(run: Run, candidate: CandidateTask, op: Operation): SendContext {
    return { job: run.job, candidateId: candidate.snapshot.candidateId, operationId: op.operationId };
  }
  private async required(): Promise<Run> { const run = await this.repo.latest(); if (!run) throw new Error('RUN_NOT_FOUND'); return run; }
  private log(run: Run, reasonCode: string, candidate?: CandidateTask, started = performance.now()) {
    run.reasonCode = reasonCode;
    run.events.push({
      taskId: run.taskId, ...(candidate ? { candidateRef: `synthetic:${candidate.snapshot.candidateId}` } : {}),
      phase: candidate?.phase ?? run.status, reasonCode, revision: run.revision,
      durationMs: Math.round(performance.now() - started), at: new Date().toISOString(),
      modelUsage: { modelId: run.modelVersion, tokens: 0, cost: 0 }
    });
    run.events = run.events.slice(-300);
  }
  private async commit(run: Run, reasonCode: string, candidate?: CandidateTask, op?: Operation, started?: number): Promise<void> {
    const previous = run.revision; run.revision += 1;
    this.log(run, reasonCode, candidate, started);
    if (!await this.repo.save(run, previous, op)) throw new Error('STALE_REVISION');
  }
}
