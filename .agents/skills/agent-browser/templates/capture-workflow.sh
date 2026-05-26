#!/bin/bash
# Template: Content Capture Workflow
# Purpose: Capture page text, structure, screenshots, and PDF with optional auth reuse
# Usage: ./capture-workflow.sh <url> [output-dir]
#
# Optional environment variables:
#   AGENT_BROWSER_SESSION   Session name (default: capture-<pid>)
#   AUTH_STATE              Path to a saved state JSON file
#   CAPTURE_WAIT_MODE       Load state after open (default: networkidle)
#   CAPTURE_SCOPE           CSS selector to scope snapshots/text extraction
#
# Output files:
#   metadata.txt
#   page-full.png
#   page-annotated.png
#   page-structure.txt
#   page-text.txt
#   page.pdf

set -euo pipefail

TARGET_URL="${1:?Usage: $0 <url> [output-dir]}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${2:-./artifacts/capture-$TIMESTAMP}"
SESSION="${AGENT_BROWSER_SESSION:-capture-$$}"
CAPTURE_WAIT_MODE="${CAPTURE_WAIT_MODE:-networkidle}"
CAPTURE_SCOPE="${CAPTURE_SCOPE:-}"

mkdir -p "$OUTPUT_DIR"

ab() {
  agent-browser --session "$SESSION" "$@"
}

cleanup() {
  ab close 2>/dev/null || true
}
trap cleanup EXIT

echo "Capture session: $SESSION"
echo "Target: $TARGET_URL"

if [[ -n "${AUTH_STATE:-}" && -f "$AUTH_STATE" ]]; then
  echo "Using auth state: $AUTH_STATE"
  agent-browser --session "$SESSION" --state "$AUTH_STATE" batch --bail \
    "open $TARGET_URL" \
    "wait --load $CAPTURE_WAIT_MODE"
else
  agent-browser --session "$SESSION" batch --bail \
    "open $TARGET_URL" \
    "wait --load $CAPTURE_WAIT_MODE"
fi

TITLE="$(ab get title)"
URL="$(ab get url)"
{
  echo "Title: $TITLE"
  echo "URL: $URL"
  echo "Captured at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} | tee "$OUTPUT_DIR/metadata.txt"

ab screenshot --full "$OUTPUT_DIR/page-full.png" >/dev/null
ab screenshot --annotate "$OUTPUT_DIR/page-annotated.png" >/dev/null

if [[ -n "$CAPTURE_SCOPE" ]]; then
  ab snapshot -s "$CAPTURE_SCOPE" -i -c -d 8 > "$OUTPUT_DIR/page-structure.txt"
  ab get text "$CAPTURE_SCOPE" > "$OUTPUT_DIR/page-text.txt"
else
  ab snapshot -i -c -d 8 > "$OUTPUT_DIR/page-structure.txt"
  ab get text body > "$OUTPUT_DIR/page-text.txt"
fi

ab pdf "$OUTPUT_DIR/page.pdf" >/dev/null

echo
echo "Capture complete:"
ls -la "$OUTPUT_DIR"
