# Video Recording

Use this file for visual evidence, demos, and debugging workflows with `record`.

**Related:** [commands.md](commands.md), [../SKILL.md](../SKILL.md)

## What `record` Actually Does

`record start` creates a fresh browser context for video recording but preserves cookies and localStorage. If you omit the URL, it automatically navigates to the current page.

That makes it useful when you want clean video capture without losing login state.

## Basic Workflow

```bash
agent-browser open https://app.example.com/dashboard
agent-browser wait --load networkidle
agent-browser snapshot -i

agent-browser record start ./demo.webm
agent-browser click @e3
agent-browser wait --text "Saved"
agent-browser record stop
```

## Commands

```bash
agent-browser record start ./output.webm
agent-browser record start ./output.webm https://example.com
agent-browser record stop
agent-browser record restart ./take2.webm
```

Use `restart` when you want to discard or rotate to a fresh take quickly.

## Common Patterns

### Record from the current authenticated page

```bash
agent-browser --session-name myapp open https://app.example.com/dashboard
agent-browser wait --load networkidle
agent-browser record start ./authenticated-demo.webm
# perform steps
agent-browser record stop
```

### Capture a failing flow for debugging

```bash
set -euo pipefail
trap 'agent-browser record stop 2>/dev/null || true' EXIT

agent-browser record start ./failure.webm https://app.example.com/login
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser click @e1
# more steps...
agent-browser record stop
trap - EXIT
```

### Make a cleaner human-facing demo

```bash
agent-browser record start ./how-to-login.webm https://app.example.com/login
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser fill @e1 "demo@example.com"
agent-browser wait 500
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser wait 800
agent-browser record stop
```

For demos, short fixed waits are acceptable when they improve human readability.

## Best Practices

- Start recording only after the page is ready unless you specifically need the initial loading sequence.
- Use `snapshot -i` before recording if you need to discover refs first.
- Prefer `wait --text`, `wait --url`, or `wait --load` for the real flow; add short fixed pauses only for human-viewable demos.
- Combine video with `screenshot`, `console`, `errors`, or `trace` when debugging a failure.
- Use descriptive filenames, especially in CI.

```bash
agent-browser record start ./recordings/checkout-failure-$(date +%Y%m%d-%H%M%S).webm
```

## Security Notes

- Videos may capture secrets, personal data, or authenticated screens.
- Do not store recordings from sensitive flows in public artifacts by default.
- Prefer demo accounts for training or documentation recordings.
- Clean up recordings when they are no longer needed.

## Performance Notes

- Recording adds overhead; do not leave it enabled in routine automation.
- Large videos consume disk quickly.
- Use video when visual proof matters; otherwise prefer screenshots or trace/profiler artifacts.

## Format and Compatibility

- Output format: WebM
- Good support in modern browsers and common video players

## Limitations

- Recording is for visual evidence, not fine-grained performance analysis.
- Headless environments may vary in codec support.
- Very long recordings are expensive to store and review.
