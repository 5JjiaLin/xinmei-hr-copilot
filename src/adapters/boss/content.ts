import { BossDomDriver } from './dom-driver';
import type { BossCommand } from './protocol';

// executeScript 可重复注入；每个文档只注册一个隔离世界监听器。
const scope = globalThis as typeof globalThis & { __hrBossInstalled?: boolean };
if (!scope.__hrBossInstalled) {
  scope.__hrBossInstalled = true;
  const driver = new BossDomDriver(document);
  chrome.runtime.onMessage.addListener((raw: BossCommand, sender, respond) => {
    if (sender.id !== chrome.runtime.id || raw?.channel !== 'hr-boss-v1') return;
    void driver.execute(raw).then(data => respond({ ok: true, data })).catch(error =>
      respond({ ok: false, error: error instanceof Error ? error.message : 'DOM_FAILED' }));
    return true;
  });
}
