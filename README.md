# ⚠️ [已废弃 / DEPRECATED] dsh-prompt-slim

> [!CAUTION]
> **警告 / STATUS: BROKEN & ABANDONED**  
> **未知原因导致会话控制器雪崩，至今未能修复。**  
> 启用该插件会导致 DeepSeek Harness 桌面端 Session Controller 握手雪崩、新建会话失败或侧边栏历史会话丢失/异常归档。请勿在任何生产或个人环境中使用此插件。本项目已废弃并终止维护。

把 DSH 内置系统提示词里冗长的若干段替换成精简文本——**只改点名的段，其余原样**。

实测（2026-10-04，`standard-gitbash` 预设、本机 profile）：

| | 字节 | token（÷4 估算） |
|---|---|---|
| 原提示词 | 12 986 | ~3 246 |
| 装配后 | 7 216 | ~1 804 |
| 降幅 | **−44.4 %** | |

## 机制：agent 作用域同名段遮蔽

提示词段按「作用域层级」注册，`ScopedLayers.merge` 沿作用域链由外向内取**每个名字的最后一层**。因此在本 agent 自己的作用域上注册一个同名段，就会顶掉预设层/宿主层贡献的那一段。注册落在 `agent.ctx`，所以：

- 工具 schema、runtime-context 快照（沙箱/批准/委派）、**plan 模式激活时的 `plan:policy`**、以及所有没点名的段，全部保持原样；
- 不监听 `system-prompt/assemble`——官方插件开发手册明令禁止用它增删提示词文本。

## 替换表

`sections.json` 是唯一真源，共 17 条：

| 段名 | 原 → 新（字节） |
|---|---|
| `tool:bash` | 92 → 410（承接 FS_STALE / bash 不受版本保护说明） |
| `tool:read` / `tool:write` / `tool:edit` | 130/140/132 → 113/89/84 |
| `tool:glob` / `tool:grep` | 75/133 → 75/71 |
| `tool:jobs` | 384 → 272 |
| `tool:goal` | 528 → 389 |
| `tool:workflow` / `tool:subagent` | 325/232 → 325/114 |
| `tool:web_search` / `tool:web_fetch` | 215/150 → 211/0 |
| `mcp:anysearch` | 2302 → 619 |
| `mcp:github` | 1795 → 536 |
| `mcp:openalex-research-catalog` | 547 → 216 |
| `ui:deliverable-file-references` | 1259 → 528 |
| `app:web-surface` | 990 → 494 |

**故意不动**：`team:policy`（由官方 `@deepseek-ai/dsh-experimental-agent-team-profile` 在 agent scope 动态注册，避免 scope 命名冲突）、`harness:identity`、`deployment:persona-prefix`、`deployment:persona-suffix`（身份与 `{{model}}`/`{{cwd}}` 事实）、`plan:policy`（条件段）、`mcp-resource-servers`（动态服务器名列表）、`harness:source`（本机检出路径）、capability catalog（on-demand 能力目录的唯一指引）。

MCP 三段是各服务器 `initialize` 返回的 `instructions` 原文，由 `@deepseek-ai/dsh-mcp-client` 原样注入；`dsh-mcp-client` 没有关闭开关（只有 `maxInstructionBytes`，超限是报错不是截断），所以只能在装配层替换。替换文本保留了全部硬门槛：`get_sub_domains` 必须先于垂类 `search`、`openalex_resolve_name` 必须先于按实体过滤、`get_me`/`state_reason`/PR 三步流程。

## 安装

三种来源任选其一，装完**从托盘完全退出再启动**（bundle 变更对热重载不生效）。

**GitHub（推荐）** —— 官方 Plugin Manager 的安装目标填：

```
github:yaopushen/dsh-prompt-slim          # 跟随 main
github:yaopushen/dsh-prompt-slim#v0.1.0   # 钉住版本
```

**本机目录** —— 安装目标填 `D:\DEEPSEEK\dsh-prompt-slim`。

两者都由 Plugin Manager 自己完成依赖安装与 bundle 选择。对 GitHub spec，`installBundle` 会先用 `git ls-remote` 做一次仓库可达性预检（默认 5 s，`githubConnectionTimeoutMs`），然后交给 pnpm；本包无依赖、无构建脚本、不声明 DSH `peerDependencies`，因此不涉及版本兼容豁免或构建脚本批准。

安装路径实际消费的只有两处：`package.json` 的 `dsh.bundle.patch` 与它指向的 `cordis.patch.yml`。仓库里的 `dsh.plugin.json` 只是外部插件惯例的元信息，本机 DSH 构建不读它。

**手工等价路径**（`plugin_manager` 不可用时；profile 目录 = `%USERPROFILE%\.dsh\profiles\desktop`）：

```powershell
Push-Location "$env:USERPROFILE\.dsh\profiles\desktop"
& "C:\Program Files\nodejs\node.exe" "D:\DEEPSEEK\DSH DESKTOP\resources\runtime\pnpm\bin\pnpm.mjs" add "github:yaopushen/dsh-prompt-slim"
Pop-Location
```

然后把 `dsh-prompt-slim` 追加进 profile `package.json` 的 `dsh.profile.bundles` 数组，重启。

## 验证

1. 新开一个会话（本插件在 `agent/created` 时注册，已存在的会话不受影响）。
2. 看该会话的系统提示词：`mcp:anysearch` 段应从 2.3 KB 降到约 620 B。
3. 检查计划模式：在 plan 模式下 `plan:policy` 段应仍然出现——这是本方案相对「整份替换」的关键差别。
4. 启动日志里不应有 `prompt-slim: cannot replace section ...` 警告。

## 自检

```bash
node verify.mjs   # 等价于 npm test
```

无需安装 DSH、无第三方依赖。它用假 ctx/agent 走一遍 `apply()`，断言 17 条注册的 name / order / text / interpolate 与 `sections.json` 完全一致、`agent/created` 监听器只注册一个、异常 payload（缺 `ctx`、纯垃圾对象）不抛异常，并打印替换文本总量。改动 `sections.json` 后跑一次即可。

## 回滚

- 官方安装：Plugin Manager 里删除 bundle，重启。
- 手工安装：`pnpm remove dsh-prompt-slim`，从 `dsh.profile.bundles` 删掉它，重启。
- 只想退掉某一项：把 `sections.json` 里对应条目删掉（或把 `text` 改回原文），重启。

## 调参

- 改 `sections.json`：改的是唯一真源，重启生效。
- 或在 profile 补丁层给该行加 `config.sections`：它会**整体替换**内置表，适合只改一两条时把整表复制过去。

## 已知取舍

- 被遮蔽的段如果将来在 DSH 升级里改了文案，本插件会继续用旧文案顶掉它——每次大版本升级后建议抽查一次上述硬门槛是否仍然成立。
- `tool:web_fetch` 被置空（其要点已并入 `tool:web_search`）。
