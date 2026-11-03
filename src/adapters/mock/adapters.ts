import type { FixtureBridge, RecruitmentPageAdapter, GreetingAdapter, ReplyAdapter, SendContext } from '../contracts';
import type { JobIdentity, PageObservation, CandidateSnapshot, SendResult, ReplyMessage } from '../../shared/types';

export class MockBossAdapter implements RecruitmentPageAdapter {
  constructor(private bridge: FixtureBridge) {}
  observe() { return this.bridge.request<PageObservation>('observe'); }
  listCandidates(job: JobIdentity) { return this.bridge.request<CandidateSnapshot[]>('list', { job }); }
  openResume(job: JobIdentity, candidateId: string) {
    return this.bridge.request<CandidateSnapshot>('resume', { job, candidateId });
  }
}
export class MockGreetingAdapter implements GreetingAdapter {
  constructor(private bridge: FixtureBridge) {}
  send(context: SendContext) { return this.bridge.request<SendResult>('send', context); }
  reconcile(context: SendContext) { return this.bridge.request<SendResult>('reconcile', context); }
}
export class MockReplyAdapter implements ReplyAdapter {
  constructor(private bridge: FixtureBridge) {}
  list() { return this.bridge.request<ReplyMessage[]>('replies'); }
  open(job: JobIdentity, candidateId: string) { return this.bridge.request<void>('chat', { job, candidateId }); }
}
