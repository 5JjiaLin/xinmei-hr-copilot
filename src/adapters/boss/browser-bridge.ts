import type { BossCommand, BossPort, BossProbe, BossState, BossStore, BossTarget } from './protocol';

export class BossBrowserBridge implements BossPort {
  async call<T>(target: BossTarget, command: BossCommand): Promise<T> {
    if (command.action !== 'cancel') {
      const tab = await chrome.tabs.get(target.tabId);
      if (!tab.active || !tab.url?.startsWith('https://www.zhipin.com/')) throw new Error('TARGET_TAB_INACTIVE');
      const win = await chrome.windows.get(tab.windowId);
      if (!win.focused) throw new Error('TARGET_TAB_INACTIVE');
    }
    const response = await chrome.tabs.sendMessage(target.tabId, command, { documentId: target.documentId }) as { ok: boolean; data: T; error?: string };
    if (!response?.ok) throw new Error(response?.error ?? 'PAGE_DISCONNECTED');
    return response.data;
  }
  async connect(): Promise<{ target?: BossTarget; probe: BossProbe }> {
    if (!await chrome.permissions.contains({ origins: ['https://www.zhipin.com/*'] })) throw new Error('HOST_PERMISSION_REQUIRED');
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined || !tab.url?.startsWith('https://www.zhipin.com/web/')) throw new Error('OPEN_BOSS_RECOMMEND');
    const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['boss-content.js'] });
    const results = await Promise.all(frames.map(async frame => {
      const target = { tabId: tab.id!, frameId: frame.frameId, documentId: frame.documentId };
      if (!target.documentId) return undefined;
      try { return { target, probe: await this.call<BossProbe>(target, { channel: 'hr-boss-v1', action: 'probe', session: '', deadline: Date.now() + 5000 }) }; }
      catch { return undefined; }
    }));
    const candidates = results.filter((r): r is NonNullable<typeof r> => !!r && r.probe.cards > 0);
    if (candidates.length !== 1) return { probe: { supported: false, reason: candidates.length ? 'MULTIPLE_LISTS' : 'LIST_NOT_FOUND', cards: 0, identified: 0 } };
    return candidates[0]!;
  }
}
export class BossLocalStore implements BossStore {
  async load(): Promise<BossState> {
    const data = await chrome.storage.local.get('bossOperationsV1');
    return (data.bossOperationsV1 as BossState | undefined) ?? { ledger: {} };
  }
  async save(state: BossState) { await chrome.storage.local.set({ bossOperationsV1: state }); }
}
