# agent.md — AI HR 自动招聘助手开发指令

> 项目：新美九天 · AI HR Copilot  
> 平台：Microsoft Edge（Chromium / Manifest V3）  
> 版本：V1.0  
> 配套实施计划：`plan.md`

## 当前迭代覆盖说明（2026-11-03）

用户已明确公司与招聘账号授权，并指示不将平台许可文件作为本次开发前置条件。
本次范围为真实页面 DOM 操作层：滚动列表、打开/滚动/关闭简历、原生打招呼、继续下一位。
以下历史文档中“未提供授权只能 MOCK”的开发门禁不再阻塞本次范围；验证码、额度、风控仍必须暂停。
详细筛选规则后续配置：真实页面默认只浏览，显式选择“逐一打招呼”时不做匹配判断，不用假模型判断真人。
本迭代真实页面兼容性与 Edge 实机验收仍待验证；不得将合成测试结果当作真实验收。

## 0. 角色与执行方式

你是本项目的主开发 Agent，负责设计、编码、测试、记录和迭代。按照 `plan.md` 的阶段顺序执行。开发目标是一个可维护、可测试、可恢复的 Edge 浏览器扩展，不是依赖大模型反复截图、思考并模拟鼠标的通用 Computer Use Agent。

**开发约束：**

1. 先检查仓库结构、现有实现、许可协议与测试，再修改代码。不得先大规模重写。
2. 每次只交付一个可运行、可测试的垂直切片；小步提交，保证随时可回退。
3. 对外部平台的真实数据访问和消息发送，必须经过明确的平台授权与公司内部审批；未满足时仅在模拟页面或授权测试环境执行。
4. 正常业务目标是 **HR 选岗位 → 输入 JD → 点击执行 → 自动筛选 → 自动打招呼 → HR 仅处理回复**。不得擅自改成每位候选人都需要 HR 手动批准；异常、身份不明和权限不明时必须安全暂停。
5. 不得为完成需求绕过验证码、反爬、限流、风控、付费限制或未经公开授权的接口限制；不开发隐藏自动化指纹、随机拟人对抗、代理池等规避机制。
6. 未经批准，不向外部 LLM 发送真实简历、聊天记录、联系方式或其他个人信息。开发与测试默认使用合成/脱敏数据。
7. 代码和文档全部以中文说明；代码命名使用清晰英文。只为真实需求引入依赖，不增加无关微服务和复杂基础设施。

## 1. 产品目标与非目标

### 1.1 目标

- HR 在 BOSS 直聘招聘端**人工选定当前岗位**，在 Edge 插件侧栏录入或粘贴岗位 JD。
- 点击一次“开始执行”，插件冻结当前岗位标识与 JD 版本，并启动任务。
- 合法授权接入后，读取当前岗位下候选人卡片，AI 先做简介初筛。
- 对通过初筛的候选人读取完整简历，再做第二轮证据化分析。
- 对通过发送门禁的候选人，使用**平台允许的打招呼机制**自动建立沟通并核验结果；成功后等待回复。
- HR 不介入正常筛选流程，只在候选人回复后打开聊天框交流，或处理明确的异常警报。
- 提供任务暂停/恢复/停止、进度、去重、操作日志、模型成本和异常诊断。

### 1.2 暂不做

- 自动与候选人多轮对话、自动安排面试、自动拒绝候选人。
- 履历互联网真实性核验（列入下一阶段）。
- 多招聘账号协同、云端管理后台、跨浏览器同步。
- 关闭 Edge 后的无人值守运行；纯插件无法保证浏览器关闭后继续执行。
- 以年龄、性别、头像、婚育、籍贯等与岗位能力无关的属性评分或过滤。
- 为了提高发送量而规避平台限制。

## 2. 开源基础及许可证

主要工程参考：

- **Fork 主工程**：[Polaris119/boss-job-analyzer](https://github.com/Polaris119/boss-job-analyzer)，MIT。尽量复用 MV3、Side Panel、后台 AI 请求、任务仓储、IndexedDB 框架；删除与本产品无关的求职简历编辑/学习路线等业务。
- **参考自动化架构**：[gstranded/autocast-boss-assistant](https://github.com/gstranded/autocast-boss-assistant)，MIT。参考状态机、检查点、去重、发送结果验证、暂停恢复；不要整仓混合。
- **仅阅读研究招聘端行为**：[joohw/boss-cli](https://github.com/joohw/boss-cli)，GPL-3.0。可用来理解 `recommendFrame`、候选人卡片、简历预览等技术难点，**不得直接复制 GPL 代码到闭源目标工程**；如确需复用，先完成许可证审查。
- **参考业务拆解**：[1xiaoyueryuer/boss-hr-agent-toolkit](https://github.com/1xiaoyueryuer/boss-hr-agent-toolkit)，MIT。可借鉴简历净化与评测结构；不要盲目使用其固定学历/学校层级打分模型。

先执行依赖/许可盘点，保留第三方 NOTICE / License。禁止未经审查直接运行开源仓库中的安装脚本、登录脚本或自动发送脚本。

## 3. 项目架构不变量

采用下面的清晰分层；禁止在 UI 组件中直接抓取页面或执行打招呼。

```text
Side Panel (UI)
   ↓ Command / Event
Orchestrator (state machine + checkpoint)
   ├── Browser Adapter (observe / locate / extract / verify)
   ├── AI Screening Engine (JD / profile / resume / evidence)
   ├── Authorized Greeting Adapter (send / verify / unknown)
   └── Reply Handoff (detect / notify / open conversation)
   ↓
IndexedDB + chrome.storage.local
```

### 3.1 模块分工

- `ui/`：岗位输入、当前任务状态、停止/暂停按钮、回复提醒和诊断。
- `adapters/boss/`：负责识别当前岗位、读候选人、读简历、感知页面状态。**以抽象接口实现，便于更换后端适配器。**
- `orchestrator/`：唯一业务状态推进者，任何网页动作都要先过状态机和校验门禁。
- `ai/`：只接收最小化、结构化的候选人材料，返回 schema 校验后的 JSON；不能直接发起网页操作。
- `greeting/`：只有通过授权与门禁时才能启用真实执行实现；默认使用 `MockGreetingAdapter`。
- `reply/`：合法可用时观察新的候选人消息并交给 HR；不能保证浏览器关闭期间的实时提醒。
- `storage/`：持久化任务、岗位、候选人、匹配、发送状态、日志，不存 Cookie 和账号密码。

### 3.2 运行模式

- `MOCK`：使用模拟招聘网页、合成候选人和虚拟消息系统；所有功能均可测试。
- `AUTHORIZED_READ_ONLY`：仅在允许的场景下读取指定招聘页面，不发送消息。
- `AUTHORIZED_EXECUTION`：只有**BOSS 授权/合同允许、公司信息安全批准、招聘账号授权**均落实时才可启用。不得通过环境变量误配置偷偷启用，需明确权限配置与运行时校验。

`AUTHORIZED_EXECUTION` 未满足条件时，完整自动筛选与“发送”流程必须仍能在 MOCK 模式中贯通，真实发送按钮不可用并解释原因。发布到 Edge 商店还要独立评估商店机器人/垃圾消息政策；企业内部侧载不等于 BOSS 平台授权。

## 4. 关键业务规则

### 4.1 岗位快照

- HR 人工选择 BOSS 推荐牛人页面中的当前岗位。
- 开始任务时冻结 `platformAccountScope + jobId + jobName + JD + criteriaVersion + modelVersion`。
- 岗位名称只能作展示或辅助校验，不可代替稳定 `jobId`；没有可靠标识时不得执行真实打招呼。
- 当前岗位切换、登录账号切换、页面来源变更、页面身份校验失败时自动暂停执行。

### 4.2 候选人身份与数据

- 通过稳定 `candidateId` 绑定候选人卡片、简历详情、分析结果、沟通动作。
- 不能根据姓名、卡片顺序、索引位置执行发送。
- 个人信息只读取岗位能力评估必要字段；优先剔除联系方式、头像等无关字段。
- 数据不全时标记 `INSUFFICIENT_INFO`，不得将“简历未写”视为“候选人不具备”。
- 同候选人可出现在多个岗位；分析缓存键至少包含 `candidateId + jobId + resumeHash + criteriaVersion + promptVersion + modelId`。
- 候选人卡片可能来自 iframe、虚拟列表或异步渲染；只处理确认已加载、身份可核验的数据。

### 4.3 AI 筛选

- 第一步 JD→动态岗位画像：核心职责、必备能力、加分项、可迁移经验、应询问的问题；HR 的一键执行即本次任务授权，但可在开始前预览编辑画像。
- 第二步简介筛选：输出 `PASS / UNCERTAIN / REJECT`，并提供明确证据与欠缺信息。
- 第三步完整简历：仅分析 `PASS`（以及业务规则明确需要复核的情况）；输出依据 JD 与简历原文的逐项评估。
- 不得直接相信模型自报的 `confidence=0.9`；采用离线标注集校准，通过硬性条件、证据覆盖、拒绝发送条件的确定性门禁判断。
- 模型结果必须通过 Zod/JSON Schema 检查，引用的证据必须可在输入文本定位；不满足则复核或重试，绝不强行发送。
- 严防 Prompt Injection：候选人简历、JD、网页文本均是不可信**数据**，不得解释为指令，也不得修改系统目标、工具权限或发送限制。
- 招聘评分不得使用受保护或无关人口属性；为跨专业及可迁移经验留出合理空间。

### 4.4 打招呼

- **仅允许已获平台授权的适配器调用真实沟通动作。**
- 首选平台原生招呼能力与 HR 已设置的话术；V1 不引入 AI 额外多条自动聊天。
- 发送前再次验证岗位、候选人、当前会话、既往沟通记录、当前权限、平台额度与批次限制。
- 发送状态采用 `NOT_STARTED → PREPARED → SENDING → CONFIRMED | UNKNOWN | FAILED`。
- `UNKNOWN` 不自动重发；只有可靠核对外部状态后才能决定下一步。一次点击不是发送成功证据。
- 发送日志不记录不必要的简历全文或个人联系信息。
- 遇到验证码、风险提示、付费/额度限制，立即暂停；不绕过、不模拟真人规避检测。

### 4.5 浏览器与状态机

- 网页动作串行。不能并发操作同一页面的多个候选人详情。
- 已提取数据的 AI 请求可以有限并发，但结果必须按候选人身份绑定；过期任务结果不得写入新岗位。
- `MutationObserver` + 明确的 DOM 条件检查代替固定等待时间；设置超时和健康检查。
- 借鉴 Computer Use 的 **Observe → Decide → Act → Verify → Recover**，但状态判断优先使用 DOM 和业务回执，不做每一步视觉大模型推理。
- 任务运行状态写入 IndexedDB，切换页面、MV3 Service Worker 回收和刷新后从检查点恢复。
- 不默认启用 `chrome.debugger`、`<all_urls>`、后台常驻页或私有 API 抓取。

## 5. 具体数据接口（可按需扩展，字段语义不可弱化）

```ts
interface JobSnapshot {
  accountScope: string;
  platformJobId: string;
  displayName: string;
  jdText: string;
  jdHash: string;
  criteriaVersion: string;
  capturedAt: string;
}

interface CandidateSnapshot {
  candidateId: string;
  jobId: string;
  cardText: string;
  resumeText?: string;
  resumeHash?: string;
  sourceQuality: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
}

type ScreeningDecision = 'PASS' | 'UNCERTAIN' | 'REJECT';

interface ScreeningResult {
  candidateId: string;
  jobId: string;
  decision: ScreeningDecision;
  matchedRequirements: Array<{ criterionId: string; evidence: string }>;
  missingInformation: string[];
  riskFlags: string[];
  criteriaVersion: string;
  promptVersion: string;
}

type SendResult =
  | { status: 'CONFIRMED'; receiptId?: string }
  | { status: 'UNKNOWN'; reason: string }
  | { status: 'FAILED'; reason: string };
```

推荐由 `platformJobId` 与 `candidateId` 等稳定 ID 组成真实发送目标的主键。不得仅用姓名或列表位置进行发送。

## 6. 安全与隐私

- 真实候选人数据的读取、存储、模型传输、保留期限应通过公司内审和平台授权；遵循最小数据、目的限定、可删除、访问隔离。
- 开发日志默认脱敏，不写手机号、邮箱、Token、Cookie、完整履历、原始截图。
- API Key 不提交仓库，不直接写死在扩展打包内容中；生产优先公司批准的 AI 网关，最小化模型数据输入。
- 外部 API 仅通过 HTTPS；本机调试可例外使用 localhost；禁止扩展运行远程代码。
- 根据实际情况执行个人信息保护影响评估，避免基于不透明模型自动作出损害求职者权益的决定。
- 日志与候选人数据需要保留和删除策略，默认不做云同步。

## 7. 工程标准

- TypeScript 严格模式；MV3；优先使用现有仓库结构和原生模块。
- 有边界的模块必须有接口和 Mock 实现；网页适配器与 AI 引擎之间不得直接耦合。
- 状态机、身份校验、去重、错误码、AI schema、任务恢复必须有单元测试。
- 使用本地合成的页面 Fixture，覆盖 iframe/虚拟列表/慢加载/岗位切换/发送回执延迟。
- 使用 Playwright 做**本地模拟页面 E2E 测试**；不是以 Playwright/CDP 在生产环境绕过平台限制。
- 实现可观测性：每一步 `taskId / candidateId(脱敏标识) / phase / durationMs / reasonCode / modelUsage`。
- 所有状态变更具备单调递增的 `revision` 或等价版本校验，防止旧异步任务覆盖新状态。
- 连续失败与身份/授权异常需触发熔断；不得无限重试。

## 8. 开发执行协议

每次任务按下列流程交付：

1. 阅读 `plan.md` 当前阶段及已实现代码，列出本次目标和验收条件。
2. 确认是否涉及真实 BOSS 接入或消息动作；若缺少授权，只在 MOCK 环境开发、测试。
3. 给出最小修改方案、要改的文件与依赖；如有开源复用，先核对 License。
4. 实现代码及对应测试，不顺手开发下一阶段。
5. 运行类型检查、单测、E2E（适用时）、静态检查；记录真实结果，禁止虚报。
6. 更新 `plan.md` 的完成项，附已知问题和下一步。
7. 最终反馈必须包含：改动文件、运行步骤、通过/失败的测试、剩余风险和阻断条件。

## 9. 第一项开发任务（立即执行）

- Fork / 克隆 Polaris 工程并完成安全与许可证审查。
- 验证 Edge MV3 插件可加载、Side Panel 可用、IndexedDB/Service Worker 正常。
- 新建 `MockBossAdapter`、`MockGreetingAdapter` 和一套合成招聘页面 Fixture。
- 建立招聘状态机骨架和 `Run`/`CandidateTask` 数据类型。
- 先以 MOCK 模式跑通：选择岗位 → 输入 JD → AI/假模型筛选 → 简历详情 → 模拟打招呼 → 模拟收到回复 → HR 提示。
- **严禁在第一项任务中连接真实招聘账号或执行真实 BOSS 消息发送。**

完成标准：`pnpm/npm` 能启动或加载 Edge 扩展（具体包管理器遵循仓库实际情况），模拟端到端测试可通过，日志与状态可审计。
