# Authentication Patterns

Use this file for login flows, session reuse, OAuth, 2FA, and secret-handling choices.

**Related:** [session-management.md](session-management.md), [../SKILL.md](../SKILL.md)

## Choose the Right Auth Strategy

| Need | Prefer |
|---|---|
| Keep passwords hidden from the model and shell history | `auth save ... --password-stdin` + `auth login` |
| Reuse a saved cookie/storage snapshot | `state save` / `state load` or `--state <path>` |
| Auto-save lightweight auth state between runs | `--session-name <name>` |
| Reuse an existing Chrome login/profile | `--profile <name|path>` |
| Attach to a running Chrome that is already logged in | `--auto-connect` or `--cdp <port|url>` |

## Preferred: Auth Vault

Use the auth vault unless the task explicitly needs raw credentials in the page.

```bash
printf '%s' "$APP_PASSWORD" | \
  agent-browser auth save myapp \
    --url https://app.example.com/login \
    --username "$APP_USERNAME" \
    --password-stdin

agent-browser auth login myapp
```

Notes:
- Auth vault entries are encrypted.
- If `AGENT_BROWSER_ENCRYPTION_KEY` is not set, agent-browser auto-generates a local key at `~/.agent-browser/.encryption-key`.
- Domain allowlists still apply.
- `auth list`, `auth show <name>`, and `auth delete <name>` manage saved entries.

## Basic Login Flow

Use this when the auth vault is not appropriate or the form is unusual.

```bash
agent-browser open https://app.example.com/login
agent-browser wait --load networkidle
agent-browser snapshot -i

agent-browser fill @e1 "$APP_USERNAME"
agent-browser fill @e2 "$APP_PASSWORD"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
```

Verify the result with `get url`, `snapshot -i`, `console`, or `errors`.

## Save and Restore Auth State

```bash
# After logging in successfully
agent-browser state save ./auth-state.json

# Later
agent-browser --state ./auth-state.json open https://app.example.com/dashboard
```

Use state files when:
- the login flow is expensive,
- the environment is ephemeral,
- or you need to hand off an authenticated context between runs.

Treat these files as secrets.

```bash
echo "*.auth-state.json" >> .gitignore
```

## Auto-Persist with `--session-name`

Use this when you want cookies and localStorage to persist automatically by name.

```bash
agent-browser --session-name myapp open https://app.example.com/login
# complete login
agent-browser close

# next run
agent-browser --session-name myapp open https://app.example.com/dashboard
```

Combine with `AGENT_BROWSER_ENCRYPTION_KEY` if you want encrypted saved state at rest.

## Reuse a Real Browser Profile

Use a Chrome profile when the site depends on existing browser state or extensions.

```bash
# Reuse an existing named Chrome profile
agent-browser --profile Default open https://mail.google.com

# Or use a persistent custom directory
agent-browser --profile ~/.myapp-profile open https://app.example.com
```

Use this sparingly in automation because it broadens available cookies and browsing state.

## Attach to a Running Chrome

When a human already logged in manually, reuse that state:

```bash
agent-browser --auto-connect snapshot -i
agent-browser --auto-connect open https://app.example.com/dashboard

# Or use an explicit CDP endpoint
agent-browser --cdp 9222 snapshot -i
```

This is often the fastest way to work with SSO-heavy sites.

## OAuth and SSO

For redirect-based logins, prefer waiting on URL transitions rather than fixed delays.

```bash
agent-browser open https://app.example.com/auth/google
agent-browser wait --url "**accounts.google.com**"
agent-browser snapshot -i
agent-browser fill @e1 "$GOOGLE_USERNAME"
agent-browser click @e2
agent-browser wait --text "Enter your password"
agent-browser snapshot -i
agent-browser fill @e3 "$GOOGLE_PASSWORD"
agent-browser click @e4
agent-browser wait --url "**app.example.com**"
```

After success, save state or switch to `--session-name`.

## Two-Factor Authentication

For MFA or CAPTCHA, prefer headed mode and let the human complete the step.

```bash
agent-browser --headed open https://app.example.com/login
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser fill @e1 "$APP_USERNAME"
agent-browser fill @e2 "$APP_PASSWORD"
agent-browser click @e3

# wait for manual completion
agent-browser wait --url "**/dashboard"
agent-browser state save ./post-2fa.json
```

## HTTP Basic Auth

```bash
agent-browser set credentials username password
agent-browser open https://protected.example.com
```

Use only for sites that truly use browser-level basic auth.

## Cookie or Storage Injection

Use this only when the task explicitly requires direct token injection.

```bash
agent-browser cookies set session_token abc123 --domain app.example.com --secure --httpOnly
agent-browser storage local set authToken abc123
agent-browser open https://app.example.com/dashboard
```

Prefer the auth vault or saved state over raw token injection when possible.

## Security Checklist

- Prefer `auth save ... --password-stdin` over inline `--password`.
- Do not commit state files or custom profiles.
- Prefer `--allowed-domains` on sensitive login flows.
- Prefer `--content-boundaries` when reading page text after login.
- Avoid broad `--headers` with long-lived bearer tokens unless required.
- Clear state after use in CI if persistence is unnecessary.

```bash
agent-browser cookies clear
agent-browser storage local clear
rm -f ./auth-state.json
```

## Troubleshooting

### Login succeeded visually but automation still sees the login page

- Wait for a stronger condition: `wait --url`, `wait --text`, or a specific post-login element.
- Check `network requests`, `console`, and `errors`.
- Re-snapshot after redirects or SPA transitions.

### Saved state no longer works

- Session likely expired; perform a fresh login and overwrite the state file.
- If the site ties sessions to device fingerprints, prefer `--profile` or `--auto-connect`.

### Login form lives inside an iframe

```bash
agent-browser frame "#login-iframe"
agent-browser snapshot -i
# interact inside frame
agent-browser frame main
```
