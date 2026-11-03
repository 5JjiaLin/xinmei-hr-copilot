import type { Run, Operation } from '../shared/types';
import { defaultJd } from '../adapters/mock/data';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const jd = $<HTMLTextAreaElement>('jd');
const errors: Record<string, string> = {
  FIXTURE_TIMEOUT: '请先打开模拟招聘页，并保持该页面开启。',
  ACTIVE_RUN_EXISTS: '已有任务，请先停止当前任务。',
  RECONCILIATION_REQUIRED: '存在未知发送结果，请先核对回执，不能直接重试。',
  STOP_BEFORE_CLEAR: '请先停止任务，再删除本地任务与账本。',
  JOB_CHANGED: '岗位已切换，任务暂停。请切回原岗位后继续。',
  ACCOUNT_CHANGED: '账号已切换，任务暂停。',
  RISK_BLOCKED: '模拟页面存在风险提示，任务暂停。',
  JD_UNSUPPORTED: '演示仅支持逐行填写岗位能力；不支持人口属性或指令式内容。',
  JD_INVALID: '请填写 1–20 行岗位能力，每行一个简短能力短语。'
};
const phases: Record<string, string> = {
  RUNNING: '执行中', PAUSED: '已暂停', STOPPED: '已停止', WAITING_REPLIES: '等待候选人回复', COMPLETED: '已完成',
  DISCOVERED: '待初筛', QUICK_PASS: '初筛通过', RESUME_EXTRACTED: '详情已读取', DEEP_PASS: '深筛通过',
  PREPARED: '发送已准备', SENDING: '发送中', WAITING_REPLY: '招呼已确认', REPLIED: '有新回复',
  HR_HANDOFF: '已交给 HR', UNCERTAIN: '信息不足，暂缓', REJECTED: '不匹配', UNKNOWN: '回执未知', FAILED: '失败', SKIPPED: '既往账本，已跳过'
};
async function request(type: string, payload: Record<string, unknown> = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload }) as { ok: boolean; data: unknown; error?: string };
  if (!result.ok) throw new Error(result.error ?? 'COMMAND_FAILED');
  return result.data;
}
async function act(type: string, payload: Record<string, unknown> = {}) {
  try { await request(type, payload); $('error').textContent = ''; await refresh(); }
  catch (error) { const code = error instanceof Error ? error.message : 'COMMAND_FAILED'; $('error').textContent = errors[code] ?? `操作未完成：${code}`; }
}
jd.value = defaultJd;
void chrome.storage.local.get('draftJd').then(data => { if (typeof data.draftJd === 'string') jd.value = data.draftJd; });
jd.oninput = () => { void chrome.storage.local.set({ draftJd: jd.value }); };
$('open-fixture').onclick = () => { void act('OPEN_FIXTURE'); };
$('start').onclick = () => { void act('START', { jd: jd.value }); };
for (const command of ['pause', 'resume', 'stop', 'reconcile', 'clear']) $(''+command).onclick = () => { void act(command.toUpperCase()); };
let refreshing = false;
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    const { run, operations } = await request('STATUS') as { run?: Run; operations: Operation[] };
    $('status').textContent = run ? phases[run.status]! : '尚未开始';
    $('job-name').textContent = run ? run.job.displayName : '请在模拟页选择岗位';
    $('snapshot').textContent = run ? `${run.job.platformJobId} · revision ${run.revision} · JD ${run.job.jdHash.slice(0, 10)}` : '开始后冻结岗位与 JD 版本';
    $('reason').textContent = run ? (errors[run.reasonCode] ?? run.reasonCode) : '';
    $<HTMLButtonElement>('start').disabled = !!run && !['STOPPED', 'COMPLETED'].includes(run.status);
    $<HTMLButtonElement>('pause').disabled = run?.status !== 'RUNNING';
    $<HTMLButtonElement>('resume').disabled = run?.status !== 'PAUSED';
    $<HTMLButtonElement>('stop').disabled = !run || ['STOPPED', 'COMPLETED'].includes(run.status);
    $<HTMLButtonElement>('reconcile').disabled = !run?.candidates.some(c => c.phase === 'UNKNOWN');
    $('metrics').textContent = run ? `扫描 ${run.candidates.length} · 深筛 ${run.candidates.filter(c => c.deep).length} · 联系 ${operations.filter(o => o.runId === run.taskId && o.state === 'CONFIRMED').length} · 回复 ${run.candidates.filter(c => ['REPLIED', 'HR_HANDOFF'].includes(c.phase)).length} · 失败 ${run.candidates.filter(c => c.phase === 'FAILED').length} · Token 0 / ¥0（假模型）` : '尚无任务数据';
    const list = $('candidates'); list.replaceChildren();
    for (const candidate of run?.candidates ?? []) {
      const row = document.createElement('li');
      const title = document.createElement('strong'); title.textContent = `${candidate.snapshot.candidateId} · ${phases[candidate.phase]}`;
      row.append(title);
      const result = candidate.deep ?? candidate.quick;
      if (result) {
        const evidence = document.createElement('p');
        evidence.textContent = result.matchedRequirements.map(m => `「${m.evidence}」`).join('、') || '尚无匹配证据';
        if (result.missingInformation.length) evidence.textContent += `；待了解：${result.missingInformation.join('、')}`;
        row.append(evidence);
      }
      if (['REPLIED', 'HR_HANDOFF'].includes(candidate.phase)) {
        const button = document.createElement('button'); button.textContent = '打开对应聊天';
        button.onclick = () => { void act('HANDOFF', { candidateId: candidate.snapshot.candidateId }); }; row.append(button);
      }
      list.append(row);
    }
    $('logs').textContent = run?.events.slice(-40).map(e => `r${e.revision} ${e.candidateRef ?? '任务'} ${e.phase} ${e.reasonCode} ${e.durationMs}ms`).join('\n') ?? '暂无日志';
    if (run?.status === 'WAITING_REPLIES') await request('SCAN_REPLIES');
  } catch { $('error').textContent = '扩展连接中断，请重新打开侧栏。'; }
  finally { refreshing = false; }
}
void refresh();
setInterval(() => { void refresh(); }, 700);
