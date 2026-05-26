#!/bin/bash
# Template: Authenticated Session Workflow
# Purpose: Reuse saved auth state when possible, otherwise inspect or perform a login flow
# Usage: ./authenticated-session.sh <login-url> [state-file] [artifact-dir]
#
# Recommended alternative for routine use:
#   printf '%s' "$APP_PASSWORD" | \
#     agent-browser auth save myapp --url <login-url> --username "$APP_USERNAME" --password-stdin
#   agent-browser auth login myapp
#
# Optional environment variables:
#   AGENT_BROWSER_SESSION   Session name (default: auth-<pid>)
#   LOGIN_SUCCESS_URL       URL glob expected after successful login (default: **/dashboard)
#   LOGIN_WAIT_MODE         Load state after open/click (default: networkidle)
#   LOGIN_USER_REF          Username/email ref or selector
#   LOGIN_PASS_REF          Password ref or selector
#   LOGIN_SUBMIT_REF        Submit button ref or selector
#   APP_USERNAME            Username/email value
#   APP_PASSWORD            Password value
#   DISCOVERY_ONLY          Set to 1 to always inspect refs without attempting login
#   ARTIFACT_DIR            Where to write snapshots/screenshots (default: ./artifacts/auth-<timestamp>)
#
# Typical flow:
#   1. Run once in discovery mode to inspect refs
#   2. Export LOGIN_*_REF and APP_* values
#   3. Re-run to log in and save state

set -euo pipefail

LOGIN_URL="${1:?Usage: $0 <login-url> [state-file] [artifact-dir]}"
STATE_FILE="${2:-./auth-state.json}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="${3:-${ARTIFACT_DIR:-./artifacts/auth-$TIMESTAMP}}"
SESSION="${AGENT_BROWSER_SESSION:-auth-$$}"
LOGIN_SUCCESS_URL="${LOGIN_SUCCESS_URL:-**/dashboard}"
LOGIN_WAIT_MODE="${LOGIN_WAIT_MODE:-networkidle}"
DISCOVERY_ONLY="${DISCOVERY_ONLY:-0}"

ab() {
  agent-browser --session "$SESSION" "$@"
}

cleanup() {
  ab close 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$ARTIFACT_DIR"

echo "Auth session: $SESSION"
echo "Login URL: $LOGIN_URL"
echo "Artifacts: $ARTIFACT_DIR"

# Reuse saved state if present
if [[ -f "$STATE_FILE" ]]; then
  echo "Trying saved state: $STATE_FILE"
  if agent-browser --session "$SESSION" --state "$STATE_FILE" batch --bail \
    "open $LOGIN_URL" \
    "wait --load $LOGIN_WAIT_MODE" >/dev/null 2>&1; then

    CURRENT_URL="$(ab get url || true)"
    if [[ "$CURRENT_URL" != *"login"* && "$CURRENT_URL" != *"signin"* ]]; then
      echo "Saved state worked. Current URL: $CURRENT_URL"
      ab snapshot -i -c -d 6
      exit 0
    fi
  fi

  echo "Saved state appears expired; removing it."
  rm -f "$STATE_FILE"
  ab close 2>/dev/null || true
fi

# Open login page for discovery or login
agent-browser --session "$SESSION" batch --bail \
  "open $LOGIN_URL" \
  "wait --load $LOGIN_WAIT_MODE"

echo
echo "Login form structure:"
ab snapshot -i | tee "$ARTIFACT_DIR/login-structure.txt"

if [[ "$DISCOVERY_ONLY" == "1" ]]; then
  cat <<EOF

Discovery mode complete.
Set these variables, then rerun:
  export LOGIN_USER_REF=@e1
  export LOGIN_PASS_REF=@e2
  export LOGIN_SUBMIT_REF=@e3
  export APP_USERNAME='you@example.com'
  export APP_PASSWORD='secret'
  DISCOVERY_ONLY=0 $0 "$LOGIN_URL" "$STATE_FILE" "$ARTIFACT_DIR"
EOF
  exit 0
fi

: "${LOGIN_USER_REF:?Set LOGIN_USER_REF or run with DISCOVERY_ONLY=1 first}"
: "${LOGIN_PASS_REF:?Set LOGIN_PASS_REF or run with DISCOVERY_ONLY=1 first}"
: "${LOGIN_SUBMIT_REF:?Set LOGIN_SUBMIT_REF or run with DISCOVERY_ONLY=1 first}"
: "${APP_USERNAME:?Set APP_USERNAME}"
: "${APP_PASSWORD:?Set APP_PASSWORD}"

echo
echo "Attempting login..."
ab fill "$LOGIN_USER_REF" "$APP_USERNAME"
ab fill "$LOGIN_PASS_REF" "$APP_PASSWORD"
ab click "$LOGIN_SUBMIT_REF"

# Prefer specific URL wait, then fall back to load stabilization
ab wait --url "$LOGIN_SUCCESS_URL" || ab wait --load "$LOGIN_WAIT_MODE"

FINAL_URL="$(ab get url)"
echo "Final URL: $FINAL_URL"

if [[ "$FINAL_URL" == *"login"* || "$FINAL_URL" == *"signin"* ]]; then
  echo "Still appears to be on a login page; saving screenshot for debugging."
  ab screenshot --annotate "$ARTIFACT_DIR/login-failed.png" >/dev/null
  exit 1
fi

echo "Saving state to: $STATE_FILE"
ab state save "$STATE_FILE"
ab screenshot --annotate "$ARTIFACT_DIR/login-success.png" >/dev/null

echo "Authenticated session ready."
echo "Tip: keep $STATE_FILE out of git; it contains tokens/cookies."
echo "Artifacts written to: $ARTIFACT_DIR"
