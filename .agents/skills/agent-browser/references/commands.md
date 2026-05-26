# Command Reference

Reflects the current `agent-browser` CLI as installed locally. Use this file for command lookup; use [../SKILL.md](../SKILL.md) for workflow guidance.

## Core Workflow

```bash
agent-browser open https://example.com
agent-browser wait --load networkidle
agent-browser snapshot -i
# inspect refs, then continue
agent-browser click @e1
agent-browser wait --text "Success"
agent-browser diff snapshot
```

Prefer `batch` when you do not need to inspect intermediate output:

```bash
agent-browser batch --bail \
  "open https://example.com" \
  "wait --load networkidle" \
  "screenshot ./page.png"
```

## Navigation

```bash
agent-browser open <url>
agent-browser back
agent-browser forward
agent-browser reload
agent-browser close
agent-browser close --all
agent-browser connect <port|ws-url>
```

## Snapshot and Visual Discovery

```bash
agent-browser snapshot
agent-browser snapshot -i
agent-browser snapshot -i --urls
agent-browser snapshot -c
agent-browser snapshot -d 4
agent-browser snapshot -s "#main"

agent-browser screenshot
agent-browser screenshot ./shot.png
agent-browser screenshot --full ./full.png
agent-browser screenshot --annotate ./annotated.png
agent-browser pdf ./page.pdf
```

Notes:
- `snapshot -i` is the default interaction workflow.
- `screenshot --annotate` overlays labels and prints a legend; labels map directly to refs like `@e1`.
- Annotated screenshots are supported on Chromium and Lightpanda.

## Interaction

```bash
agent-browser click <selector|@ref>
agent-browser dblclick <selector|@ref>
agent-browser hover <selector|@ref>
agent-browser focus <selector|@ref>
agent-browser type <selector|@ref> "text"
agent-browser fill <selector|@ref> "text"
agent-browser press Enter
agent-browser keyboard type "text"
agent-browser keyboard inserttext "text"
agent-browser check <selector|@ref>
agent-browser uncheck <selector|@ref>
agent-browser select <selector|@ref> "value"
agent-browser drag <src> <dst>
agent-browser upload <selector|@ref> ./file1 ./file2
agent-browser download <selector|@ref> ./output.pdf
agent-browser scroll down 500
agent-browser scroll left 300
agent-browser scrollintoview <selector|@ref>
```

## Get Information

```bash
agent-browser get text <selector|@ref>
agent-browser get html <selector|@ref>
agent-browser get value <selector|@ref>
agent-browser get attr <selector|@ref> <name>
agent-browser get title
agent-browser get url
agent-browser get count ".item"
agent-browser get box <selector|@ref>
agent-browser get styles <selector|@ref>
agent-browser get cdp-url
```

## Check State

```bash
agent-browser is visible <selector|@ref>
agent-browser is enabled <selector|@ref>
agent-browser is checked <selector|@ref>
```

## Waiting

```bash
agent-browser wait <selector|@ref>
agent-browser wait 2000
agent-browser wait --url "**/dashboard"
agent-browser wait --load networkidle
agent-browser wait --fn "window.appReady === true"
agent-browser wait --text "Welcome"
agent-browser wait --download ./report.csv
agent-browser wait "#spinner" --state hidden
agent-browser wait @e5 --state detached
```

Use explicit waits instead of fixed sleeps whenever possible.

## Semantic Locators

Use `find` when refs are unavailable or you need a stable semantic target.

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@example.com"
agent-browser find placeholder "Search" type "query"
agent-browser find alt "Logo" click
agent-browser find title "Close" click
agent-browser find testid "submit-btn" click
agent-browser find first ".item" click
agent-browser find last ".item" click
agent-browser find nth 2 "a" hover
```

## Mouse and Clipboard

```bash
agent-browser mouse move 100 200
agent-browser mouse down left
agent-browser mouse up left
agent-browser mouse wheel 400

agent-browser clipboard read
agent-browser clipboard write "Hello"
agent-browser clipboard copy
agent-browser clipboard paste
```

## Browser Settings

```bash
agent-browser set viewport 1440 900
agent-browser set device "iPhone 16 Pro"
agent-browser set geo 37.7749 -122.4194
agent-browser set offline on
agent-browser set headers '{"X-Test":"1"}'
agent-browser set credentials user pass
agent-browser set media dark
agent-browser set media light reduced-motion
```

## Cookies and Storage

```bash
agent-browser cookies
agent-browser cookies set session_token abc123 --domain example.com --secure --httpOnly
agent-browser cookies clear

agent-browser storage local
agent-browser storage local authToken
agent-browser storage local set authToken abc123
agent-browser storage local clear

agent-browser storage session
agent-browser storage session set draft saved
agent-browser storage session clear
```

## Sessions, Tabs, Windows, and Frames

```bash
agent-browser session
agent-browser session list

agent-browser --session docs open https://example.com
agent-browser --session docs close

agent-browser tab
agent-browser tab new https://example.com/docs
agent-browser tab 2
agent-browser tab close 2

agent-browser window new

agent-browser frame "#login-iframe"
agent-browser frame main
```

## Dialogs

```bash
agent-browser dialog status
agent-browser dialog accept
agent-browser dialog accept "prompt text"
agent-browser dialog dismiss
```

By default, `alert` and `beforeunload` dialogs auto-accept. Use `--no-auto-dialog` to disable that behavior.

## Network

```bash
agent-browser network requests
agent-browser network requests --filter api
agent-browser network requests --type xhr,fetch
agent-browser network requests --method POST --status 2xx
agent-browser network requests --clear
agent-browser network request 1234.5

agent-browser network route "**/api/*" --abort
agent-browser network route "**/data.json" --body '{"mock":true}'
agent-browser network unroute
agent-browser network unroute "**/api/*"

agent-browser network har start
agent-browser network har stop ./capture.har
```

Use this to debug broken pages, confirm API behavior, block trackers, or mock unstable dependencies.

## Diffing and Verification

```bash
agent-browser diff snapshot
agent-browser diff snapshot --baseline ./before.txt
agent-browser diff snapshot --selector "#main" --compact
agent-browser diff screenshot --baseline ./before.png
agent-browser diff screenshot --baseline ./before.png -o ./diff.png
agent-browser diff screenshot --baseline ./before.png -t 0.2
agent-browser diff url https://staging.example.com https://prod.example.com
agent-browser diff url https://staging.example.com https://prod.example.com --screenshot
agent-browser diff url https://staging.example.com https://prod.example.com --wait-until networkidle
```

## Debugging and Observability

```bash
agent-browser console
agent-browser console --json
agent-browser console --clear
agent-browser errors
agent-browser errors --clear
agent-browser highlight <selector|@ref>
agent-browser inspect

agent-browser trace start
agent-browser trace stop ./trace.json
agent-browser profiler start
agent-browser profiler stop ./profile.json
agent-browser record start ./demo.webm
agent-browser record stop
```

## Streaming and Dashboard

```bash
agent-browser stream status
agent-browser stream enable
agent-browser stream enable --port 9223
agent-browser stream disable

agent-browser dashboard start
agent-browser dashboard start --port 8080
agent-browser dashboard stop
```

Use the dashboard for live viewport + activity feed. Keep it off unless you need human-visible debugging.

## Batch Execution

```bash
agent-browser batch "open https://example.com" "snapshot -i" "screenshot"
agent-browser batch --bail "open https://example.com" "click @e1" "screenshot"

echo '[
  ["open", "https://example.com"],
  ["snapshot", "-i"],
  ["click", "@e1"],
  ["screenshot", "result.png"]
]' | agent-browser batch --json
```

## Authentication and State

```bash
agent-browser auth save github --url https://github.com/login --username user --password-stdin
agent-browser auth login github
agent-browser auth list
agent-browser auth show github
agent-browser auth delete github

agent-browser state save ./auth-state.json
agent-browser state load ./auth-state.json
```

Related persistence flags:

```bash
agent-browser --session-name myapp open https://app.example.com
agent-browser --profile Default open https://mail.google.com
agent-browser --state ./auth-state.json open https://app.example.com
agent-browser --auto-connect snapshot -i
agent-browser --cdp 9222 snapshot -i
```

## Confirmation Workflow

When `--confirm-actions` is enabled, sensitive operations return a confirmation ID.

```bash
agent-browser confirm c_8f3a1234
agent-browser deny c_8f3a1234
```

Pending confirmations auto-deny after 60 seconds.

## Chat Mode

```bash
agent-browser chat "open google.com and search for cats"
agent-browser -q chat "summarize this page"
agent-browser -v chat "fill in the login form"
agent-browser --model openai/gpt-4o chat "take a screenshot"
agent-browser chat
```

Use `chat` for exploratory, human-directed automation. Prefer explicit commands in scripts and reproducible workflows.

## Setup and Maintenance

```bash
agent-browser install
agent-browser install --with-deps
agent-browser upgrade
agent-browser profiles
agent-browser --version
agent-browser --help
agent-browser <command> --help
```

## High-Value Global Options

```bash
agent-browser --session <name> ...
agent-browser --session-name <name> ...
agent-browser --profile <name|path> ...
agent-browser --state <path> ...
agent-browser --auto-connect ...
agent-browser --cdp <port|url> ...
agent-browser --headers '{"Authorization":"Bearer ..."}' ...
agent-browser --proxy http://127.0.0.1:7890 ...
agent-browser --proxy-bypass "localhost,*.internal" ...
agent-browser --engine lightpanda ...
agent-browser --headed ...
agent-browser --json ...
agent-browser --config ./agent-browser.json ...
```

## Security Options

```bash
agent-browser --content-boundaries ...
agent-browser --max-output 50000 ...
agent-browser --allowed-domains "example.com,*.example.com" ...
agent-browser --action-policy ./policy.json ...
agent-browser --confirm-actions eval,download ...
agent-browser --confirm-interactive ...
agent-browser --no-auto-dialog ...
```

Prefer these in AI-agent environments.

## Performance Notes

- Prefer `batch` over many short invocations.
- Prefer `snapshot -i -c -d <n>` or `get text` over full snapshots on huge pages.
- Reuse state with `auth`, `--session-name`, `--profile`, or `--auto-connect`.
- Keep `AGENT_BROWSER_DEFAULT_TIMEOUT` at or below `30000` ms.
- Use `--engine lightpanda` when the page works on it and speed matters more than maximum compatibility.
