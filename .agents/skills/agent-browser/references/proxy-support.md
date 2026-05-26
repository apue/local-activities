# Proxy Support

Use this file for proxy configuration, geo-testing, corporate network access, and scraping setups.

**Related:** [commands.md](commands.md), [../SKILL.md](../SKILL.md)

## Choose the Configuration Method

| Need | Prefer |
|---|---|
| One-off command | `--proxy <url>` |
| Stable shell/session default | `AGENT_BROWSER_PROXY` or `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` |
| Bypass selected hosts | `--proxy-bypass <hosts>` or `NO_PROXY` |
| Corporate or CI default | env vars + project config |

## Basic Proxy Usage

```bash
# One-off
agent-browser --proxy "http://proxy.example.com:8080" open https://example.com

# Environment variables
export AGENT_BROWSER_PROXY="http://proxy.example.com:8080"
agent-browser open https://example.com

# Standard proxy env vars also work
export HTTP_PROXY="http://proxy.example.com:8080"
export HTTPS_PROXY="http://proxy.example.com:8080"
agent-browser open https://example.com
```

## Authenticated Proxies

Prefer environment variables over hardcoding credentials into scripts.

```bash
export AGENT_BROWSER_PROXY="http://username:password@proxy.example.com:8080"
agent-browser open https://example.com
```

If credentials are sensitive, inject them from your secret manager or shell environment instead of committing them.

## SOCKS Proxies

```bash
export ALL_PROXY="socks5://proxy.example.com:1080"
agent-browser open https://example.com

export ALL_PROXY="socks5://user:pass@proxy.example.com:1080"
agent-browser open https://example.com
```

## Proxy Bypass

Avoid routing localhost, internal services, or static hosts through the proxy when unnecessary.

```bash
agent-browser \
  --proxy "http://proxy.example.com:8080" \
  --proxy-bypass "localhost,127.0.0.1,*.internal.example.com" \
  open https://example.com

export NO_PROXY="localhost,127.0.0.1,.internal.example.com"
```

## Common Patterns

### Geo-testing

```bash
REGION_PROXY="http://eu-proxy.example.com:8080"
agent-browser --session eu --proxy "$REGION_PROXY" open https://example.com
agent-browser --session eu screenshot ./eu-home.png
agent-browser --session eu close
```

Pair proxy changes with separate sessions so state from one region does not leak into another.

### Rotating proxies for scraping

```bash
PROXIES=(
  "http://proxy1.example.com:8080"
  "http://proxy2.example.com:8080"
  "http://proxy3.example.com:8080"
)

URLS=(
  "https://site.com/page1"
  "https://site.com/page2"
  "https://site.com/page3"
)

for i in "${!URLS[@]}"; do
  proxy="${PROXIES[$((i % ${#PROXIES[@]}))]}"
  agent-browser --session "job-$i" --proxy "$proxy" open "${URLS[$i]}"
  agent-browser --session "job-$i" get text body > "output-$i.txt"
  agent-browser --session "job-$i" close
  sleep 1
done
```

### Corporate network access

```bash
export HTTP_PROXY="http://corp-proxy.company.com:8080"
export HTTPS_PROXY="http://corp-proxy.company.com:8080"
export NO_PROXY="localhost,127.0.0.1,.company.internal"

agent-browser open https://external-vendor.com
agent-browser open https://intranet.company.internal
```

## Verifying the Proxy

```bash
agent-browser --proxy "http://proxy.example.com:8080" open https://httpbin.org/ip
agent-browser get text body
```

Check that the reported IP is the proxy IP, not your local IP.

For flaky pages, also inspect:

```bash
agent-browser network requests
agent-browser console
agent-browser errors
```

## Security Guidance

- Do not commit proxy credentials.
- Prefer env vars or secret injection over inline URLs in repo scripts.
- Combine proxies with `--allowed-domains` when browsing should stay constrained.
- Be careful with MITM/inspection proxies; they may expose sensitive traffic.
- Use `--ignore-https-errors` only for controlled testing, never as a general fix.

## Performance Guidance

- Proxies add latency; only use them when the task requires them.
- Bypass local/internal hosts and unnecessary static domains where appropriate.
- Use separate sessions for different proxy routes or regions.
- Prefer direct connections for routine local development.

## Troubleshooting

### Connection failed

```bash
curl -x http://proxy.example.com:8080 https://httpbin.org/ip
```

If curl fails, fix the proxy first before debugging agent-browser.

### Certificate errors through proxy

Some inspection proxies substitute certificates.

```bash
# Testing only
agent-browser --ignore-https-errors open https://example.com
```

If this fixes the issue, solve the trust-chain problem instead of leaving the flag enabled.

### Slow or unstable browsing

- Try a nearer or healthier proxy.
- Reduce page size with `get text` instead of screenshots/snapshots where possible.
- Check `network requests` for repeated failures or timeouts.
