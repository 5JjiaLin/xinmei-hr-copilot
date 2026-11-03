export interface JobIdentity {
  accountScope: string;
  platformJobId: string;
  displayName: string;
  source: 'LOCAL_FIXTURE';
}
export interface JobSnapshot extends JobIdentity {
  jdText: string;
  jdHash: string;
  criteriaVersion: string;
  capturedAt: string;
}
export interface CandidateSnapshot {
  candidateId: string;
  jobId: string;
  cardText: string;
  resumeText?: string;
  resumeHash?: string;
  sourceQuality: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
}
export interface Profile { criteria: Array<{ id: string; text: string }>; version: string }
export interface ScreeningResult {
  candidateId: string;
  jobId: string;
  decision: 'PASS' | 'UNCERTAIN' | 'REJECT';
  matchedRequirements: Array<{ criterionId: string; evidence: string }>;
  missingInformation: string[];
  riskFlags: string[];
  criteriaVersion: string;
  promptVersion: string;
}
export type SendResult =
  | { status: 'CONFIRMED'; receiptId: string }
  | { status: 'UNKNOWN' | 'FAILED'; reason: string };
export type CandidatePhase = 'DISCOVERED' | 'QUICK_PASS' | 'RESUME_EXTRACTED' |
  'DEEP_PASS' | 'PREPARED' | 'SENDING' | 'WAITING_REPLY' | 'REPLIED' | 'HR_HANDOFF' |
  'UNCERTAIN' | 'REJECTED' | 'UNKNOWN' | 'FAILED' | 'SKIPPED';
export interface CandidateTask {
  snapshot: CandidateSnapshot;
  phase: CandidatePhase;
  quick?: ScreeningResult;
  deep?: ScreeningResult;
  reasonCode?: string;
}
export interface AuditEvent {
  taskId: string;
  candidateRef?: string;
  phase: string;
  durationMs: number;
  reasonCode: string;
  modelUsage: { modelId: string; tokens: number; cost: number };
  revision: number;
  at: string;
}
export interface Run {
  id: string;
  taskId: string;
  revision: number;
  mode: 'MOCK';
  status: 'RUNNING' | 'PAUSED' | 'STOPPED' | 'WAITING_REPLIES' | 'COMPLETED';
  reasonCode: string;
  job: JobSnapshot;
  profile: Profile;
  modelVersion: 'mock-literal-v1';
  candidates: CandidateTask[];
  events: AuditEvent[];
}
export interface Operation {
  key: string;
  operationId: string;
  runId: string;
  accountScope: string;
  jobId: string;
  candidateId: string;
  state: 'PREPARED' | 'SENDING' | 'CONFIRMED' | 'UNKNOWN' | 'FAILED';
  revision: number;
  receiptId?: string;
}
export interface ReplyMessage {
  id: string;
  candidateId: string;
  jobId: string;
  accountScope: string;
  direction: 'CANDIDATE' | 'HR' | 'SYSTEM';
}
export interface PageObservation { job: JobIdentity; healthy: boolean; reasonCode: string }
export const operationKey = (account: string, candidate: string): string => JSON.stringify([account, candidate]);
export async function hashText(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
