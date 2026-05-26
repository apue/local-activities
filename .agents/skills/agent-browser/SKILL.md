---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, logging in, comparing page states, inspecting network or console activity, or automating browsers across local, iOS, and cloud providers.
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*)
---

# Browser Automation with agent-browser
## Golden Rules

- Prefer refs from `snapshot -i` or `screenshot --annotate`; re-snapshot after navigation or DOM changes.
- Prefer `batch` for multi-step flows when you do not need to inspect intermediate output.
- Prefer explicit waits (`--load`, `--url`, `--text`, `--fn`, `--download`) over fixed sleeps.
- Prefer named `--session` values when multiple agents or scripts run concurrently.
- Prefer `--json` when another tool or script will parse the output.
- Prefer explicit commands over `chat` for deterministic automation; use `chat` for exploratory or human-driven flows.

## Fast Path

Use this workflow for most tasks:

1. Open the page
2. Wait for a stable condition
3. Snapshot for refs
4. Interact with refs
5. Re-snapshot after page changes
6. Verify via `get`, `diff`, `network`, `console`, `errors`, or a screenshot

```bash
# Step 1-3: open, wait, inspect
agent-browser batch --bail \
  "open https://example.com/login" \
  "wait --load networkidle" \
  "snapshot -i"

# Step 4-6: use discovered refs, then verify
agent-browser batch --bail \
  "fill @e1 user@example.com" \
  "fill @e2 $APP_PASSWORD" \
  "click @e3" \
  "wait --url **/dashboard" \
  "screenshot --annotate ./after-login.png"
```

Run `snapshot -i` separately whenever you need to read the refs before deciding the next action.

## Prefer `batch` Over Shell Chaining

`agent-browser batch` is the current high-performance way to run multiple commands in one invocation. It avoids extra process startup overhead and gives structured output when needed.

```bash
# Preferred
agent-browser batch --bail \
  "open https://example.com" \
  "wait --load networkidle" \
  "screenshot ./page.png"

# Still valid, but less efficient for longer flows
agent-browser open https://example.com && \
agent-browser wait --load networkidle && \
agent-browser screenshot ./page.png
```

Use separate commands when you must inspect output between steps, especially after `snapshot`, `get`, or `network requests`.

## Latest Capabilities to Remember

Older agent-browser guides often miss these additions:

- `batch` for faster multi-step execution.
- `screenshot --annotate` for visual refs.
- `network requests|request|har` plus `console`, `errors`, `trace`, and `profiler`.
- `stream` and `dashboard` for live preview/debugging.
- `--confirm-actions`, `confirm`, `deny`, `--engine lightpanda`, and cloud providers via `-p`.

## High-Value Commands

### Navigation and Discovery

```bash
agent-browser open <url>
agent-browser back
agent-browser forward
agent-browser reload
agent-browser snapshot -i
agent-browser snapshot -i --urls
agent-browser screenshot --annotate
agent-browser get title
agent-browser get url
```

### Interaction

```bash
agent-browser click @e1
agent-browser dblclick @e1
agent-browser fill @e2 "text"
agent-browser type @e2 "more text"
agent-browser press Enter
agent-browser keyboard type "text"
agent-browser keyboard inserttext "text"
agent-browser hover @e1
agent-browser focus @e1
agent-browser check @e1
agent-browser uncheck @e1
agent-browser select @e1 "option"
agent-browser drag @e1 @e2
agent-browser upload @e1 ./file.pdf
agent-browser scroll down 500
agent-browser scrollintoview @e1
```

### Waiting and Verification

```bash
agent-browser wait @e1
agent-browser wait --text "Success"
agent-browser wait --url "**/dashboard"
agent-browser wait --load networkidle
agent-browser wait --download ./report.csv

agent-browser diff snapshot
agent-browser diff screenshot --baseline before.png
```

### Inspection, Debugging, and Evidence

```bash
agent-browser get text body
agent-browser get html "#content"
agent-browser get value @e1
agent-browser get attr @e1 href
agent-browser get count ".row"

agent-browser console
agent-browser errors
agent-browser trace start
agent-browser trace stop trace.json
agent-browser profiler start
agent-browser profiler stop profile.json
agent-browser inspect
```

### Sessions, Tabs, Frames, and Storage

```bash
agent-browser --session work open https://example.com
agent-browser session list
agent-browser tab new https://example.com/docs
agent-browser tab 2
agent-browser window new
agent-browser frame "#login-iframe"
agent-browser frame main
agent-browser dialog accept
agent-browser cookies
agent-browser storage local
```

### Network and Observability

```bash
agent-browser network requests
agent-browser network requests --filter api
agent-browser network request 1234.5
agent-browser network route "**/api/*" --abort
agent-browser network har start
agent-browser network har stop ./capture.har

agent-browser stream status
agent-browser dashboard start
agent-browser dashboard stop
```

## Common Patterns

### Form Submission

```bash
agent-browser open https://example.com/form
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser fill @e1 "Jane Doe"
agent-browser fill @e2 "jane@example.com"
agent-browser select @e3 "California"
agent-browser check @e4
agent-browser click @e5
agent-browser wait --text "Thanks"
agent-browser diff snapshot
```

### Authentication: Prefer the Auth Vault

The auth vault is the safest default because the LLM does not need to see raw passwords.

```bash
# Save once; prefer stdin so passwords never land in shell history
printf '%s' "$APP_PASSWORD" | \
  agent-browser auth save github \
    --url https://github.com/login \
    --username "$APP_USERNAME" \
    --password-stdin

# Reuse later
agent-browser auth login github
agent-browser auth list
agent-browser auth show github
agent-browser auth delete github
```

Notes:
- Auth vault entries are encrypted.
- If `AGENT_BROWSER_ENCRYPTION_KEY` is not set, agent-browser auto-generates a local key in `~/.agent-browser/.encryption-key`.
- Domain allowlists still apply to auth flows.

### Choose the Right Persistence Mode

Use the lightest persistence mechanism that solves the task:

| Need | Prefer |
|---|---|
| Isolate concurrent tasks | `--session <name>` |
| Auto-save/restore cookies + localStorage by name | `--session-name <name>` |
| Reuse a saved JSON state file | `--state <path>` or `state save/load` |
| Reuse a real Chrome profile or persistent directory | `--profile <name|path>` |
| Reuse a running Chrome login state | `--auto-connect` or `--cdp <port|url>` |

Examples:

```bash
# Auto-persist lightweight state
agent-browser --session-name myapp open https://app.example.com/login
agent-browser close
agent-browser --session-name myapp open https://app.example.com/dashboard

# Reuse a real Chrome profile
agent-browser --profile Default open https://mail.google.com

# Attach to an already-running Chrome
agent-browser --auto-connect snapshot -i
```

### Parallel Sessions

```bash
agent-browser --session site-a open https://site-a.com
agent-browser --session site-b open https://site-b.com

agent-browser --session site-a snapshot -i
agent-browser --session site-b snapshot -i

agent-browser --session site-a close
agent-browser --session site-b close
```

### Network-Aware Debugging

Use these when a page looks broken or flaky:

```bash
agent-browser network requests --filter api
agent-browser console
agent-browser errors
agent-browser trace start
agent-browser profiler start
# reproduce the issue
agent-browser profiler stop ./profile.json
agent-browser trace stop ./trace.json
```

Use `network route` to block or mock requests, and HAR capture to collect evidence for later debugging.

### Live Debugging

```bash
agent-browser dashboard start
agent-browser open https://example.com
agent-browser stream status
```

Use the dashboard when you want a human-observable live viewport and command feed. For iOS Safari, use `-p ios --device "..."`; for local `file://` pages, add `--allow-file-access` only when required.

## Security Hardening Checklist

All hardening controls are opt-in. For AI-agent use, enable as many of these as the task allows.

### 1. Separate trusted tool output from page content

```bash
export AGENT_BROWSER_CONTENT_BOUNDARIES=1
```

Use this whenever page text may contain prompt injection or other untrusted instructions.

### 2. Constrain where the browser can go

```bash
export AGENT_BROWSER_ALLOWED_DOMAINS="example.com,*.example.com,*.cdn.example.com"
```

Include required CDN, API, WebSocket, and EventSource domains or the page may fail to load.

### 3. Gate dangerous actions

```bash
export AGENT_BROWSER_ACTION_POLICY=./policy.json
export AGENT_BROWSER_CONFIRM_ACTIONS="eval,download,navigate"
```

Example `policy.json`:

```json
{
  "default": "deny",
  "allow": ["navigate", "snapshot", "click", "scroll", "wait", "get"]
}
```

When a guarded action returns a confirmation ID, approve or reject it explicitly:

```bash
agent-browser confirm c_1234abcd
agent-browser deny c_1234abcd
```

### 4. Keep secrets out of logs and shell history

- Prefer `auth save ... --password-stdin` over `--password`.
- Prefer environment variables or secret stores over inline credentials.
- Treat state files as sensitive because they contain cookies and tokens.

```bash
echo "*.auth-state.json" >> .gitignore
```

### 5. Minimize risky flags

Avoid these unless the task truly requires them:

- `--allow-file-access`
- `--ignore-https-errors`
- broad `--headers` containing bearer tokens
- `eval` on untrusted page-derived input

### 6. Be intentional about dialogs

`alert` and `beforeunload` dialogs auto-accept by default so they do not block automation. If you are testing dialog behavior or do not want implicit acceptance, disable that behavior:

```bash
export AGENT_BROWSER_NO_AUTO_DIALOG=1
```

### 7. Cap output size

```bash
export AGENT_BROWSER_MAX_OUTPUT=50000
```

Use this to prevent context flooding on large pages.

## Performance Tuning Checklist

### 1. Use `batch` for hot paths

Prefer one `batch` call over many short CLI invocations.

### 2. Reduce page output aggressively

Use the smallest representation that still solves the task:

```bash
agent-browser snapshot -i -c -d 4
agent-browser snapshot -s "#main" -i
agent-browser get text body
```

Prefer `get text` for extraction-heavy tasks and `snapshot -i` for interaction-heavy tasks.

### 3. Reuse authenticated state instead of logging in repeatedly

Prefer, in order:
- `auth login` when credentials must stay hidden
- `--session-name` for lightweight persistent state
- `--profile` or `--auto-connect` when reusing a real browser session is acceptable

### 4. Pick the right engine

```bash
agent-browser --engine lightpanda open https://example.com
```

Use `lightpanda` for faster, simpler automation and scraping when the site works on it. Use default Chrome for maximum compatibility, extensions, and the most battle-tested CDP path.

### 5. Wait for concrete conditions

Prefer `wait --load networkidle`, `wait --url`, `wait --text`, or `wait --fn` over repeated `wait 1000` calls.

### 6. Keep default timeout below the CLI read timeout

```bash
export AGENT_BROWSER_DEFAULT_TIMEOUT=25000
```

Avoid setting this above `30000`, or slow operations may surface as CLI `EAGAIN` timeouts instead of clean browser errors.

### 7. Clean up long-lived daemons and sessions

```bash
export AGENT_BROWSER_IDLE_TIMEOUT_MS=600000
```

Use an idle timeout in CI or long-running agent hosts so the daemon exits and releases resources after inactivity.

### 8. Use observability only when needed

`trace`, `profiler`, `record`, `dashboard`, and live streaming are excellent for debugging but should not stay enabled in routine automation.

## Annotated Screenshots vs Snapshots

Use `snapshot -i` when text structure is enough. Use `screenshot --annotate` when you need visual layout, unlabeled icon buttons, spatial reasoning, or canvas/chart interaction.

```bash
agent-browser screenshot --annotate ./page.png
agent-browser click @e2
```

Notes:
- Annotated screenshots cache refs for immediate follow-up actions.
- They are supported on Chromium and Lightpanda, not the Safari/WebDriver path.

## JavaScript Evaluation

Use `eval` only when the built-in commands cannot express the task. Shell quoting breaks complex JavaScript easily, so prefer `--stdin` or `-b`.

```bash
# Good for multiline or quote-heavy scripts
agent-browser eval --stdin <<'EOF'
JSON.stringify(
  Array.from(document.querySelectorAll('img')).map((img) => ({
    src: img.src,
    alt: img.alt
  }))
)
EOF
```

Do not feed untrusted page content back into `eval` without validation.

## Configuration File

Create `agent-browser.json` in the project root for durable defaults:

```json
{
  "headed": true,
  "proxy": "http://localhost:8080",
  "profile": "./browser-data",
  "userAgent": "my-agent/1.0"
}
```

Priority is:

1. `~/.agent-browser/config.json`
2. `./agent-browser.json`
3. `AGENT_BROWSER_*` environment variables
4. CLI flags

Notes:
- All CLI options map to camelCase keys.
- Boolean flags accept `true` or `false` values.
- Extensions from user and project configs are merged.
- If the project config contains environment-specific data, add it to `.gitignore`.

## Deep-Dive References

Read these only when needed:

| Reference | Use For |
|---|---|
| [references/commands.md](references/commands.md) | Full command catalog and recent CLI capabilities |
| [references/snapshot-refs.md](references/snapshot-refs.md) | Ref lifecycle, annotated screenshots, selector fallbacks |
| [references/authentication.md](references/authentication.md) | Auth vault, saved state, profiles, 2FA, OAuth |
| [references/session-management.md](references/session-management.md) | Session isolation, persistence modes, cleanup |
| [references/proxy-support.md](references/proxy-support.md) | Proxies, geo-routing, remote browsing constraints |
| [references/profiling.md](references/profiling.md) | Trace and profiler workflows |
| [references/video-recording.md](references/video-recording.md) | Recording sessions for debugging or demos |

## Templates

| Template | Description |
|---|---|
| [templates/form-automation.sh](templates/form-automation.sh) | Fill and verify forms |
| [templates/authenticated-session.sh](templates/authenticated-session.sh) | Login once and reuse state |
| [templates/capture-workflow.sh](templates/capture-workflow.sh) | Capture text, screenshots, and PDFs |

```bash
./templates/form-automation.sh https://example.com/form
./templates/authenticated-session.sh https://app.example.com/login
./templates/capture-workflow.sh https://example.com ./output
```
