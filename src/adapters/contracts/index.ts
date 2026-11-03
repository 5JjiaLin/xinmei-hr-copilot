import type { CandidateSnapshot, JobIdentity, PageObservation, ReplyMessage, SendResult } from '../../shared/types';

export interface RecruitmentPageAdapter {
  observe(): Promise<PageObservation>;
  listCandidates(job: JobIdentity): Promise<CandidateSnapshot[]>;
  openResume(job: JobIdentity, candidateId: string): Promise<CandidateSnapshot>;
}
export interface SendContext { job: JobIdentity; candidateId: string; operationId: string }
export interface GreetingAdapter {
  send(context: SendContext): Promise<SendResult>;
  reconcile(context: SendContext): Promise<SendResult>;
}
export interface ReplyAdapter {
  list(): Promise<ReplyMessage[]>;
  open(job: JobIdentity, candidateId: string): Promise<void>;
}
export interface FixtureBridge { request<T>(action: string, payload?: unknown): Promise<T> }
