# Session Management

Use this file for isolation, persistence, concurrency, and cleanup choices.

**Related:** [authentication.md](authentication.md), [../SKILL.md](../SKILL.md)

## Pick the Right State Model

| Need | Prefer |
|---|---|
| Isolate concurrent work | `--session <name>` |
| Auto-save lightweight state by name | `--session-name <name>` |
| Reuse a saved JSON state file | `--state <path>` or `state save/load` |
| Reuse a real Chrome profile or persistent browser dir | `--profile <name|path>` |
| Attach to an already-running browser | `--auto-connect` or `--cdp <port|url>` |

## Isolated Sessions with `--session`

Use `--session` whenever multiple agents, tests, or scripts may run at the same time.

```bash
agent-browser --session auth open https://app.example.com/login
agent-browser --session docs open https://docs.example.com

agent-browser --session auth snapshot -i
agent-browser --session docs get text body
```

Each session gets its own cookies, storage, tabs, history, and network state.

## Auto-Persistent Sessions with `--session-name`

Use `--session-name` when you want agent-browser to automatically save and restore cookies plus localStorage by a stable name.

```bash
agent-browser --session-name myapp open https://app.example.com/login
# log in once
agent-browser close

agent-browser --session-name myapp open https://app.example.com/dashboard
```

Use `AGENT_BROWSER_ENCRYPTION_KEY` if you want those saved states encrypted at rest.

## Saved State Files

Use explicit state files when you want portable or inspectable persistence.

```bash
agent-browser state save ./auth-state.json
agent-browser state load ./auth-state.json
agent-browser open https://app.example.com/dashboard
```

State files are best for CI handoff, temporary automation, or reproducible test setup. Treat them as secrets.

## Chrome Profiles

Use `--profile` when the site depends on a real browser profile, existing logins, or extensions.

```bash
agent-browser --profile Default open https://mail.google.com
agent-browser --profile ~/.browser-profiles/test-user open https://app.example.com
```

This offers the broadest persistence but also the broadest exposure of user state.

## Current Session and Active Sessions

```bash
agent-browser session
agent-browser session list
```

Use these when debugging session confusion or parallel task collisions.

## Tabs, Windows, and Frames Live Inside a Session

```bash
agent-browser --session work tab new https://example.com/docs
agent-browser --session work tab 2
agent-browser --session work window new
agent-browser --session work frame "#embed"
agent-browser --session work frame main
```

If refs stop working after switching tabs, frames, or windows, take a fresh snapshot.

## Common Patterns

### Parallel Scraping

```bash
agent-browser --session site1 open https://site1.com
agent-browser --session site2 open https://site2.com
agent-browser --session site3 open https://site3.com

agent-browser --session site1 get text body > site1.txt
agent-browser --session site2 get text body > site2.txt
agent-browser --session site3 get text body > site3.txt
```

### A/B Comparison

```bash
agent-browser --session variant-a open "https://app.example.com?variant=a"
agent-browser --session variant-b open "https://app.example.com?variant=b"

agent-browser --session variant-a screenshot ./a.png
agent-browser --session variant-b screenshot ./b.png
agent-browser diff url "https://app.example.com?variant=a" "https://app.example.com?variant=b" --screenshot
```

### Authenticated Workbench

```bash
agent-browser --session-name admin open https://admin.example.com/login
# log in once
agent-browser close

agent-browser --session admin --session-name admin open https://admin.example.com/users
```

Use a named execution session plus a stable persistence name when you want both isolation and automatic state reuse.

## Cleanup

Always close sessions you no longer need.

```bash
agent-browser close
agent-browser --session auth close
agent-browser close --all
```

For long-lived environments, configure idle shutdown:

```bash
export AGENT_BROWSER_IDLE_TIMEOUT_MS=600000
```

That lets the daemon close itself after inactivity and release browser resources.

## Best Practices

- Use semantic session names like `checkout-test`, `docs-scrape`, or `github-auth`.
- Prefer `--session` for concurrency and `--session-name` for persistence; they solve different problems.
- Re-snapshot after switching tabs, frames, or navigation targets.
- Keep state files and custom profiles out of git.
- Use `session list` before starting new work if you suspect stale sessions.

## Troubleshooting

### Commands hit the wrong page

Likely cause: using the default session accidentally. Fix by passing `--session <name>` consistently.

### Auth disappeared after restart

Use `--session-name`, `state save/load`, `--profile`, or `--auto-connect`; plain `--session` isolation alone does not persist across browser restarts.

### Old daemon or stale session is interfering

```bash
agent-browser close --all
```

Then restart with explicit session names.
