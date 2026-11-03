import { test, expect, chromium, type BrowserContext, type Page, type Frame, type Worker } from '@playwright/test';
import { mkdtemp, readdir, rm, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import type { BossCommand } from '../../src/adapters/boss/protocol';

let context: BrowserContext, page: Page, frame: Frame, panel: Page, worker: Worker, temporary: string;
let driverScript: string;
const topHtml = '<div data-account-id="synthetic-account"></div><div id="job" data-current-job-id="synthetic-job"></div><iframe id="recommendFrame" src="/web/frame/recommend" style="width:900px;height:650px"></iframe>';
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: "import { BossDomDriver } from './src/adapters/boss/dom-driver'; globalThis.driver = new BossDomDriver(document);", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  driverScript = result.outputFiles[0]!.text;
});
test.beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'hr-boss-e2e-'));
  const extension = path.join(temporary, 'extension'); await cp('dist', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // 隔离测试包预授域权限；真实发布包依旧按用户点击请求可选权限。
  manifest.host_permissions = manifest.optional_host_permissions; delete manifest.optional_host_permissions;
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  const browsers = (await readdir(cache).catch(() => [] as string[])).filter(x => /^chromium-\d+$/.test(x)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  const executablePath = browsers[0] ? path.join(cache, browsers[0], 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing') : undefined;
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'chromium', headless: true,
    ...(executablePath ? { executablePath } : {}), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const fixture = await readFile('tests/fixtures/boss-operations.html', 'utf8');
  // 所有 HTTP 请求都拦截：不会访问 BOSS 网络或登录用户账号。
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'https://www.zhipin.com') return route.fulfill({ contentType: 'text/html', body: url.pathname.includes('/frame/') ? fixture : topHtml });
    return route.abort();
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  panel = await context.newPage(); await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
  page = await context.newPage(); await page.goto('https://www.zhipin.com/web/chat/recommend');
  frame = page.frames().find(f => f.url().includes('/frame/'))!;
  await expect(frame.locator('.geek-card')).toHaveCount(2);
});
test.afterEach(async () => { await context?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });
async function message(type: string, payload: Record<string, unknown> = {}) {
  return panel.evaluate(async input => chrome.runtime.sendMessage(input), { type, ...payload });
}
function cmd(action: BossCommand['action'], extra: Partial<BossCommand> = {}): BossCommand {
  return { channel: 'hr-boss-v1', action, session: 'test-session', deadline: Date.now() + 25000, ...extra };
}
async function direct(action: BossCommand['action'], extra: Partial<BossCommand> = {}) {
  return frame.evaluate(async command => {
    try { return { ok: true, data: await (window as any).driver.execute(command) }; }
    catch (error) { return { ok: false, error: (error as Error).message }; }
  }, cmd(action, extra));
}
async function begin() {
  await frame.addScriptTag({ content: driverScript });
  expect((await direct('probe')).data.supported).toBe(true);
  expect((await direct('begin', { identity: { account: 'synthetic-account', job: 'synthetic-job' } })).ok).toBe(true);
}

test('真实桥接 + iframe + 增量列表：连续浏览并招呼，关闭返回后继续', async () => {
  expect((await message('BOSS_CONNECT')).data.probe.supported).toBe(true);
  expect((await message('BOSS_CONNECT')).data.probe.supported).toBe(true);
  expect((await message('BOSS_START', { mode: 'GREET_ALL', limit: 4 })).ok).toBe(true);
  await expect.poll(async () => (await message('BOSS_STATUS')).data?.status, { timeout: 25000 }).toBe('COMPLETED');
  const run = (await message('BOSS_STATUS')).data;
  expect(run.read).toBe(4); expect(run.sent).toBe(4); expect(run.listScrolls).toBeGreaterThan(0);
  const fixture = await frame.evaluate(() => (window as any).fixture);
  expect(fixture.closed).toBe(4); expect(fixture.sent).toBe(4); expect(fixture.resumeScrolls).toBeGreaterThan(4);
  expect(new Set(fixture.opened).size).toBe(4); expect(await frame.locator('.resume-dialog').count()).toBe(0);
  const saved = await worker.evaluate(() => chrome.storage.local.get('bossOperationsV1'));
  expect(JSON.stringify(saved)).not.toContain('项目经历');
});
test('只浏览模式 + 侧栏刷新不控制循环；列表和简历都滚动', async () => {
  expect((await message('BOSS_START', { mode: 'BROWSE', limit: 3 })).ok).toBe(true);
  await panel.reload(); await page.bringToFront();
  await expect.poll(async () => (await message('BOSS_STATUS')).data?.status, { timeout: 25000 }).toBe('COMPLETED');
  expect(await frame.evaluate(() => (window as any).fixture.sent)).toBe(0);
  expect((await message('BOSS_STATUS')).data.read).toBe(3);
});
test('滚动简历期间停止，后续不再滚动、发送或处理下一人', async () => {
  expect((await message('BOSS_START', { mode: 'GREET_ALL', limit: 3 })).ok).toBe(true);
  await expect.poll(() => frame.evaluate(() => (window as any).fixture.resumeScrolls)).toBeGreaterThan(0);
  expect((await message('BOSS_STOP')).ok).toBe(true);
  const before = await frame.evaluate(() => (window as any).fixture);
  // 给原来等待的 DOM 条件充分触发机会，验证无迟到动作。
  await frame.evaluate(() => new Promise(resolve => setTimeout(resolve, 900)));
  const after = await frame.evaluate(() => (window as any).fixture);
  expect(after.resumeScrolls).toBe(before.resumeScrolls); expect(after.sent).toBe(0); expect(after.opened.length).toBe(1);
  expect((await message('BOSS_STATUS')).data.status).toBe('STOPPED');
});
test('同一回合 A→B→A 也撤销会话，不能继续点击', async () => {
  await begin(); await page.evaluate(() => { const el = document.querySelector('#job')!; el.setAttribute('data-current-job-id', 'other'); el.setAttribute('data-current-job-id', 'synthetic-job'); });
  expect((await direct('open', { candidate: 'synthetic-1' })).error).toBe('IDENTITY_CHANGED');
  expect(await frame.evaluate(() => (window as any).fixture.opened.length)).toBe(0);
});
test('错人简历拒绝，缺账号/岗位 ID 不按名称兜底', async () => {
  await begin(); await frame.evaluate(() => { (window as any).fixture.wrong = true; });
  expect((await direct('open', { candidate: 'synthetic-1' })).error).toBe('RESUME_ID_MISMATCH');
  await page.evaluate(() => document.querySelector('[data-account-id]')!.removeAttribute('data-account-id'));
  expect((await direct('probe')).data.reason).toBe('ACCOUNT_ID_UNAVAILABLE');
  expect(await frame.evaluate(() => (window as any).fixture.sent)).toBe(0);
});
test('期限过后不点击；风险提示会中止动作', async () => {
  await begin(); expect((await direct('open', { candidate: 'synthetic-1', deadline: Date.now() - 1 })).error).toBe('COMMAND_EXPIRED');
  await frame.evaluate(() => { const risk = document.createElement('div'); risk.dataset.risk = ''; risk.textContent = '验证码'; document.body.append(risk); });
  expect((await direct('open', { candidate: 'synthetic-1' })).error).toBe('RISK_BLOCKED');
  expect(await frame.evaluate(() => (window as any).fixture.opened.length)).toBe(0);
});
test('点击后没有沟通状态回执：UNKNOWN，拒绝继续和重发', async () => {
  await frame.evaluate(() => { (window as any).fixture.lost = true; });
  expect((await message('BOSS_START', { mode: 'GREET_ALL', limit: 1 })).ok).toBe(true);
  await expect.poll(async () => (await message('BOSS_STATUS')).data?.status, { timeout: 15000 }).toBe('PAUSED');
  expect((await message('BOSS_STATUS')).data.reason).toBe('SEND_UNKNOWN');
  expect((await message('BOSS_RESUME')).ok).toBe(false);
  expect(await frame.evaluate(() => (window as any).fixture.sent)).toBe(1);
});
test('原标签页刷新后文档失效，任务暂停不附着到新文档', async () => {
  expect((await message('BOSS_START', { mode: 'BROWSE', limit: 2 })).ok).toBe(true);
  await expect(frame.locator('.resume-dialog')).toBeVisible(); await page.reload();
  await expect.poll(async () => (await message('BOSS_STATUS')).data?.status).toBe('PAUSED');
  expect((await message('BOSS_RESUME')).ok).toBe(false);
  frame = page.frames().find(f => f.url().includes('/frame/'))!;
  expect(await frame.evaluate(() => (window as any).fixture.opened.length)).toBe(0);
});
test('人工滚轮介入立即让出控制，程序滚动不触发误暂停', async () => {
  expect((await message('BOSS_START', { mode: 'GREET_ALL', limit: 2 })).ok).toBe(true);
  await expect(frame.locator('.resume-dialog')).toBeVisible();
  await frame.locator('.resume-body').hover(); await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await message('BOSS_STATUS')).data?.status).toBe('PAUSED');
  expect((await message('BOSS_STATUS')).data.reason).toBe('MANUAL_INTERVENTION');
  expect(await frame.evaluate(() => (window as any).fixture.sent)).toBe(0);
});
