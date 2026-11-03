import type { Run, Operation } from '../shared/types';
import { defaultJd } from '../adapters/mock/data';
import type { BossRun, BossProbe } from '../adapters/boss/protocol';
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

const bossErrors: Record<string, string> = {
  OPEN_BOSS_RECOMMEND: '请在当前标签页打开 BOSS 招聘端的推荐牛人。',
  HOST_PERMISSION_REQUIRED: '尚未授予 BOSS 网站访问权限。',
  ACCOUNT_ID_UNAVAILABLE: '页面没有提供可核验的账号 ID，需要适配此页面结构。',
  JOB_ID_UNAVAILABLE: '页面没有提供可核验的当前岗位 ID，需要适配此页面结构。',
  CANDIDATE_ID_UNAVAILABLE: '候选人卡片缺少稳定 ID，需要适配此页面结构。',
  LIST_NOT_FOUND: '未识别推荐列表。请等待加载，确认当前位于推荐牛人。',
  MULTIPLE_LISTS: '发现多个候选列表，无法唯一确定操作目标。',
  RESUME_ID_MISMATCH: '简历身份无法与列表核对，操作已暂停。',
  SEND_UNKNOWN: '打招呼结果未知，已停止后续动作且不会重发。请在页面核对，之后停止本批。',
  LIST_STALLED: '滚动后没有发现新候选人，尚未确认列表结束。请检查页面后继续。',
  TARGET_TAB_INACTIVE: '请将绑定的 BOSS 标签页切到前台后继续。',
  PAGE_NOT_VISIBLE: 'BOSS 页面不可见，请回到绑定页面后继续。',
  MANUAL_INTERVENTION: '检测到你在 BOSS 页面操作，已暂停并让出控制。',
  IDENTITY_CHANGED: '岗位、账号或页面结构已变化，已取消旧动作。',
  WORKER_RESTARTED: '扩展后台已重启，任务暂停。请核对页面后继续。',
  PAGE_DISCONNECTED: '原页面文档已断开。请停止本批，再连接当前页面。',
  RISK_BLOCKED: '页面出现验证、额度或风险提示，操作已暂停。',
  BATCH_FINISHED: '本批已完成', LIST_FINISHED: '列表已结束', READY: '页面已识别',
  BATCH_INVALID: '本批人数必须是 1–20 的整数。',
};
const bossReason = (code: string) => bossErrors[code] ?? errors[code] ?? code;
async function refreshBoss() {
  const run = await request('BOSS_STATUS') as BossRun | undefined;
  $('boss-status').textContent = run ? `${phases[run.status]} · 已浏览 ${run.read} · 已打招呼 ${run.sent} · 已联系跳过 ${run.skipped} · 列表滚动 ${run.listScrolls} 次 · ${bossReason(run.reason)}` : '尚未开始';
  $('boss-logs').textContent = run?.events.map(e => `${e.at.slice(11, 19)} ${bossReason(e.reason)}`).join('\n') ?? '';
  $<HTMLButtonElement>('boss-start').disabled = !!run && !['STOPPED', 'COMPLETED'].includes(run.status);
  $<HTMLButtonElement>('boss-pause').disabled = run?.status !== 'RUNNING';
  $<HTMLButtonElement>('boss-resume').disabled = run?.status !== 'PAUSED' || run.phase === 'SENDING';
  $<HTMLButtonElement>('boss-stop').disabled = !run || ['STOPPED', 'COMPLETED'].includes(run.status);
}
async function bossAct(type: string, payload: Record<string, unknown> = {}) {
  try { const data = await request(type, payload); $('boss-error').textContent = ''; await refreshBoss(); return data; }
  catch (error) { $('boss-error').textContent = bossReason(error instanceof Error ? error.message : 'PAGE_DISCONNECTED'); }
}
$('boss-connect').onclick = async () => {
  try {
    // 浏览器要求权限请求直接发生在用户点击事件中。
    if (!await chrome.permissions.request({ origins: ['https://www.zhipin.com/*'] })) throw new Error('HOST_PERMISSION_REQUIRED');
    const connection = await bossAct('BOSS_CONNECT') as { probe: BossProbe } | undefined;
    if (connection) $('boss-diagnostic').textContent = `${bossReason(connection.probe.reason)}；识别卡片 ${connection.probe.cards}，稳定 ID ${connection.probe.identified}。`;
  } catch (error) { $('boss-error').textContent = bossReason(error instanceof Error ? error.message : 'PAGE_DISCONNECTED'); }
};
$('boss-mode').onchange = () => {
  const sending = $<HTMLSelectElement>('boss-mode').value === 'GREET_ALL';
  $('boss-mode-note').textContent = sending ? '点击开始后，会对本批每位打开的候选人打招呼，不判断是否匹配 JD；已联系者跳过。' : '先验证列表与简历滚动、打开和返回；详细筛选规则尚未接入。';
  $('boss-start').textContent = sending ? '开始浏览并逐一打招呼' : '开始页面操作';
};
$('boss-start').onclick = () => { void bossAct('BOSS_START', { mode: $<HTMLSelectElement>('boss-mode').value, limit: Number($<HTMLInputElement>('boss-limit').value) }); };
for (const command of ['pause', 'resume', 'stop', 'clear']) $('boss-' + command).onclick = () => { void bossAct('BOSS_' + command.toUpperCase()); };
let bossRefreshing = false;
setInterval(() => {
  if (bossRefreshing) return; bossRefreshing = true;
  void refreshBoss().catch(() => {}).finally(() => { bossRefreshing = false; });
}, 1000);
void refreshBoss().catch(() => {});
