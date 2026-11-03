# ultragent

[English](README.md) | 简体中文

Claude Max 和 Ultra 套餐每月附带 API 额度（Max 100 美元，Ultra 200 美元，在 claude.ai 的 设置 → 账单（Billing）→ API credits → Link organization 中领取），但这笔额度没法在 Claude Code 里用。ultragent 让你在本机用这笔额度做真正的编码工作，并且有一道硬性的花费上限。

把一份 Markdown 任务书（brief）交给跑在你自己机器上的编码代理：它只在一个目录里干活，受美元预算和工具守卫（guard）约束，写完报告就停。

```
ultragent init
ultragent run brief.md
```

本项目与 Anthropic 无任何关联，也未获得其认可。你需要自备 Claude API key。

## 为什么用它

- **本地运行。** 代理跑在你的机器上，只在你指定的目录里工作。除了正常工具调用时发给模型 API 的内容，你的代码不会被复制到别处。
- **直连 API。** ultragent 用 `@anthropic-ai/sdk` 调用 Claude Messages API，自己实现工具循环。它不使用 Claude Code 二进制，也不使用 Claude Agent SDK，所以用量按普通 API 用量计费，记在你的 `ANTHROPIC_API_KEY` 上。
- **本地月度美元硬上限。** 每次运行前，根据 `costs.csv` 检查本月累计花费是否超限（默认 100，见“月度上限”）。
- **单次任务美元硬上限。** 它把每次响应的估算成本累加，总额达到预算就停止（`ultragent run` 默认 1，或你设置的 `default-budget`；最大 50）。估算方式以及可能超出的情况见“成本与预算”。
- **密钥隔离。** key 保存在 `~/.ultragent/.env`，只交给 API 客户端使用，不会导出到你的 shell。
- **成本日志。** 每次运行都会往 `~/.ultragent/costs.csv` 追加一行：结束时间、任务书名称、模型、结果、轮数、耗时（分钟）、成本（美元）。

## 快速开始

需要 Node 18 或更高版本。先从 GitHub 安装一次：

```
npm install -g github:Maintstra/ultragent
ultragent init     # asks for your key (hidden input), saves it, runs a dry check
ultragent run brief.md
```

`init` 会提示 `Paste your Claude API key (input hidden):`，检查 key 是否以 `sk-ant-` 开头，保存后询问你用的是哪个套餐（见“月度上限”），再做一次 dry check（一轮对话，不用工具，约 0.005 美元）。它不会打印 key，只显示“…”和最后 4 个字符。如果已经保存过 key，替换前会先问你。

命令：

```
ultragent init
ultragent run <brief.md> [--cwd .] [--budget 1] [--model ...] [--max-turns N] [--report path] [--allow-dir path]
ultragent check        # dry check only (about US$0.005)
ultragent costs        # last 10 rows of costs.csv as a table, plus the month-to-date total, the cap and what is left
ultragent config       # show settings; "config set monthly-cap <usd>" / "config set default-budget <usd>" change them
ultragent --help       # or: ultragent <command> --help
```

`run` 会先打印一段简短的摘要（结果、成本、轮数、报告路径），再输出一行 JSON，包含结果、成本、轮数、报告路径、运行目录，以及模型最后一段文字的前 300 个字符。退出码：结果为 `success` 时是 0，其他结果是 1，运行没能启动（参数错误、缺少 key）是 2。未知命令会退出码 1 并打印用法。

可能的结果：`success`、`error_max_turns`、`error_max_budget_usd`、`error_context_limit`（见“查看图片”）、`refusal`、`error`（API 或其他异常；错误信息在摘要和 `events.jsonl` 里）。

### 文件位置

| 路径 | 内容 |
| --- | --- |
| `~/.ultragent/.env` | `ANTHROPIC_API_KEY=...`（目录权限 0700，文件权限 0600；Windows 上 chmod 尽力而为） |
| `~/.ultragent/runs/<timestamp>-<brief name>/` | `events.jsonl`（开始、每一轮的用量和累计成本、每次工具调用、被拦截的调用、错误、结果）以及默认的 `report.md` |
| `~/.ultragent/costs.csv` | 每次运行一行 |
| `~/.ultragent/config.json` | 本地设置：`monthlyCap`、`defaultBudget`（文件权限 0600） |

设置 `ULTRAGENT_HOME` 可以改用别的目录。为兼容旧的开发环境：如果包根目录下有 `.env`，而 `~/.ultragent/.env` 不存在，就从包根目录那个文件读 key（不会复制或移动它）。`AGENT_WORKER_ENV` 仍然可以覆盖 key 文件的路径。

## 选项（`ultragent run`）

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `<brief.md>` | 必填 | 要运行的 Markdown 任务书。 |
| `--cwd <path>` | 当前目录 | 代理工作的目录。 |
| `--budget <usd>` | `default-budget` 设置（`1`） | 本次运行的成本硬上限。必须大于 0 且不超过 50。同时受月度上限限制。 |
| `--model <id>` | `claude-sonnet-5-5` | 模型 ID。必须在 `src/worker.mjs` 的 `PRICES` 表里，其他模型启动时就会被拒绝。 |
| `--max-turns <n>` | `200` | API 响应的最大轮数。 |
| `--report <path>` | 运行目录里的 `report.md` | 告诉代理把报告写到哪里。该目录会变成可写。 |
| `--allow-dir <path>` | 无 | 额外的可写目录，可以重复指定。 |

未知参数会报错。

### 从 clone 的仓库开发

`node worker.mjs --brief brief.md --cwd path/to/repo [--budget 5] [--dry-check] ...` 仍然可用，它只是同一份代码外面的一层薄封装（默认预算是 5；除非用 `--dry-check`，否则需要 `--brief` 和 `--cwd`）。`npm test` 运行守卫测试和 CLI 测试；`npm run check` 运行 dry check。

## 月度上限

不同套餐附带的 API 额度不一样（参见 Anthropic 的 “API credits for Max, Ultra, and Team plans” 页面）：

| 套餐 | 附带的 API 额度 |
| --- | --- |
| Max | 每月 100 美元 |
| Ultra | 每月 200 美元 |

API key 无法告诉 ultragent 你用的是哪个套餐，也看不到还剩多少额度，所以由你在本地设一个月度上限，ultragent 根据 `costs.csv` 来执行。

```
ultragent config                          # print the current settings
ultragent config set monthly-cap 200      # US$ per UTC month; 0 = no local cap
ultragent config set default-budget 2     # budget for "run" without --budget (above 0, at most 50)
```

设置保存在 `~/.ultragent/config.json`（权限 0600；目录规则和 key 一样，所以 `ULTRAGENT_HOME` 同样生效）。无效的值会被拒绝，并且不会保存任何内容。

| 设置项 | 默认值 |
| --- | --- |
| `monthly-cap` | `100`（美元；`0` 表示不设本地上限） |
| `default-budget` | `1`（美元） |

- `init` 会问 “Which plan are you on? [1] Max (US$100/month credit) [2] Ultra (US$200/month) [3] Other / set my own cap”，然后把 `monthly-cap` 设为 100、200 或你输入的数字。回答为空，或者管道输入已经结束，就保持当前上限（没改过的话是 100）。
- `run` 先统计本月已花的钱（当前 UTC 月份，来自 `costs.csv`）。如果这个数加上本次的 `--budget` 超过上限，它会在调用任何 API 之前直接拒绝，并说明已花多少、上限是多少、怎么修改（退出码 2）。否则它会把 `min(--budget, cap - month-to-date)` 作为实际预算传下去，所以单次运行永远不会越过上限。
- `costs` 还会显示上限和剩余额度。

**如实说明：** ultragent 只统计它自己花掉的钱；同一个 key 上其他应用产生的用量不在其中。请同时在 Console 里设置花费上限。这些金额是根据本地价格表估算的（见下文），不是账单。

## 成本与预算

API 每次响应都会返回 token 用量；worker 用 `src/worker.mjs` 里的 `PRICES` 表去乘（每百万 token 的美元价格：输入、输出、缓存读取）。缓存写入按输入价格的 1.25 倍计。表里目前有 `claude-sonnet-5-5`、`claude-opus-5-5` 和 `claude-haiku-5-5`。如果你传入的模型不在表里，worker 会拒绝启动，而不是瞎猜价格；请先把该模型加进 `PRICES`。

这是根据本地表算出的估算值，不是发票。如果价格变了或表有误，上限也会跟着不准。检查发生在每次响应之后、执行它的工具调用之前：如果累计总额已达到预算，运行就以 `error_max_budget_usd` 结束，这些工具调用不会执行。因此单次响应最多可能超出上限它自己那一次的成本。如果某次响应没有工具调用、直接结束这一轮，即使已经越过上限，也算 `success`。

## 直连 worker 如何运行工具

ultragent 跑的是手写的循环：发送消息、读取响应、在本地执行工具调用、把结果再发回去。它用了两个 Anthropic 定义的工具，由它自己实现，另外还有一个自定义工具 `view_image`（见下文）：

- `bash_20250124`（`bash`）。每次调用都在一个新的 shell 里运行，起点是仓库根目录，所以 `cd` 和环境变量的修改不会带到下一次调用。在 Windows 上，如果找得到就用 Git Bash（`C:\Program Files\Git` 或 `C:\Program Files (x86)\Git` 下的 `bash.exe`），否则用 PowerShell；其他系统用 `bash`。命令运行 10 分钟后会被终止。`restart` 选项什么都不做，只会回报“每条命令本来就在新的 shell 里运行”。
- `text_editor_20250728`（`str_replace_based_edit_tool`）。支持 `view`（带行号的文件内容，可指定行范围；或目录列表，不含 `node_modules` 和 `.git`）、`create`、`str_replace`（旧文本必须恰好出现一次）和 `insert`。

工具输出最多保留 30,000 个字符。更长的输出会保留开头和结尾各 15,000 个字符，中间加一条说明。

### 查看图片

`view_image`（输入 `{ "path": string, "note"?: string }`）让模型能看到截图或其他图片，例如通过 `adb` 在 Android 模拟器上跑 GUI 测试。守卫把它当作读取：`.env` 文件会被拦截，路径像编辑器工具一样相对仓库解析。支持 `.png`、`.jpg`/`.jpeg` 和 `.webp`。结果是一个图片块，加一行文字：路径、像素尺寸（能从文件头读出时）和 KB 大小。`events.jsonl` 只记录路径（`editor.view_image`），绝不记录图片数据。

- **5 MB 上限。** 更大的文件会被拒绝，并提示模型先缩小（例如用 `adb exec-out screencap -p` 并在设备端缩放），或者查看裁剪后的副本。
- **成本。** 图片比文字消耗更多输入 token，而且会留在之后每一轮的对话里。系统提示会让模型在文字（uiautomator dump、日志）能回答问题时优先用文字。
- **上下文停止。** 如果某次请求报告的输入 token 超过 700,000（`input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`），运行就以 `error_context_limit` 结束，摘要里会说明，这样长时间的截图会话不会失控。和预算检查一样，它在响应之后、执行该响应的工具调用之前进行；结束这一轮的响应仍算 `success`。

如果模型以 `refusal` 停止，这次运行就以 `refusal` 结束；`pause_turn` 停止则会自动继续。

### 项目说明

启动时，worker 会读取 `--cwd` 仓库根目录下的 `AGENTS.md` 和 `CLAUDE.md`（如果存在，各截取前 40,000 个字符），放进系统提示词的 “Project instructions” 部分。仓库里其他内容和用户级配置一概不加载。

## 守卫（guard）

守卫在 `src/guard.mjs`（`makeGuard`）里，两种 worker 共用；`guard-test.mjs` 会导入它，`npm test` 会运行它。直连 worker 在执行每次工具调用之前都会先过一遍守卫：

- 每次 `bash` 调用都按 `Bash` 检查，检查对象是命令文本。
- 编辑器的 `view` 按 `Read` 检查，检查对象是解析后的路径。
- 编辑器的其他命令（`create`、`str_replace`、`insert`）按 `Write` 检查，检查对象是解析后的路径。

被拦截的调用不会执行。模型会收到 `Blocked: <reason>` 作为错误结果，这次调用在 `events.jsonl` 里记为 `blocked`。

**符合以下任一情况的 shell 命令会被拒绝：**

- `git push`
- `git reset --hard`、`git clean -f...`、`git checkout -- <path>`、`git stash drop`、`git stash clear`
- `npm publish`、`pnpm publish`、`yarn publish`
- `eas`、`vercel`、`netlify`、`fly`、`railway`、`wrangler`、`firebase` 后面跟 `build`、`deploy`、`submit`、`publish` 或 `up`
- `curl`、`wget`、`Invoke-WebRequest`、`Invoke-RestMethod`、`iwr`、`irm`
- 指向 `/`、`~` 或盘符根目录的 `rm -r...`
- 带 `-Recurse` 的 `Remove-Item`
- `setx`、`reg add`、`Set-ItemProperty`、`netsh`、`schtasks`
- `ssh`、`scp`、`gh pr create`、`gh release create`、`gh repo create`、`gh api`
- 任何同时提到 `.env` 和读取工具或解释器的命令（`cat`、`type`、`Get-Content`、`gc`、`more`、`less`、`head`、`tail`、`grep`、`rg`、`Select-String`、`sls`、`findstr`、`node`、`python`）

**文件访问：**

- 写入（`create`、`str_replace`、`insert`）只有在目标路径位于可写根目录之内时才允许：`--cwd`、报告所在目录、运行目录，或任何 `--allow-dir`。
- 对 `.env` 和 `.env.*` 文件的写入一律拒绝，即使它们在可写根目录里。
- 对 `.env` 和 `.env.*` 文件的读取（`view`）一律拒绝。其他读取不按路径限制。

### 局限

守卫不是沙箱。命令匹配是基于命令文本的正则，所以一个有心的模型是可以绕过的（比如间接拼出命令、用清单之外的工具或语言，或者运行它之前自己写好的脚本）。仓库之外的读取是允许的，shell 命令也不局限在可写根目录内；路径检查只针对编辑器工具，管不到 shell 命令写了什么。shell 命令还会继承你的环境变量。请只在你能审阅的仓库上运行 worker，做好备份或使用 git，并且在 push 任何东西之前先看一遍 diff。

## 怎么写一份好的任务书

- 用一两句话说清目标，然后列出具体的步骤或涉及的文件。
- 说明哪些不在范围内、哪些不能动。
- 说明如何验证：跑哪些测试、类型检查或构建命令。
- 补充仓库的 `AGENTS.md` / `CLAUDE.md` 里没有覆盖的约束。
- 遇到有歧义的地方，让它在报告里提问，而不是自己猜。worker 本来就被要求这样做。
- 任务要小到能放进预算里；大的工作拆成几份任务书。

worker 会把仓库路径和报告路径追加到任务书后面。系统提示词会告诉代理当前的平台、仓库根目录和 shell，要求它只在仓库内工作，不要 push、发布、部署或碰凭据，并且最后写一份不超过 30 行的报告：改了什么（文件）、测试结果、未解决的问题。

## 在 Claude Code 里使用

这个仓库同时也是一个 Claude Code 插件市场（plugin marketplace）。在 Claude Code 里安装插件：

```
/plugin marketplace add Maintstra/ultragent
/plugin install ultragent@ultragent-marketplace
```

然后让 Claude Code 把任务交出去（例如 `/ultragent:ultragent add input validation to the signup form`，或者说“use ultragent for this”）。这个 skill 让 Claude Code 当“经理”：它把任务书写到 `.ultragent/briefs/`，带着美元预算（默认 1）运行 `ultragent run`，等待结束，然后读报告、查看 `git diff` 和 `git status`、运行你的测试并审查改动。真正写代码的是用你的 API key 跑的 ultragent。如果没设置 key，skill 会提示你在自己的终端里运行 `ultragent init`；它绝不会在聊天里索要 key。

这个 skill 的 `allowed-tools` 只在当次对话中预先批准 `ultragent`、`git diff` 和 `git status`。其他命令（比如运行你的测试）仍然走正常的权限确认。插件文件在 `.claude-plugin/` 和 `plugins/` 下，不属于 npm 包。


## Agent SDK 版本

`worker-agent-sdk.mjs`（只在仓库根目录，不属于 npm 包）是更早的 worker，基于 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`），运行的是 Claude Code 引擎及其内置工具。它的参数和 `worker.mjs` 相同，也共用 `src/guard.mjs`，但有这些不同：

- **计费。** Agent SDK 的流量按 Claude Code 用量计费，所以套餐附带的 API 额度不适用。这也是直连 worker（`ultragent`）成为主力的原因。
- **预算。** 它把 `maxBudgetUsd` 交给 SDK，由 SDK 自己核算成本；没有 `PRICES` 表，也不限制模型。
- **守卫接入方式。** 守卫既作为 `canUseTool` 回调运行，也作为 `PreToolUse` hook 运行，所以项目里的允许规则绕不过它。它看到的是 Claude Code 的工具名（`Bash`、`PowerShell`、`Write`、`Edit`、`MultiEdit`、`NotebookEdit`、`Read`）。
- **key 来源检查。** 启动时 SDK 会报告它的凭据来自哪里。如果不是 worker 自己的 `ANTHROPIC_API_KEY`，worker 就抛出错误。它还会从子进程环境中移除 `ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_BASE_URL` 以及 Bedrock/Vertex/Foundry 的开关。
- **加载的设置。** 只加载项目设置（`settingSources: ['project']`）：仓库的 `AGENTS.md` / `CLAUDE.md` 和项目设置。权限模式是 `default`。
- **Dry check。** `--dry-check` 仍然需要 `--brief` 和 `--cwd`，上限是 0.25 美元。

运行方式：`node worker-agent-sdk.mjs --brief ... --cwd ...`。它的运行记录、成本和 key 文件仍然放在脚本旁边（仓库根目录），而不是 `~/.ultragent`。

## 免责声明

本项目与 Anthropic 无任何关联，也未获得其认可。它使用 Anthropic SDK（`@anthropic-ai/sdk`），以及（Agent SDK 版本中）Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`），须遵守它们各自的条款；你需要自备 API key，并对由此产生的用量负责。

## 许可证

MIT。见 `LICENSE`。
