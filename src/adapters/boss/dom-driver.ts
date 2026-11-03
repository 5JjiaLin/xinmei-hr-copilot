import { sameIdentity, type BossCommand, type BossIdentity, type BossProbe } from './protocol';

// 只读 DOM 属性和链接，不读取 Cookie、Vue 私有对象或调用站点接口。
const cardSelector = 'li.geek-card, .geek-card-wrap, .geek-card, [data-candidate-card]';
const dialogSelector = '.resume-dialog, .resume-preview, .geek-detail-dialog, [role="dialog"][data-resume]';
const candidateAttrs = ['data-encrypt-geek-id', 'data-geek-id', 'data-geekid', 'data-geek'];
const jobSelector = '[data-current-job-id], .job-select [data-job-id].selected, .job-select [data-job-id][aria-selected="true"], select[data-job-select]';
const accountSelector = '[data-account-id], [data-boss-id], .user-info[data-user-id]';
const identityAttrs = ['data-current-job-id', 'data-job-id', 'data-account-id', 'data-boss-id', 'data-user-id', 'value', 'aria-selected', 'class'];
const visible = (el: Element): el is HTMLElement => {
  const rect = el.getBoundingClientRect();
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
};
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
function fail(reason: string): never { throw new Error(reason); }
function documents(doc: Document): Document[] {
  const docs = [doc]; let win: Window = doc.defaultView!;
  while (win.parent !== win) {
    try { const parent = win.parent.document; docs.push(parent); win = win.parent; }
    catch { break; }
  }
  return docs;
}
function idOf(root: Element): string | undefined {
  const ids = new Set<string>();
  for (const el of [root, ...root.querySelectorAll(candidateAttrs.map(a => `[${a}]`).join(','))]) {
    for (const attr of candidateAttrs) { const id = el.getAttribute(attr); if (id) ids.add(id); }
  }
  for (const anchor of root.querySelectorAll('a[href]')) {
    const url = new URL(anchor.getAttribute('href')!, root.ownerDocument.baseURI);
    for (const key of ['encryptGeekId', 'geekId']) { const id = url.searchParams.get(key); if (id) ids.add(id); }
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}
function unique(elements: Element[], code: string): HTMLElement {
  const found = elements.filter(visible);
  return found.length === 1 ? found[0]! : fail(code);
}
function button(root: Element, labels: string[]): HTMLElement | undefined {
  const matches = [...root.querySelectorAll('button, a, [role="button"]')].filter(el => visible(el) && labels.includes(text(el)));
  return matches.length === 1 ? matches[0] as HTMLElement : undefined;
}
function scrollArea(root: Element, includeParents: boolean): HTMLElement {
  const scrollable = (el: Element) => visible(el) && el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(el.ownerDocument.defaultView!.getComputedStyle(el).overflowY);
  if (scrollable(root)) return root as HTMLElement;
  if (includeParents) {
    let el = root.parentElement;
    while (el) { if (scrollable(el)) return el; el = el.parentElement; }
    return root.ownerDocument.scrollingElement as HTMLElement;
  }
  const found = [...root.querySelectorAll('*')].filter(scrollable);
  // 嵌套滚动区域取包含正文的最大区域；多个并列区域必须人工适配。
  const outer = found.filter(el => !found.some(other => other !== el && other.contains(el)));
  if (outer.length > 1) return fail('RESUME_SCROLL_AMBIGUOUS');
  return (outer[0] ?? root) as HTMLElement;
}

export class BossDomDriver {
  private lease?: { session: string; identity: BossIdentity; controller: AbortController; route: string };
  private observers: MutationObserver[] = [];
  private identityNodes: Element[] = [];
  private busy = false;
  private clicks = new Set<string>();
  private position?: { area: HTMLElement; top: number };
  private docs: Document[];
  constructor(private doc: Document) {
    this.docs = documents(doc);
    for (const item of this.docs) {
      // 人工在被控页面点击、滚轮、键盘操作即让出控制；侧栏操作不在这些文档里。
      for (const event of ['pointerdown', 'wheel', 'keydown', 'change']) item.addEventListener(event, e => {
        if (e.isTrusted) this.cancel('MANUAL_INTERVENTION');
      }, { capture: true, passive: true });
      item.defaultView!.addEventListener('pagehide', () => this.cancel('DOCUMENT_CHANGED'));
      const observer = new MutationObserver(records => this.changed(records));
      observer.observe(item.documentElement, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
      this.observers.push(observer);
    }
  }
  private route() { return this.docs.map(d => d.location.href).join('|'); }
  private identity(): BossIdentity {
    const accounts = this.docs.flatMap(d => [...d.querySelectorAll(accountSelector)]);
    const jobs = this.docs.flatMap(d => [...d.querySelectorAll(jobSelector)]);
    const values = (nodes: Element[], attrs: string[]) => new Set(nodes.map(el => {
      if (el.tagName === 'SELECT') return (el as HTMLSelectElement).value;
      return attrs.map(a => el.getAttribute(a)).find(Boolean);
    }).filter((v): v is string => !!v));
    const account = values(accounts, ['data-account-id', 'data-boss-id', 'data-user-id']);
    const job = values(jobs, ['data-current-job-id', 'data-job-id']);
    this.identityNodes = [...accounts, ...jobs];
    if (account.size !== 1) return fail('ACCOUNT_ID_UNAVAILABLE');
    if (job.size !== 1) return fail('JOB_ID_UNAVAILABLE');
    return { account: [...account][0]!, job: [...job][0]! };
  }
  private changed(records: MutationRecord[]) {
    if (!this.lease || this.lease.controller.signal.aborted) return;
    const nodes = this.identityNodes;
    // oldValue 能识别同一 JS 回合内 A→B→A，不能只比较最终字符串。
    const touched = records.some(r => (r.type === 'attributes' && nodes.includes(r.target as Element) && identityAttrs.includes(r.attributeName!)) ||
      (r.type === 'childList' && [...r.removedNodes].some(n => nodes.some(el => n === el || n.contains(el)))));
    try {
      if (touched || this.route() !== this.lease.route || !sameIdentity(this.lease.identity, this.identity())) this.cancel('IDENTITY_CHANGED');
    } catch { this.cancel('IDENTITY_CHANGED'); }
  }
  private risk() {
    for (const doc of this.docs) {
      if ([...doc.querySelectorAll('.geetest_panel, .captcha-container, [data-risk], .risk-dialog')].some(visible)) fail('RISK_BLOCKED');
      const alerts = [...doc.querySelectorAll('[role="alert"], [role="dialog"], .dialog-wrap, .toast')].filter(visible);
      if (alerts.some(el => /安全验证|操作频繁|今日.*上限|额度不足|开通.*权益|账号异常|重新登录/.test(text(el)))) fail('RISK_BLOCKED');
    }
  }
  private cards(): HTMLElement[] {
    const candidates = [...this.doc.querySelectorAll(cardSelector)].filter(visible);
    return candidates.filter(el => !candidates.some(parent => parent !== el && parent.contains(el))) as HTMLElement[];
  }
  probe(): BossProbe {
    const cards = this.cards();
    const base = { cards: cards.length, identified: cards.filter(el => idOf(el)).length };
    try {
      this.risk(); const identity = this.identity();
      if (!cards.length) fail('LIST_NOT_FOUND');
      if (base.identified !== cards.length) fail('CANDIDATE_ID_UNAVAILABLE');
      return { ...base, supported: true, reason: 'READY', identity };
    } catch (error) { return { ...base, supported: false, reason: (error as Error).message }; }
  }
  cancel(reason = 'CANCELLED') { this.lease?.controller.abort(new Error(reason)); }
  private check(command: BossCommand) {
    for (const observer of this.observers) this.changed(observer.takeRecords());
    const lease = this.lease;
    if (!lease || lease.session !== command.session) fail('SESSION_EXPIRED');
    if (lease.controller.signal.aborted) throw lease.controller.signal.reason;
    if (Date.now() >= command.deadline) fail('COMMAND_EXPIRED');
    if (this.route() !== lease.route || !sameIdentity(lease.identity, this.identity())) fail('IDENTITY_CHANGED');
    if (this.docs.some(d => d.visibilityState === 'hidden')) fail('PAGE_NOT_VISIBLE');
    this.risk();
  }
  private async wait<T>(command: BossCommand, condition: () => T | undefined, timeout = 4000): Promise<T> {
    const end = Math.min(command.deadline, Date.now() + timeout);
    while (true) {
      this.check(command); const value = condition(); if (value !== undefined) return value;
      if (Date.now() >= end) fail('DOM_TIMEOUT');
      const signal = this.lease!.controller.signal;
      await new Promise<void>((resolve, reject) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(); };
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        const timer = setTimeout(finish, 80); signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
  private async settle(command: BossCommand, root: HTMLElement) {
    let signature = ''; let since = Date.now(); const start = since;
    await this.wait(command, () => {
      const next = `${root.scrollHeight}:${root.scrollTop}:${root.textContent}`;
      if (next !== signature) { signature = next; since = Date.now(); }
      return Date.now() - since >= 320 && Date.now() - start >= 400 ? true : undefined;
    }, 3000);
  }
  private card(id: string) { return unique(this.cards().filter(el => idOf(el) === id), 'CANDIDATE_NOT_UNIQUE'); }
  private dialogs() {
    const matches = this.docs.flatMap(d => [...d.querySelectorAll(dialogSelector)]).filter(visible);
    return matches.filter(el => !matches.some(parent => parent !== el && parent.contains(el)));
  }
  private detail(id: string) {
    const detail = unique(this.dialogs(), 'RESUME_NOT_UNIQUE');
    if (idOf(detail) !== id) fail('RESUME_ID_MISMATCH');
    return detail;
  }
  async execute(command: BossCommand): Promise<unknown> {
    if (command.action === 'probe') return this.probe();
    if (command.action === 'cancel') { if (this.lease?.session === command.session) this.cancel(); return; }
    if (this.busy) fail('PAGE_BUSY');
    if (command.action === 'begin') {
      if (Date.now() >= command.deadline) fail('COMMAND_EXPIRED');
      const probe = this.probe();
      if (!probe.supported || !probe.identity) fail(probe.reason);
      if (!command.identity || !sameIdentity(probe.identity, command.identity)) fail('IDENTITY_CHANGED');
      this.cancel();
      this.lease = { session: command.session, identity: probe.identity, controller: new AbortController(), route: this.route() };
      return;
    }
    this.busy = true;
    try {
      this.check(command);
      const id = command.candidate;
      switch (command.action) {
        case 'next': {
          if (this.dialogs().length) fail('CLOSE_RESUME_FIRST');
          const seen = new Set(command.seen ?? []);
          const scan = () => {
            for (const card of this.cards()) {
              const candidate = idOf(card); if (!candidate) fail('CANDIDATE_ID_UNAVAILABLE');
              const rect = card.getBoundingClientRect();
              const area = scrollArea(card, true);
              const clip = area === this.doc.scrollingElement ? { top: 0, bottom: this.doc.defaultView!.innerHeight } : area.getBoundingClientRect();
              if (rect.bottom > clip.top && rect.top < clip.bottom && !seen.has(candidate)) return candidate;
            }
            return undefined;
          };
          let candidate = scan(); if (candidate) return { candidate, scrolled: false };
          const cards = this.cards(); if (!cards.length) fail('LIST_NOT_FOUND');
          const area = scrollArea(cards[0]!, true);
          this.check(command); area.scrollBy({ top: Math.max(100, area.clientHeight * .75), behavior: 'instant' });
          await this.settle(command, area); candidate = scan();
          const end = area.scrollTop + area.clientHeight >= area.scrollHeight - 3 &&
            [...this.doc.querySelectorAll('.list-bottom, .no-more, [data-list-end]')].some(el => visible(el) && /没有更多|已到底|全部加载|没有合适/.test(text(el)));
          return { ...(candidate ? { candidate } : {}), scrolled: true, end };
        }
        case 'open': {
          if (!id) fail('CANDIDATE_REQUIRED');
          if (this.dialogs().length) { this.detail(id); return; }
          const card = this.card(id); const area = scrollArea(card, true);
          this.position = { area, top: area.scrollTop };
          const name = unique([...card.querySelectorAll('.name, .geek-name, [data-open-resume]')], 'RESUME_LINK_UNAVAILABLE');
          this.check(command); name.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          this.check(command); name.click();
          await this.wait(command, () => this.dialogs().length ? this.detail(id) : undefined);
          return;
        }
        case 'read': {
          if (!id) fail('CANDIDATE_REQUIRED');
          const root = this.detail(id); const area = scrollArea(root, false); const fragments = new Set<string>();
          this.check(command); area.scrollTo({ top: 0, behavior: 'instant' });
          for (let i = 0; i < 40; i++) {
            await this.settle(command, area); this.detail(id);
            // 只在当前调用内暂存，不向后台、日志、外部模型传递简历全文。
            fragments.add((area.innerText || text(area)).slice(0, 100_000));
            const bottom = area.scrollTop + area.clientHeight >= area.scrollHeight - 3;
            if (bottom) return { characters: [...fragments].join('\n').length, scrolls: i, reachedBottom: true };
            this.check(command); area.scrollBy({ top: Math.max(100, area.clientHeight * .75), behavior: 'instant' });
          }
          fail('RESUME_SCROLL_LIMIT');
        }
        case 'greet': {
          if (!id) fail('CANDIDATE_REQUIRED');
          const root = this.detail(id);
          if (button(root, ['继续沟通', '已沟通'])) return { status: 'ALREADY_CONTACTED' };
          const key = `${this.lease!.identity.account}:${id}`;
          if (this.clicks.has(key)) return { status: 'UNKNOWN' };
          const greet = button(root, ['打招呼']);
          if (!greet || greet.matches(':disabled, [aria-disabled="true"]')) fail('GREETING_UNAVAILABLE');
          this.check(command); this.detail(id); this.clicks.add(key); greet.click();
          try {
            await this.wait(command, () => {
              const detail = this.detail(id);
              return button(detail, ['继续沟通', '已沟通']) ? true : undefined;
            }, 4500);
            return { status: 'CONFIRMED' };
          } catch { return { status: 'UNKNOWN' }; }
        }
        case 'close': {
          if (!id) fail('CANDIDATE_REQUIRED');
          if (!this.dialogs().length) return;
          const root = this.detail(id);
          const close = unique([...root.querySelectorAll('[aria-label="关闭"], .close, .icon-close, [data-close-resume]')], 'CLOSE_BUTTON_UNAVAILABLE');
          this.check(command); close.click();
          await this.wait(command, () => this.dialogs().length === 0 ? true : undefined);
          const pos = this.position;
          if (pos?.area.isConnected) { this.check(command); pos.area.scrollTo({ top: pos.top, behavior: 'instant' }); }
          return;
        }
      }
    } finally { this.busy = false; }
  }
}
