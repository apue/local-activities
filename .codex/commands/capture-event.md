---
description: "Capture one local activity URL through the local editor-agent path"
---

Run the project-local editor capture command for the user-provided URL or shared text:

```bash
pnpm editor:capture -- --env-file .env.local "$ARGUMENTS"
```

Use this command as a thin wrapper only. The reusable implementation is
`scripts/editor-agent-capture.mjs`, so the flow remains available from Codex,
the terminal, and future local-agent automation.
