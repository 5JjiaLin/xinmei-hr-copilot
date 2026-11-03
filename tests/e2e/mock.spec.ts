import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

let context: BrowserContext, fixture: Page, panel: Page, worker: Worker, extensionId: string, profile: string;
const extension = path.resolve('dist');
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'hr-extension-test-'));
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  const browsers = (await readdir(cache).catch(() => [] as string[])).filter(x => /^chromium-\d+$/.test(x)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  const executablePath = browsers[0] ? path.join(cache, browsers[0], 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing') : undefined;
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, ...(executablePath ? { executablePath } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  fixture = await context.newPage(); await fixture.goto(`chrome-extension://${extensionId}/mock.html`);
  panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator('#jd')).toHaveValue('海外社媒运营\n增长项目');
});
test.afterEach(async () => { await context?.close(); if (profile) await rm(profile, { recursive: true, force: true }); });
async function start() { await panel.getByRole('button', { name: '开始执行' }).click(); }
async function waiting() { await expect(panel.locator('#status')).toHaveText('等待候选人回复'); }

test('MV3 Worker + Side Panel API + IndexedDB；10→3→2→1→HR', async () => {
  const errors: string[] = []; panel.on('pageerror', e => errors.push(e.message));
  await fixture.getByRole('button', { name: '重排同名候选人' }).click();
  await start(); await waiting();
  await expect(panel.locator('#metrics')).toContainText('扫描 10 · 深筛 3 · 联系 2');
  await expect(fixture.locator('#sent-count')).toHaveText('2');
  const options = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
  expect(options.path).toBe('sidepanel.html');
  await fixture.getByRole('button', { name: '模拟 HR 消息' }).click();
  await expect(panel.getByRole('button', { name: '打开对应聊天' })).toHaveCount(0);
  await fixture.getByRole('button', { name: '模拟一位候选人回复' }).click();
  await expect(panel.getByRole('button', { name: '打开对应聊天' })).toHaveCount(1);
  await panel.getByRole('button', { name: '打开对应聊天' }).click();
  await expect(fixture.locator('#chat')).toBeVisible();
  await expect(fixture.locator('#chat')).toContainText('mock-c2');
  // 重排后先处理 c2，回复按 ID 打开，不能被同名 c1 覆盖。
  const data = await worker.evaluate(async () => {
    const request = indexedDB.open('xinmei-hr-mock-v1', 1);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    return [...db.objectStoreNames];
  });
  expect(data).toEqual(['operations', 'runs']); expect(errors).toEqual([]);
});
test('回执丢失→UNKNOWN→核对→恢复，不重复发送；刷新侧栏保留状态', async () => {
  await fixture.getByText('故障注入（仅合成环境）').click();
  await fixture.locator('#lost').check(); await start();
  await expect(panel.locator('#status')).toHaveText('已暂停');
  await expect(fixture.locator('#sent-count')).toHaveText('1');
  await panel.getByRole('button', { name: '继续', exact: true }).click();
  await expect(panel.locator('#error')).toContainText('请先核对回执');
  await panel.reload(); await expect(panel.locator('#status')).toHaveText('已暂停');
  await fixture.locator('#lost').uncheck();
  await panel.getByRole('button', { name: '核对未知回执' }).click();
  await panel.getByRole('button', { name: '继续', exact: true }).click(); await waiting();
  await expect(fixture.locator('#sent-count')).toHaveText('2');
});
test('岗位切换后不能把旧任务用于新岗位', async () => {
  await fixture.getByText('故障注入（仅合成环境）').click();
  await fixture.locator('#lost').check(); await start(); await expect(panel.locator('#status')).toHaveText('已暂停');
  await panel.getByRole('button', { name: '核对未知回执' }).click();
  await fixture.locator('#job').selectOption('mock-content');
  await panel.getByRole('button', { name: '继续', exact: true }).click();
  await expect(panel.locator('#error')).toContainText('岗位已切换');
  await expect(panel.locator('#status')).toHaveText('已暂停'); await expect(fixture.locator('#sent-count')).toHaveText('1');
});
test('强制终止 Worker，重新唤醒不丢账本且不重复发送', async () => {
  await start(); await waiting();
  const cdp = await context.newCDPSession(panel);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await panel.reload(); await expect(panel.locator('#status')).toHaveText('等待候选人回复');
  await expect(panel.locator('#metrics')).toContainText('联系 2');
  await expect(fixture.locator('#sent-count')).toHaveText('2');
  await cdp.detach();
});
test('读取详情期间终止 Worker，恢复先暂停，显式继续从检查点推进', async () => {
  await fixture.getByText('故障注入（仅合成环境）').click();
  await fixture.locator('#hold-resume').check();
  await start();
  await expect(fixture.locator('#resume')).toHaveAttribute('data-requested', 'mock-c1');
  // 测试中使用 CDP 只终止本地合成扩展的 Worker。
  const cdp = await context.newCDPSession(panel);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await panel.reload();
  await expect(panel.locator('#status')).toHaveText('已暂停');
  await expect(panel.locator('#reason')).toHaveText('WORKER_RESTARTED');
  await expect(fixture.locator('#sent-count')).toHaveText('0');
  await fixture.getByRole('button', { name: '释放详情加载' }).click();
  await panel.getByRole('button', { name: '继续', exact: true }).click();
  await waiting(); await expect(fixture.locator('#sent-count')).toHaveText('2');
  await cdp.detach();
});
