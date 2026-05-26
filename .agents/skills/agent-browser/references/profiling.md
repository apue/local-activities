# Profiling

Use this file for performance investigations with `profiler` and `trace`.

**Related:** [commands.md](commands.md), [../SKILL.md](../SKILL.md)

## When to Use Which Tool

| Need | Prefer |
|---|---|
| CPU/render/network timeline for page performance analysis | `profiler start` / `profiler stop` |
| Reproducible debugging artifact for flaky automation | `trace start` / `trace stop` |
| Live request visibility while debugging | `network requests` |
| JS/runtime errors near the slow path | `console` and `errors` |

In practice, use `profiler` for optimization work and `trace` for debugging workflows.

## Basic Profiler Workflow

```bash
agent-browser open https://app.example.com
agent-browser wait --load networkidle
agent-browser profiler start

# reproduce the slow path
agent-browser click "#checkout"
agent-browser wait --text "Order summary"

agent-browser profiler stop ./checkout-profile.json
```

Load the output in Chrome DevTools Performance or Perfetto.

## Custom Trace Categories

```bash
agent-browser profiler start \
  --categories "devtools.timeline,v8.execute,blink.user_timing"
# reproduce issue
agent-browser profiler stop ./custom-profile.json
```

Use custom categories only when you know what signal you need; default categories are usually enough.

## Trace Workflow

Use `trace` when you want a broader debugging artifact around a flaky or failing flow.

```bash
agent-browser trace start
agent-browser open https://example.com
agent-browser snapshot -i
agent-browser click @e1
agent-browser trace stop ./debug-trace.zip
```

`trace` is often better than video alone when you need detailed browser-internal debugging context.

## Practical Patterns

### Diagnose slow page load

```bash
agent-browser profiler start
agent-browser open https://app.example.com
agent-browser wait --load networkidle
agent-browser profiler stop ./page-load.json
```

### Measure one interaction

```bash
agent-browser open https://app.example.com
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser profiler start
agent-browser click @e3
agent-browser wait --text "Saved"
agent-browser profiler stop ./save-action.json
```

### Capture evidence for a flaky test

```bash
agent-browser trace start
agent-browser console --clear
agent-browser errors --clear
# run test steps
agent-browser trace stop ./flake-trace.zip
agent-browser console
agent-browser errors
```

## Performance and Reliability Tips

- Start profiling immediately before the slow action; stop immediately after.
- Do not leave profiler or trace running through long idle periods.
- Pair profiling with `network requests`, `console`, and `errors` to separate frontend slowness from backend failures.
- Prefer explicit waits like `wait --load networkidle` or `wait --text` so the captured trace aligns with real milestones.
- Keep profiling off in normal automation because it adds overhead and produces large artifacts.

## Output and Viewing

Profiler output is Chrome trace JSON. Common viewers:
- Chrome DevTools Performance panel
- Perfetto: https://ui.perfetto.dev/
- `chrome://tracing`

Trace output is saved by `trace stop` and is intended for debugging and sharing.

## Limitations

- Profiling is CDP/Chromium-oriented; use default Chrome for the most reliable results.
- Trace/profiler artifacts can be large.
- Long-running captures consume memory and slow automation.
- If the browser is badly hung, `stop` may fail or take time.
