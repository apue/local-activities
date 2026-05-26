#!/bin/bash
# Template: Form Automation Workflow
# Purpose: Open a form, inspect refs, optionally fill known fields, and capture evidence
# Usage: ./form-automation.sh <form-url> [output-dir]
#
# Optional environment variables:
#   AGENT_BROWSER_SESSION   Session name (default: form-<pid>)
#   FORM_WAIT_MODE          Load state after open (default: networkidle)
#   FORM_NAME_REF           Ref or selector for name field
#   FORM_EMAIL_REF          Ref or selector for email field
#   FORM_PASSWORD_REF       Ref or selector for password field
#   FORM_SELECT_REF         Ref or selector for dropdown
#   FORM_SELECT_VALUE       Value to select
#   FORM_CHECK_REF          Ref or selector for checkbox
#   FORM_SUBMIT_REF         Ref or selector for submit button
#   FORM_NAME_VALUE         Value for name field
#   FORM_EMAIL_VALUE        Value for email field
#   FORM_PASSWORD_VALUE     Value for password field
#
# Best practice:
#   1. Run once without refs to inspect the form structure
#   2. Export the refs you want to use
#   3. Re-run to fill and submit automatically

set -euo pipefail

FORM_URL="${1:?Usage: $0 <form-url> [output-dir]}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${2:-./artifacts/form-$TIMESTAMP}"
SESSION="${AGENT_BROWSER_SESSION:-form-$$}"
FORM_WAIT_MODE="${FORM_WAIT_MODE:-networkidle}"

mkdir -p "$OUTPUT_DIR"

ab() {
  agent-browser --session "$SESSION" "$@"
}

cleanup() {
  ab close 2>/dev/null || true
}
trap cleanup EXIT

echo "Form automation session: $SESSION"
echo "Target: $FORM_URL"

action_taken=0

# Open and stabilize the page
agent-browser --session "$SESSION" batch --bail \
  "open $FORM_URL" \
  "wait --load $FORM_WAIT_MODE"

echo
echo "Interactive structure:"
ab snapshot -i | tee "$OUTPUT_DIR/form-structure.txt"

# Optional field filling based on exported refs/selectors
if [[ -n "${FORM_NAME_REF:-}" && -n "${FORM_NAME_VALUE:-}" ]]; then
  ab fill "$FORM_NAME_REF" "$FORM_NAME_VALUE"
  action_taken=1
fi

if [[ -n "${FORM_EMAIL_REF:-}" && -n "${FORM_EMAIL_VALUE:-}" ]]; then
  ab fill "$FORM_EMAIL_REF" "$FORM_EMAIL_VALUE"
  action_taken=1
fi

if [[ -n "${FORM_PASSWORD_REF:-}" && -n "${FORM_PASSWORD_VALUE:-}" ]]; then
  ab fill "$FORM_PASSWORD_REF" "$FORM_PASSWORD_VALUE"
  action_taken=1
fi

if [[ -n "${FORM_SELECT_REF:-}" && -n "${FORM_SELECT_VALUE:-}" ]]; then
  ab select "$FORM_SELECT_REF" "$FORM_SELECT_VALUE"
  action_taken=1
fi

if [[ -n "${FORM_CHECK_REF:-}" ]]; then
  ab check "$FORM_CHECK_REF"
  action_taken=1
fi

if [[ -n "${FORM_SUBMIT_REF:-}" ]]; then
  echo
  echo "Submitting form..."
  ab click "$FORM_SUBMIT_REF"
  ab wait --load "$FORM_WAIT_MODE" || true
  action_taken=1
fi

echo
echo "Current URL:"
ab get url | tee "$OUTPUT_DIR/final-url.txt"

echo
echo "Post-action structure:"
ab snapshot -i -c -d 6 | tee "$OUTPUT_DIR/final-structure.txt"

ab screenshot --annotate "$OUTPUT_DIR/final-annotated.png" >/dev/null

echo
echo "Artifacts written to: $OUTPUT_DIR"
if [[ "$action_taken" -eq 0 ]]; then
  cat <<'EOF'
No fields were filled because no FORM_*_REF / FORM_*_VALUE variables were set.
Next step:
  export FORM_EMAIL_REF=@e2
  export FORM_EMAIL_VALUE='user@example.com'
  export FORM_SUBMIT_REF=@e5
  ./form-automation.sh <form-url>
EOF
fi
