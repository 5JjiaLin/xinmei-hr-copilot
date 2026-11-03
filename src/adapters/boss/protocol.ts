export type BossMode = 'BROWSE' | 'GREET_ALL';
export interface BossIdentity { account: string; job: string }
export interface BossProbe {
  supported: boolean; reason: string; cards: number; identified: number;
  identity?: BossIdentity;
}
export interface BossCommand {
  channel: 'hr-boss-v1'; action: 'probe' | 'begin' | 'next' | 'open' | 'read' | 'greet' | 'close' | 'cancel';
  session: string; deadline: number; identity?: BossIdentity; candidate?: string; seen?: string[];
}
export interface BossTarget { tabId: number; frameId: number; documentId: string }
export interface BossRun {
  id: string; target: BossTarget; identity: BossIdentity; mode: BossMode; limit: number;
  status: 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED';
  phase: 'NEXT' | 'OPEN' | 'READ' | 'GREET' | 'SENDING' | 'CLOSE';
  reason: string; session: string; seen: string[]; current?: string;
  read: number; sent: number; skipped: number; listScrolls: number;
  events: Array<{ at: string; reason: string }>;
}
export type BossLedger = Record<string, 'SENDING' | 'CONFIRMED' | 'UNKNOWN'>;
export interface BossState { run?: BossRun; ledger: BossLedger }
export interface BossPort { call<T>(target: BossTarget, command: BossCommand): Promise<T> }
export interface BossStore { load(): Promise<BossState>; save(state: BossState): Promise<void> }
export const sameIdentity = (a: BossIdentity, b: BossIdentity) => a.account === b.account && a.job === b.job;
