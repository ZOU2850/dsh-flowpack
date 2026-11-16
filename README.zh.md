# dsh-flowpack v2.0 — 类人类渐进学习工作流与可选经验胶囊插件

专为 **DeepSeek Harness (DSH)** 打造的零外部依赖主机 + Web 客户端插件，像人类学徒一样成长与复用经验：

## 核心能力（v2.0 全面升级）

1. **像人一样渐进式学习与结晶 (`exploring` → `emerging` → `crystallized`)**：
   - 第 1 次遇到新任务：**摸索学习 (`🌱 exploring`)**，完整留存探索试错步骤与报错排查过程。
   - 同类任务多次完成：通过任务指纹自动聚类合并优化（消重、并行合批、沉淀解法），逐渐成长为 `🌿 emerging` 并达到阈值（默认 3 次或手动立即结晶）后自动凝练为 **`⚡ 已结晶经验胶囊按键`**。
2. **可选经验胶囊按键：跨对话 / 跨项目 / 跨 Agent 一键干活**：
   - 直接嵌入对话输入框下方 (`conversation.composer.dock`)、新对话欢迎栏 (`conversation.hero.options`) 及独立浮窗选择器 (`shell.overlay`)，并配有右侧栏专属视图。
   - 一键选择挂载作用域：**仅当前对话** | **本项目跨对话** | **全局跨对话 + 跨 Agent**，并支持**派生子 Agent (`origin === 'subagent'`) 自动继承主会话胶囊**，选中即可「填入开工指令并立即开始执行」。
3. **示教训练（Watch & Train）：人做一遍、AI 实时看屏学与问、多轮练对出师**：
   - 支持开启桌面/网页实时看屏学习（自动跳过 DSH 本窗口、密码管理器与密码框），识别 UIA 控件上下文并抓拍关键帧。
   - 遇到歧义操作时 AI 可随时提问澄清；转入多轮训练后鼓励 AI 使用比人工更高效的方法，人类批注查收通过即可一键同时固化为「经验按键 + 重要记忆」。
4. **非遗忘演化谱系 (`Genealogy`) — 永远保留改善前的工作流**：
   - 每次优化或吸收新问题解法，都会向不可变历史谱系追加完整代次快照（`Gen 1` 初代摸索、`Gen 2` 消重并行、`Gen N` 修复新问题），**永不覆盖旧版本**。
   - 后续新方法如在特殊场景受阻，随时可一键对照或前向回溯复用第 1 代或任意历史代次，同时保留全部新代次记录。
5. **运行时自我纠正与自愈 (`tools/post-execute`) + 跨插件工具联动发现**：
   - 挂载于 DSH `tools/post-execute` 瀑布流中（Fail-Open），一旦工具调用报错或出现连续试错循环，立即匹配已挂载胶囊的 `selfHealing` 规则与历史解法，通过 `additionalContexts` 注入纠错提示与保底代数参考；修复成功后自动吸收新解法入库。
   - 自动感知当前环境内联动的其他已安装插件工具（如 `@copylee/dsh-office`、`dsh-office-tools`、`@copylee/dsh-computer-use`、`dsh-connect-workbuddy`、`dsh-file-launcher` 等）。
6. **SHA-256 严格记忆打包 & 跨平台导出**：
   - 支持 `.dshcapsule.json`（完整签名经验胶囊）、通用 `SKILL.md`（可用于 Antigravity / Codex / Claude Code / Cursor）、`AGENTS.md` 规则片段、DSH 原生 PTC (`phase`/`parallel`/`agent`/`log`) 脚本与人类阅读手册导出，并内置防篡改隔离、作用域隔离、密钥脱敏与抗压缩注入。

## 工具与指令
- **AI 工具**：`flowpack_capsule`、`flowpack_workflow`、`flowpack_memory`、`flowpack_train`
- **Slash 指令**：`/flow-capsule`、`/flow-distill`、`/flow-pack`、`/flow-verify`
- **持久化目录**：`$DSH_HOME/flowpack`（Windows 默认 `~/.dsh/flowpack`）

## 安装方式
- **DSH 桌面端界面安装（推荐）**：打开 DeepSeek Harness → **设置 → 插件 → 添加本地插件** → 选择本地 `dsh-flowpack` 目录
- **PowerShell 一键挂载到 Profile**：
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-profile.ps1
  ```
  卸载：`.\install-profile.ps1 -Uninstall`
