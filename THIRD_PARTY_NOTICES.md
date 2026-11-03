# 第三方来源与许可

## Polaris119/boss-job-analyzer

- 来源：https://github.com/Polaris119/boss-job-analyzer
- 固定审查版本：`c95108a2ccaf48da84d86c10ac6f154f2b4e6219`
- 许可证：MIT，完整文本见 `third_party/POLARIS_LICENSE`。
- 本项目沿用 MV3 Side Panel / Service Worker 原生模块架构，并基于其
  `src/platform/indexeddb/task-repository.mjs` 的事务仓储模式改造
  `src/storage/repository.ts`。改造包括招聘任务结构、revision CAS、发送账本原子提交。
- 未引入求职简历编辑、PDF.js、学习路线、BOSS Content Script、远程 AI 请求及 API Key 存储逻辑。
- 上游没有单独 NOTICE。原库 vendored PDF.js 为 Apache-2.0，本项目未复制和打包该组件。
- 首个 MOCK 切片未复制其他计划工程；未引入 GPL 代码。

## 1xiaoyueryuer/boss-hr-agent-toolkit（v0.2 行为参考）

- 来源：https://github.com/1xiaoyueryuer/boss-hr-agent-toolkit
- 审查版本：`22626327006c667dfcdd6d7707298068721cff02`，MIT，Copyright (c) 2026 yuyu。
- 只阅读候选卡片 DOM 属性、链接参数和原生招呼按钮的线索；本项目独立实现 DOM 适配器。
- 未复制源码、安装脚本、API 调用、姓名兜底、随机拟人行为、评分规则或登录数据。
- 参考实现不能证明当前 BOSS 页面与本适配器兼容，需真实页面单独验证。

## npm 依赖

| 依赖 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| zod | 4.6.7 | MIT | 运行时筛选结果 schema 校验 |
| esbuild | 0.28.2 | MIT | 构建 |
| tsx | 4.23.15 | MIT | 执行 TypeScript 单元测试 |
| typescript | 5.9.3 | Apache-2.0 | 类型检查 |
| @playwright/test | 1.58.2 | Apache-2.0 | 本地合成扩展 E2E |
| fake-indexeddb | 6.2.4 | Apache-2.0 | 单元测试中的 IndexedDB |
| @types/chrome | 0.1.37 | MIT | 浏览器类型 |
| @types/node | 24.10.1 | MIT | 测试/构建类型 |

间接依赖以 `package-lock.json` 为准。构建时复制生产依赖 Zod 的完整 LICENSE、
本 NOTICE 与 Polaris MIT 到 `dist/third_party/`。开发工具不进入扩展运行包。
