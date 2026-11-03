# agy plugin design — Antigravity CLI 對標 openai/codex-plugin-cc

Date: 2026-11-04
Status: builder-check 完成，等 user 核准後進 writing-plans
Repo: Yeimaoz/agy-plugin-cc（public, MIT）
Reference: `~/.claude/plugins/cache/openai-codex/codex/1.0.6/`（codex plugin 1.0.6，功能對標基準）

## 1. Intent / Why

user 2026-11-04 裝了 Google Antigravity CLI（`agy` 1.4.12）與 OpenAI 官方 codex plugin。
codex plugin 在 ChatGPT 帳號下只剩一顆 model（gpt-6-astra），選擇空間只有 reasoning effort。
agy 一個登入可叫 Gemini 4 Argon、Gemini 3.8 Flash、Claude Opus 5.5、Claude Sonnet 5.5、
GPT-OSS 120B，各含多檔 effort。user 要一個 **功能與 codex plugin 一比一對標** 的 Claude Code
plugin，讓三種場景都能走 agy：

1. 卡住時找另一顆腦（rescue）。
2. diff 多一個對抗式 review（review / adversarial-review）。
3. 用 Gemini / Opus 跑長任務省 Claude 額度（rescue --background）。

## 2. Goals / Non-goals / Anti-goals

**Goals**
- Command 面與 codex plugin 1.0.6 同名同語意：`setup / review / adversarial-review / rescue /
  status / result / cancel / transfer`，加上 `agy:agy-rescue` subagent 與可選 Stop review gate。
- `--model` 與 `--effort` 是一等公民，有明確預設表（§5）。
- 可安裝：`claude plugin marketplace add Yeimaoz/agy-plugin-cc` + `claude plugin install agy@agy-plugin-cc`。
- 跨平台：WSL / macOS / Windows 原生皆可跑（user 鐵則）。

**Non-goals**
- 不做 agy 的 interactive TUI 包裝，不碰 `--prompt-interactive`。
- 不做 MCP server。codex plugin 也不是 MCP；本 plugin 走 command + script + subagent。
- 不整合 ccr / cross-review 引擎。ccr 另有觸發紀律（memory `feedback-ccr-explicit-only`）。
- 不 vendor 任何 codex plugin 原始碼；prompt 文字可參考其結構重寫，不逐字複製（LICENSE 未核）。

**Anti-goals（做到也算失敗）**
- headless 任務靜默失敗：agy 在 headless 無法回答權限提示會「拒絕所有 edit 且 exit 0」。
  任何 write 任務若沒帶 skip-permissions 必須在啟動前就報錯，不得跑完才發現沒改。
- review gate 預設開啟或無上限 loop 燒額度。
- Claude 自行觸發 review / status 等 user-only command（必須標 `disable-model-invocation`）。
- 在 Windows 因 cp950 / emoji / 路徑分隔符炸掉。

## 3. Constraints

- agy 已實測可用的 headless 介面（1.4.12）：
  - `agy --model <id> --effort <low|medium|high|xhigh|max> --output-format json -p '<prompt>'`
  - prompt 必須緊跟 `-p`，其他 flag 放前面；`-p` 後若接 flag 會被當 prompt 吃掉。
  - `--output-format json` 回 `{conversation_id,status,response,duration_seconds,num_turns,usage}`。
  - `--output-format stream-json` 給逐事件 NDJSON（status 進度用）。
  - `--conversation <id>` resume、`-c/--continue` 續最近一次。
  - `--mode plan|accept-edits|auto`、`--dangerously-skip-permissions`、`--add-dir`、`--json-schema`。
  - `agy models` 列模型（需登入）。
- `run-timeout` helper 會把帶空白的 prompt 拆字，script 內不得用它；用 Python subprocess 傳 list。
- codex plugin 的 command frontmatter 慣例：`disable-model-invocation: true` 給 user-only
  command；`allowed-tools` 白名單；`!`\`cmd\`` 內嵌執行。
- 狀態目錄：`$CLAUDE_PLUGIN_DATA/state/<workspace-slug>-<hash>/`，無此 env 退 `tempdir/agy-companion/`
  （與 codex 同構，方便兩邊對照）。
- 雙平台：`node:path`、`spawn` 不走 shell、stdout 以 utf-8、不印 emoji。

## 4. Architecture

獨立 OSS repo `Yeimaoz/agy-plugin-cc`（public, MIT），佈局與 openai/codex-plugin-cc 同構：

```
agy-plugin-cc/
  .claude-plugin/marketplace.json   name=agy-plugin-cc，plugins[0].source=./plugins/agy
  plugins/agy/                      ← plugin root
    .claude-plugin/plugin.json      name=agy version=0.1.0
    commands/{setup,review,adversarial-review,rescue,status,result,cancel,transfer}.md
    agents/agy-rescue.md            model: sonnet, tools: Bash, skills: agy-cli-runtime
    skills/agy-cli-runtime/SKILL.md 怎麼呼叫 companion、flag 語意、禁止事項
    skills/agy-result-handling/SKILL.md 結果怎麼呈現（表格 / findings）
    hooks/hooks.json                SessionStart / SessionEnd / Stop（gate）
    prompts/{adversarial-review,review,stop-review-gate,transfer}.md
    schemas/review-findings.schema.json  餵 agy --json-schema
    scripts/agy-companion.mjs       單一入口 CLI：setup|review|task|status|result|cancel|transfer|gate
    scripts/lib/{args,agy,state,jobs,git,prompts,render,transfer,process}.mjs
    scripts/session-lifecycle-hook.mjs, stop-review-gate-hook.mjs
  tests/                            node:test，mock agy binary（不碰真 agy）
  .github/workflows/ci.yml          ubuntu + windows matrix
  README.md  LICENSE(MIT)  CHANGELOG.md
```

**語言：Node.js ≥ 18.18，ESM，零 npm 依賴**（user 2026-11-04 拍板）。理由：Claude Code
本身就需要 Node，安裝者零額外依賴；與 codex plugin 同技術棧便於對照。Command 內嵌用
`!`\`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" ...\``。
子程序一律 `child_process.spawn(bin, argsArray)` 不走 shell，路徑用 `node:path`，
stdout 設 utf-8，不印 emoji。

### 4.1 Job runtime（取代 codex 的 app-server）

- `task` 子命令：建 job record（id、kind、model、effort、cwd、conversation_id、pid、status、
  phase、log file、result file），spawn `agy ... --output-format stream-json`，stdout 逐行寫
  log，解析事件更新 phase；結束寫 result。
- `--background`：spawn 後立即返回 job id；`--wait`：阻塞到結束並印結果。
  背景 process 用 `spawn(..., {detached: true, stdio: ['ignore', logFd, logFd]})` + `child.unref()`，
  不依賴 Claude 的 Bash 存活（Windows 同 API，`windowsHide: true`）。
- `status`：讀 state 列 running / recent；對 running 的 pid 做存活檢查，死掉標 failed。
- `result <id>`：印 result file；`cancel <id>`：kill pid（POSIX SIGTERM→SIGKILL；Windows taskkill）。
- `--resume`：用 job record 的 `conversation_id` 加 `--conversation`；`--fresh` 不帶。
  `rescue` 找「本 Claude session 最近一個 rescue job」的 conversation_id，與 codex 同語意。

### 4.2 Review

- `review` / `adversarial-review`：`git diff`（預設 working tree vs HEAD；可 `--base <ref>` /
  `--staged` / `<path>`）組成 context，套 prompt，`--mode plan` + `--json-schema
  review-findings.schema.json` 跑 agy，解析 findings → render 表格。
- schema 欄位對標 codex：`verdict: approve|needs-attention`，findings[]{file,line_start,
  line_end,severity,confidence,title,detail,recommendation}。
- review 一律 read-only：不帶 skip-permissions，`--mode plan`。

### 4.3 Transfer

- 讀 `~/.claude/projects/<encoded cwd>/<session>.jsonl`，取最近 N 則 user/assistant 文字，
  壓成 handoff prompt，`task --background` 丟給 agy 新 conversation，回 job id。
  Claude transcript 路徑解析規則抄 codex 的作法（由 cwd 推 encoded dir，取 mtime 最新）。

### 4.4 Review gate（Stop hook）

- 預設 `stopReviewGate: false`。`setup --enable-review-gate` 才開。
- 開啟時 Stop hook 跑 `gate`：帶上 Claude 最後一則回覆 + `git diff`，用 Flash low 快判
  `ALLOW|BLOCK`；BLOCK 回 `{"decision":"block","reason":...}`。
- 防 loop：同 session 連續 BLOCK 上限 2 次，第 3 次強制 ALLOW 並在 reason 註明。

### 4.5 Model / effort 預設表（user 拍板：Argon 主力、Flash 快問）

| 用途 | 預設 model | 預設 effort |
|---|---|---|
| review / adversarial-review | gemini-4-argon | high |
| rescue / task / transfer | gemini-4-argon | medium |
| review gate | gemini-3.8-flash | low |
| 使用者指定 `--model opus` / `sonnet` / `flash` / `argon` / `gpt-oss` | 別名表對應 agy id | 沿用該用途預設 |

- agy 的 model id 有兩套表示：`gemini-4-argon-high` 後綴式，與 `--model gemini-4-argon --effort high`。
  2026-11-04 實測 1.4.12 兩種都 SUCCESS（Argon high、Flash low、Sonnet low 皆驗過）。
  **統一採 `--model <base> --effort <level>` 分離式**，別名表只存 base id，effort 獨立傳。
- 別名表放 `scripts/lib/agy.mjs`，`setup` 會用 `agy models` 驗證別名目標仍存在，缺失就警告。

### 4.6 Model-invocation 政策（照抄 codex）

| command | disable-model-invocation |
|---|---|
| setup, rescue | false（Claude 可自叫） |
| review, adversarial-review, status, result, cancel, transfer | true（user only） |

## 5. 與 codex plugin 的差異一覽

| 面向 | codex 1.0.6 | agy plugin |
|---|---|---|
| runtime | codex app-server + broker daemon | 直接 spawn `agy -p`，無 daemon |
| model 選擇 | 單顆 + effort | 多顆 + effort + 別名 |
| resume | thread id | `--conversation <id>` |
| write 權限 | app-server 內部 | `--dangerously-skip-permissions` 僅 rescue `--write` 時帶 |
| 實作語言 | Node ESM | Node ESM（零依賴） |
| 狀態目錄 | `$CLAUDE_PLUGIN_DATA/state` | 同構 |

## 5a. Builder-check 回覆（2026-11-04，reviewer 11 問的裁決）

**已由實測回答**
- Q1 model/effort：`--model <bare> --effort <lvl>` 可用，stream-json 回報 `"model":"gemini-4-argon"`；
  未知 id 回 `invalid model selection` 非靜默 fallback。resolver 規則：別名 → bare id；
  effort 合法性以 `agy models` 清單（去掉 `-low/-medium/-high` 後綴聚合）為準，**不支援的
  effort 直接報錯**，不降級（fallback-must-be-justified）。
- Q2 write 權限：headless `--mode accept-edits` 與 `--mode auto` 都真的寫到檔，**不需要
  `--dangerously-skip-permissions`，本 plugin 永不使用該旗標**。1.4.12 預設模式也會寫，
  舊版「靜默拒絕」問題不復現，但 rescue 預設仍走 `--mode plan`（唯讀），`--write` 才切
  `accept-edits`。`--mode plan` 讀檔正常，review 靠它。
- Q3 位置：user 決定**獨立 OSS repo**（見 §4 修訂），不放 agent-config。marketplace manifest
  放 repo 根 `.claude-plugin/marketplace.json`，plugin 在 `plugins/agy/`（與 openai 同構）。

**我的裁決（minor，builder 照做）**
- Q5 stream-json phase：builder 實測事件後定對應；事件不足則降級 `running/done + 最後一行 log`，可接受。
- Q6 session：SessionStart hook stdin JSON 含 `session_id`，寫進 state；job record 帶
  `claude_session_id`。取不到時退「該 workspace 最近一個」並在輸出標 `[cross-session]` 警告。
  SessionEnd 不 kill 背景 job（user 可能要結果），只標記 orphan。
- Q7 gate：用 `--json-schema {"decision":"ALLOW|BLOCK","reason":str}`；解析失敗 / timeout（300s）/
  agy 未登入 → **fail-open ALLOW 並寫 log + reason 標 `[gate-degraded]`**。連續 BLOCK 計數
  存 state，鍵 session_id，任一 ALLOW 歸零。
- Q8 diff：含 untracked（以 `git diff --no-index /dev/null <file>` 方式納入）；上限 200k 字元，
  超過截斷並在 prompt 與輸出標明；plan mode 可讀檔，故只給 diff + 以 cwd 為 workspace。
  schema 不遵守時重試 1 次，再失敗回純文字並標 `[unstructured]`。
- Q9 transfer：過濾 tool_use / tool_result / system-reminder；只取 user+assistant 文字；
  字元預算 80k；送出前用 AskUserQuestion 二次確認（對話會離開 Anthropic/Google 邊界）。
  Windows encode 規則 builder 實測 `~/.claude/projects` 目錄名。
- Q10 tests：repo 根 `tests/`，mock agy binary；CI 用 GitHub Actions ubuntu + windows matrix
  跑 `node --test`；真 agy 驗收（§7 #3/#4）在 WSL 與 Windows 各手動跑一次，記錄到 PR。
- Q11 版本：setup 檢查 `agy --version` ≥ 1.4.12，低於警告不擋。

**user 已拍板（2026-11-04）**
- Q4 實作語言：Node.js ESM 零依賴。
- repo：`Yeimaoz/agy-plugin-cc`，public，MIT。

## 6. 留給 builder 的決定

- stream-json 事件 schema 要實測後定 phase 對應。
- transcript 取多少則給 transfer（建議 token 上限 ~20k）。
- tests 用 `node:test` mock agy binary；CI 不跑真 agy（無登入）。
- marketplace.json 格式照 openai-codex 的實例（已查：repo 根 `.claude-plugin/marketplace.json`，`source: ./plugins/agy`）。

## 7. 驗收

1. `claude plugin install agy@agy-plugin-cc` 後重開 session，`/agy:setup` 回 ready。
2. `/agy:review` 對一個故意有 bug 的 diff 回至少一則 finding，表格可讀。
3. `/agy:rescue --background 解釋 X` → `/agy:status` 看到 running → `/agy:result <id>` 拿到結果。
4. `/agy:rescue --write ...` 真的改到檔案（驗 anti-goal 靜默拒絕）。
5. `/agy:cancel` 能殺掉跑中 job。
6. `node --test` 全綠（CI ubuntu + windows），真 agy 驗收 WSL + Windows 各手動跑一次。
7. review gate 開啟後連續 BLOCK 不超過 2 次。
