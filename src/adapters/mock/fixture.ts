import { jobs, syntheticCandidates } from './data';
import type { CandidateSnapshot, JobIdentity, ReplyMessage, SendResult } from '../../shared/types';
import type { SendContext } from '../contracts';

interface FixtureState {
  jobId: string; account: string; risk: boolean; lostReceipt: boolean;
  receipts: Record<string, { receiptId: string; operationId: string; jobId: string }>;
  counts: Record<string, number>; replies: ReplyMessage[];
}
const saved = localStorage.getItem('hr-fixture-state');
let state: FixtureState = saved ? JSON.parse(saved) as FixtureState : {
  jobId: jobs[0]!.platformJobId, account: jobs[0]!.accountScope, risk: false, lostReceipt: false,
  receipts: {}, counts: {}, replies: []
};
const persist = () => localStorage.setItem('hr-fixture-state', JSON.stringify(state));
const channel = new BroadcastChannel('hr-local-fixture-v1');
const select = document.querySelector<HTMLSelectElement>('#job')!;
const risk = document.querySelector<HTMLInputElement>('#risk')!;
const lost = document.querySelector<HTMLInputElement>('#lost')!;
const resume = document.querySelector<HTMLElement>('#resume')!;
document.querySelector<HTMLInputElement>('#hold-resume')!.onchange = event => {
  resume.dataset.waiting = String((event.target as HTMLInputElement).checked);
};
document.querySelector<HTMLButtonElement>('#release-resume')!.onclick = () => {
  resume.dataset.waiting = 'false'; document.querySelector<HTMLInputElement>('#hold-resume')!.checked = false;
};
select.value = state.jobId; risk.checked = state.risk; lost.checked = state.lostReceipt;
function job(): JobIdentity { return { ...jobs.find(j => j.platformJobId === state.jobId)!, accountScope: state.account }; }
function verify(expected: JobIdentity) {
  if (state.risk) throw new Error('RISK_BLOCKED');
  if (expected.platformJobId !== state.jobId) throw new Error('JOB_CHANGED');
  if (expected.accountScope !== state.account) throw new Error('ACCOUNT_CHANGED');
  if (expected.source !== 'LOCAL_FIXTURE') throw new Error('SOURCE_CHANGED');
}
select.onchange = () => { state.jobId = select.value; persist(); render(); };
risk.onchange = () => { state.risk = risk.checked; persist(); };
lost.onchange = () => { state.lostReceipt = lost.checked; persist(); };
document.querySelector<HTMLButtonElement>('#switch-account')!.onclick = () => {
  state.account = state.account === 'synthetic-company' ? 'synthetic-other' : 'synthetic-company'; persist(); render();
};
document.querySelector<HTMLButtonElement>('#simulate-reply')!.onclick = () => {
  const candidateId = Object.keys(state.receipts)[0];
  if (!candidateId) return;
  const receipt = state.receipts[candidateId]!;
  if (!state.replies.some(r => r.candidateId === candidateId && r.direction === 'CANDIDATE'))
    state.replies.push({ id: crypto.randomUUID(), candidateId, jobId: receipt.jobId, accountScope: state.account, direction: 'CANDIDATE' });
  persist(); render();
};
document.querySelector<HTMLButtonElement>('#simulate-hr')!.onclick = () => {
  const candidateId = Object.keys(state.receipts)[0]; if (!candidateId) return;
  state.replies.push({ id: crypto.randomUUID(), candidateId, jobId: state.jobId, accountScope: state.account, direction: 'HR' }); persist(); render();
};
document.querySelector<HTMLButtonElement>('#reorder')!.onclick = () => {
  const list = document.querySelector('#cards')!; [...list.children].reverse().forEach(n => list.append(n));
};
function render() {
  document.querySelector('#account')!.textContent = `当前合成账号：${state.account}`;
  document.querySelector('#sent-count')!.textContent = String(Object.values(state.counts).reduce((a, b) => a + b, 0));
  const list = document.querySelector('#cards')!; list.replaceChildren();
  for (const person of syntheticCandidates) {
    const card = document.createElement('article'); card.dataset.candidateId = person.candidateId;
    const heading = document.createElement('h3'); heading.textContent = person.name;
    const id = document.createElement('small'); id.textContent = person.candidateId;
    const text = document.createElement('p'); text.dataset.cardText = ''; text.textContent = person.cardText;
    const status = document.createElement('p'); status.textContent = state.receipts[person.candidateId] ? '模拟招呼已确认' : '尚未联系';
    card.append(heading, id, text, status); list.append(card);
  }
  document.querySelector('#reply-count')!.textContent = String(state.replies.filter(r => r.direction === 'CANDIDATE').length);
}
render();

async function handle(action: string, payload: unknown): Promise<unknown> {
  const input = payload as { job: JobIdentity; candidateId: string; operationId: string };
  if (action === 'observe') return { job: job(), healthy: !state.risk, reasonCode: state.risk ? 'RISK_BLOCKED' : 'OK' };
  if (action === 'replies') return state.replies;
  verify(input.job);
  const person = syntheticCandidates.find(c => c.candidateId === input.candidateId);
  if (action === 'list') {
    // 按稳定 ID 读取当前 DOM，不依赖卡片顺序。
    return [...document.querySelectorAll<HTMLElement>('[data-candidate-id]')].map(card => ({
      candidateId: card.dataset.candidateId!, jobId: state.jobId,
      cardText: card.querySelector('[data-card-text]')!.textContent!, sourceQuality: 'COMPLETE'
    } satisfies CandidateSnapshot));
  }
  if (!person) throw new Error('CANDIDATE_MISMATCH');
  if (action === 'resume') {
    const details = document.querySelector<HTMLElement>('#resume')!;
    details.dataset.requested = person.candidateId;
    if (details.dataset.waiting === 'true') {
      await new Promise<void>((resolve, reject) => {
        const observer = new MutationObserver(() => {
          if (details.dataset.waiting !== 'true') { clearTimeout(timer); observer.disconnect(); resolve(); }
        });
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error('FIXTURE_TIMEOUT')); }, 10000);
        observer.observe(details, { attributes: true, attributeFilter: ['data-waiting'] });
      });
    }
    verify(input.job);
    details.dataset.candidateId = person.candidateId; details.textContent = person.resumeText; details.hidden = false;
    return { candidateId: person.candidateId, jobId: state.jobId, cardText: person.cardText,
      resumeText: details.textContent, sourceQuality: person.sourceQuality } satisfies CandidateSnapshot;
  }
  if (action === 'send') {
    const context = input as SendContext;
    if (state.receipts[person.candidateId]) return { status: 'FAILED', reason: 'ALREADY_CONTACTED' } satisfies SendResult;
    const receipt = { receiptId: crypto.randomUUID(), operationId: context.operationId, jobId: state.jobId };
    state.receipts[person.candidateId] = receipt;
    state.counts[person.candidateId] = (state.counts[person.candidateId] ?? 0) + 1;
    state.replies.push({ id: crypto.randomUUID(), candidateId: person.candidateId, jobId: state.jobId, accountScope: state.account, direction: 'SYSTEM' });
    persist(); render();
    return state.lostReceipt ? { status: 'UNKNOWN', reason: 'RECEIPT_LOST' } : { status: 'CONFIRMED', receiptId: receipt.receiptId };
  }
  if (action === 'reconcile') {
    const receipt = state.receipts[person.candidateId];
    return receipt && receipt.operationId === input.operationId && receipt.jobId === state.jobId
      ? { status: 'CONFIRMED', receiptId: receipt.receiptId }
      : { status: 'UNKNOWN', reason: 'NO_RELIABLE_RECEIPT' };
  }
  if (action === 'chat') {
    const dialog = document.querySelector<HTMLDialogElement>('#chat')!;
    dialog.querySelector('p')!.textContent = `${person.name}（${person.candidateId}）：您好，愿意了解岗位。此后由 HR 手工沟通。`;
    dialog.showModal(); return;
  }
  throw new Error('UNKNOWN_FIXTURE_ACTION');
}
const receive = async (event: MessageEvent) => {
  const message = event.data as { kind: string; id: string; action: string; payload: unknown };
  if (message.kind !== 'request') return;
  try { channel.postMessage({ kind: 'response', id: message.id, data: await handle(message.action, message.payload) }); }
  catch (error) { channel.postMessage({ kind: 'response', id: message.id, error: error instanceof Error ? error.message : 'FIXTURE_ERROR' }); }
};
// 同一扩展只允许一个合成页面承担动作，防止重复标签页多次响应同一命令。
void navigator.locks.request('hr-fixture-owner', { ifAvailable: true }, async lock => {
  if (!lock) {
    document.querySelector('main')!.textContent = '已有模拟招聘页开启。请关闭此重复页面，使用原页面。';
    channel.close(); return;
  }
  channel.onmessage = receive;
  await new Promise<void>(() => {});
});
