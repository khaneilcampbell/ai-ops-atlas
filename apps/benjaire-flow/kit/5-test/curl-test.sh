#!/usr/bin/env bash
# Benjaire Flow: send a test inquiry straight to Flow 1.
# Usage:  FLOW_URL=https://YOUR-N8N/webhook/flow-intake FLOW_KEY=your-intake-key TEST_EMAIL=you@example.com bash curl-test.sh
set -euo pipefail
: "${FLOW_URL:?Set FLOW_URL to your intake address}"
: "${FLOW_KEY:?Set FLOW_KEY to your intake_key}"
TEST_EMAIL="${TEST_EMAIL:-you@example.com}"

curl -sS -w "\nHTTP %{http_code}\n" -X POST "$FLOW_URL" \
  -H "Content-Type: application/json" \
  -H "x-flow-key: $FLOW_KEY" \
  -d "{\"name\":\"Test Person\",\"email\":\"$TEST_EMAIL\",\"company\":\"Test Co\",\"message\":\"Testing the new inquiry pipeline. We would like help with our client onboarding next month.\",\"source\":\"curl-test\"}"

# Expect: {"ok":true,"ref":"INQ-..."} and HTTP 200, then an owner alert and an acknowledgement.
