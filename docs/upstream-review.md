# 上游工程、许可与接入记录

日期：2026-11-03（北京时间）。

## 源码与工程盘点

已通过 `gh repo clone Polaris119/boss-job-analyzer … -- --depth 1` 克隆到临时审查目录。
固定版本为 `c95108a2ccaf48da84d86c10ac6f154f2b4e6219`（上游提交日期 2026-08-02）。
没有向个人 GitHub 创建 Fork、推送代码或修改远程状态。

- 上游为原生 JS/ES Modules 的 MV3 插件；没有 package.json、包管理器和安装脚本。
- MIT 已核对并保留。vendored PDF.js 使用 Apache-2.0；该组件不进入本项目。
- 查看 Side Panel、后台 Worker、AI gateway、动态权限、任务仓储和队列模块。
- 上游 IndexedDB 有原子认领模式，但缺少本项目要求的 revision CAS、招聘账号/候选人绑定和跨岗发送账本；不能原样用于招聘消息执行。
- 上游 AI gateway 有 HTTPS/localhost 限制，但允许配置远程模型及本地保存 Key；本切片不复用请求与 Key 管理，改为纯本地假模型。
- 移除上游求职者业务、网站主机权限、Content Script、PDF、简历编辑和学习路线。
- 复用架构和事务模式，新增严格 TS、Zod、构建与本地测试，不整仓混合其他参考项目。
- 核心审查范围内未发现 eval/new Function 或 Cookie/debugger 访问；这不是完整第三方渗透测试结论。

上游执行 `node --test tests/*.test.mjs tests/*.test.cjs`：**62/62 通过**。
执行前已读取测试入口及对应结构；未运行登录、抓取、自动发送或安装脚本。
`gh issue list --state open --limit 20` 返回 `[]`（当时没有开放 Issue，不代表没有潜在缺陷）。

## 依赖

直接依赖和许可见 `THIRD_PARTY_NOTICES.md`；所有版本锁定到 `package-lock.json`。
安装使用 `--ignore-scripts`。初次审计发现旧 Zod 高危与旧 esbuild 低危，分别升级
Zod 4.6.7、esbuild 0.28.2、tsx 4.23.15，最终全量 `npm audit` 为 0 漏洞。
构建包包含生产依赖 Zod 与 Polaris 的完整许可证，开发工具不进入运行包。

## 运行权限与真实接入结论

当前唯一实现：**MOCK**。manifest 只声明 `sidePanel` / `storage`，没有 host_permissions、
optional_host_permissions、Content Script、debugger、外部连接入口，CSP 禁止网络连接。
授权模式不可被环境变量误配置开启。

| 项目 | 当前结论 |
|---|---|
| BOSS 企业账号协议、正式平台授权 | 未提供，未核对账号合同；真实接入禁止启用 |
| 公司信息安全批准、招聘账号授权、隐私评估 | 未提供；本次不访问真实数据 |
| 外部 LLM 数据传输许可 | 未提供；本次没有外部模型请求 |
| Edge 商店发布 | 未提交、未审核，不宣称符合或已获准 |
| 内部测试策略 | 仅本地侧载 MOCK 包，不发布至商店或公司账号 |

当前授权缺口不阻断 MOCK 开发，但阻断任何真实只读或真实发送实现。公开上架评估与平台许可独立。
未对真实 BOSS DOM、自动发送成功率、账号限额做任何兼容性声明。
