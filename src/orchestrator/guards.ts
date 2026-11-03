import type { JobIdentity, PageObservation, CandidateSnapshot } from '../shared/types';
export function assertIdentity(job: JobIdentity, page: PageObservation): void {
  if (!page.healthy) throw new Error(page.reasonCode || 'PAGE_UNHEALTHY');
  if (page.job.source !== 'LOCAL_FIXTURE' || job.source !== 'LOCAL_FIXTURE') throw new Error('SOURCE_CHANGED');
  if (!job.platformJobId || page.job.platformJobId !== job.platformJobId) throw new Error('JOB_CHANGED');
  if (!job.accountScope || page.job.accountScope !== job.accountScope) throw new Error('ACCOUNT_CHANGED');
}
export function assertCandidate(job: JobIdentity, candidate: CandidateSnapshot, id?: string): void {
  if (!candidate.candidateId || candidate.jobId !== job.platformJobId || (id && candidate.candidateId !== id))
    throw new Error('CANDIDATE_MISMATCH');
}
