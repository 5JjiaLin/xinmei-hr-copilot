# 新美九天 · AI HR Copilot

Edge / Chromium MV3 招聘辅助扩展。v0.2 增加 BOSS 页面操作层：滚动候选列表、
打开简历、滚动详情、可选原生打招呼、关闭详情返回列表并继续下一位。

**操作层已通过合成页面测试；尚未在真实 BOSS 当前页面和 Edge 实机完成验收。**
页面缺少可核验的账号/岗位/候选人 ID 或结构不匹配时，会显示诊断并暂停。
详细筛选规则、真实 AI 和真实回复提醒尚未接入。

## 构建与加载

不需要修改源码时，可从 [v0.2.0 操作验证版](https://github.com/5JjiaLin/xinmei-hr-copilot/releases/tag/v0.2.0)
下载 `xinmei-hr-copilot-v0.2.0-extension.zip`，解压后加载含 `manifest.json` 的文件夹，无需安装 Node.js。
这个预发布包尚未完成真实 BOSS 页面和 Edge 实机验收。

需要 Node.js / npm，已验证 Node 24.14.1、npm 11.11.0。

```bash
git clone https://github.com/5JjiaLin/xinmei-hr-copilot.git
cd xinmei-hr-copilot
npm ci --ignore-scripts
npm run build
```

1. Edge 打开 `edge://extensions`，开启开发人员模式，加载项目中的 `dist` 文件夹。
2. 已装旧版则点“重新加载”，随后刷新 BOSS 页面并重新打开扩展侧栏。
3. 在当前浏览器登录 BOSS 招聘端，打开“推荐牛人”，人工选择岗位。
4. 点击扩展图标，侧栏选择“连接当前 BOSS 页面”，允许浏览器弹出的该网站访问权限。
5. 先保留默认“只浏览简历”，本批人数设为 3，点击“开始页面操作”。
6. 验证打开、滚动、关闭和继续操作正确后，可选择“浏览并逐一打招呼（不筛选）”。
   此模式对本批打开的人逐一点击原生招呼，不根据下方演示 JD 判断匹配；已联系者跳过。

正常操作无需逐人批准，不等待回复。每批最多 20 人。
暂停/停止会取消后续操作；已经发生的点击不能撤回。
在 BOSS 页面手动点击、滚轮或键盘操作会让任务暂停，切回绑定页面后可点“继续操作”。
保持 BOSS 标签页在前台；关闭侧栏不会停止任务，关闭浏览器或后台回收会暂停恢复。

`npm run dev` 监听源码；HTML/CSS/manifest 改动后重新 build。
没有对真实账号使用 Playwright/CDP，不拦截私有 API、不读取 Cookie、不绕过验证或平台限额。

## 页面诊断

| 提示 | 含义与处理 |
|---|---|
| `ACCOUNT_ID_UNAVAILABLE` / `JOB_ID_UNAVAILABLE` | 当前 DOM 不提供适配器支持的稳定身份，需要根据该页面继续适配；输入名称不能替代 ID |
| `CANDIDATE_ID_UNAVAILABLE` / `RESUME_ID_MISMATCH` | 卡片或详情身份无法核验，暂停避免串人 |
| `LIST_NOT_FOUND` | 未找到列表，先确认“推荐牛人”已加载 |
| `LIST_STALLED` | 滚动后无新卡片，不能确定已到底；检查页面后继续 |
| `SEND_UNKNOWN` | 已点击但未观察到可靠结果，不重发；到页面核对并停止本批 |
| `PAGE_DISCONNECTED` | 原文档已刷新/关闭；停止旧批次，再连接新页面 |
| `RISK_BLOCKED` | 存在验证、额度或风险提示，暂停由 HR 处理 |

跨域 iframe、页面未公开稳定 ID、仅接受可信输入的控件、不同版本的简历弹层，可能需要进一步适配。
选择器集中在 `src/adapters/boss/dom-driver.ts`；不能凭合成页面通过就宣称真实页面兼容。

## 数据与恢复

真实操作任务保存在 `chrome.storage.local` 的 `bossOperationsV1`：页面定位、账号/岗位/
候选人 ID、进度及短日志，不保存姓名、联系方式或简历全文，也不上传外部 AI。
账号+候选人 SHA-256 用于防重复账本，跨岗位生效。
点击前保存 `SENDING`，未知结果记为 `UNKNOWN`；未知记录不会自动清除或重新发送。
已联系状态按同一候选人详情的原生按钮变化核验，不把点击本身当成功。
停止后可删除操作任务，保留防重复账本；卸载扩展或清空扩展存储会删除全部本地记录。
页面刷新后不能把旧任务转移到新文档；Worker 重启也不会自动续发。

## 合成筛选演示

侧栏下方保留原 MOCK 演示：打开模拟招聘页，选岗位，使用默认两行 JD，点击“开始执行”。
10 位合成人选中 3 人深筛、2 人模拟招呼、1 人模拟回复后交 HR。假模型只做字面匹配。
真实页面操作和此演示分别记录任务，不能同时运行；真实规则不会取自假模型。
旧演示的回复监测仍依赖侧栏轮询，历史回复游标与完整任务历史尚未实现。

## 验证与模块

```bash
npm run check
npm run test:e2e
```

浏览器测试使用隔离配置和合成数据；BOSS 域名请求在测试中全部本地拦截，不接触真实账号。
支持现有 macOS ARM Chromium 缓存，其他环境可先 `npx playwright install chromium`。
测试生成的临时浏览器配置会清理。

- `src/adapters/boss/`：DOM 定位、身份与期限校验、取消和真实标签页桥接。
- `src/orchestrator/boss-operations.ts`：真实操作循环与防重复账本。
- `src/orchestrator/task-runner.ts`、`src/adapters/mock/`：原合成筛选与回复演示。
- `src/ui/`：侧栏命令和状态；`src/storage/`：原演示 IndexedDB 仓储。

本次验收见 [操作层验证](docs/operations-validation.md)，历史记录见 [MOCK 验收](docs/validation.md)，
参考工程与许可见 [第三方说明](THIRD_PARTY_NOTICES.md)。尚未发布 Edge 商店。
