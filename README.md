# dsh-flowpack v2.0 — Human-Like Progressive Workflow Learning, Watch & Train & Selectable Experience Capsules

Zero-dependency DeepSeek Harness (DSH) host + Web client plugin combining human-like experiential learning, real-time desktop Watch & Train apprenticeship, selectable cross-conversation / cross-agent Experience Capsule buttons, runtime self-healing (`tools/post-execute`), immutable non-forgetting workflow genealogy, SHA-256 strict memory packaging, and cross-platform portability exports.

## Highlights
- **Progressive Consolidation (`exploring` -> `emerging` -> `crystallized`)**: Trial-and-error first runs mature across repeated executions into crystallized clickable Capsule Buttons with human-readable summaries.
- **Watch & Train Apprenticeship (`示教训练`)**: Demonstrate a workflow once on Windows while FlowPack monitors actions & UI Automation context (automatically skipping DeepSeek Harness and password fields), lets AI ask real-time clarifying questions, runs multi-round AI practice (encouraging faster/better alternative methods), and graduates accepted rounds into both a crystallized Experience Capsule (Gen 1 human baseline + Gen 2 AI method) and a sealed Memory Pack.
- **Selectable Experience Capsule Button (`composer.dock` / `hero.options` / `shell.overlay`)**: Arm any capsule across `session`, `workspace` (all project chats), or `global` (all chats + spawned subagents), with automatic subagent inheritance.
- **Non-Forgetting Workflow Genealogy**: Every optimization and bugfix appends an immutable full-stage generation snapshot (`Gen 1..N`) so pre-optimization baselines are never forgotten and can always be consulted or restored forward.
- **Runtime Self-Healing (`tools/post-execute`)**: Matches runtime tool failures against learned capsule fix rules and Gen-1 fallbacks mid-turn, injecting `additionalContexts` corrective nudges and learning newly resolved fixes automatically.
- **Cross-Platform Export & Strict SHA-256 Packaging**: Export to `.dshcapsule.json`, universal `SKILL.md`, `AGENTS.md`, native DSH PTC JS (`phase`/`parallel`/`agent`/`log`), and human runbooks with strict verification & tamper quarantine.

## AI Tools & Slash Commands
- **Tools**: `flowpack_capsule`, `flowpack_memory`, `flowpack_workflow`, `flowpack_train`
- **Slash Commands**: `/flow-capsule`, `/flow-distill`, `/flow-pack`, `/flow-verify`

## Installation & Testing
- Desktop GUI: DeepSeek Harness → **Settings → Plugins → Add Plugin** → select your local `dsh-flowpack` folder (or run `install-profile.ps1`)
- Tests: `npm test`
