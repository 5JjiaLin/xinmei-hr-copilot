# 新美九天 · AI HR Copilot

首个可运行垂直切片：本地合成招聘页 + MV3 后台任务 + Side Panel。
没有真实 BOSS 访问权限，没有外部 AI 请求，也没有真实消息发送实现。

## 构建与加载

需要 Node.js 24 / npm（本机验证：Node 24.14.1、npm 11.11.0）。

```bash
cd /Users/jjia/Desktop/HR
npm ci --ignore-scripts
npm run build
```

1. 在 Edge 打开 `edge://extensions`，开启「开发人员模式」。
2. 点击「加载解压缩的扩展」，选择 `/Users/jjia/Desktop/HR/dist`。
3. 点击扩展图标打开侧栏，点击「打开模拟招聘页」。只开一个模拟页。
4. 在模拟页手选岗位；侧栏默认 JD 为两行：`海外社媒运营`、`增长项目`。
5. 点击「开始执行」，看到扫描 10 人、读取/深筛 3 人、联系 2 人。
6. 在模拟页点「模拟一位候选人回复」，侧栏出现「打开对应聊天」。点击后 HR 接管，不再自动聊天。

`npm run dev` 只监听 TypeScript 并重建脚本；修改 HTML/CSS 后重新执行 build。
修改扩展代码后，在扩展管理页点重新加载，再刷新模拟页、重新打开侧栏。
MOCK JD 仅作逐行能力短语匹配，不是通用语义理解器。

## 可靠性演示

- 模拟页展开「故障注入」，选中「已发送但回执丢失」，开始任务：账本写 UNKNOWN，任务暂停。直接继续会拒绝；先「核对未知回执」，再继续，不重发。
- 切换岗位/账号后，旧任务不能继续。切回原身份再恢复。
- 点击「重排同名候选人」再运行，动作始终按稳定候选人 ID 绑定。
- 「暂缓详情加载」可挂起详情，终止 Worker 后重新唤醒会先暂停。释放详情并继续后安全恢复。
- 侧栏关闭不等于停止；请使用暂停/停止。浏览器关闭时不承诺持续运行或即时回复通知。
- 重复模拟标签页只允许首个持有本地锁的页面执行；关闭重复页后使用原页。

状态保存在 IndexedDB `xinmei-hr-mock-v1` 的 `runs` / `operations` 中，JD 草稿保存在
`chrome.storage.local`，合成外部回执单独保存在模拟页 localStorage。
停止后可通过侧栏删除本地任务/账本；清除全部扩展数据或卸载可删除合成页面回执。
当前只保留一个活动任务，日志最多 300 条；简历分析完成后移除全文，仅留证据与 hash。
本版不适用于真实个人信息，不提供生产保留期限和历史任务管理。

## 验证

```bash
npm run check
npm run test:e2e
npm audit
```

E2E 使用隔离浏览器配置，只对本地扩展合成页运行。默认优先使用本机已缓存的 macOS ARM
Chromium；没有缓存时使用 Playwright 的 Chromium（先 `npx playwright install chromium`）。
未在生产平台使用 Playwright/CDP。测试产生的临时浏览器配置在结束时删除。

实际结果、已知限制和下一步见 [验收记录](docs/validation.md)，
上游与依赖盘点见 [审查记录](docs/upstream-review.md)。

## 模块

- `src/ui/`：只发送命令、显示任务和回复。
- `src/entries/background/`：Worker 消息处理、串行调度和恢复入口。
- `src/orchestrator/`：唯一业务推进者、岗位/账号身份门禁、发送状态与检查点。
- `src/adapters/contracts/`：页面、招呼、回复接口。
- `src/adapters/mock/`：10 人合成页面、模拟回执与故障注入。
- `src/ai/`：假模型、Zod 校验、逐项原文证据门禁。
- `src/storage/`：IndexedDB 原子事务与 revision CAS。

真实适配器未实现，不能通过环境变量或设置切换到真实执行。
