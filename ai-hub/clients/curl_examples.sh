#!/usr/bin/env bash
# AI Hub — curl examples.
#
# Usage:
#   export AI_HUB_URL="https://ai.example.com"
#   export AI_HUB_KEY="hub_..."            # a project key created in /admin
#   bash curl_examples.sh                  # runs every example in order
#   bash curl_examples.sh health           # or one of: health models completion stream chat tagit
#
# The key is read from the environment and never printed.

set -euo pipefail

: "${AI_HUB_URL:?Set AI_HUB_URL, e.g. https://ai.example.com}"
: "${AI_HUB_KEY:?Set AI_HUB_KEY to a project key created in /admin}"

HUB="${AI_HUB_URL%/}"
AUTH="Authorization: Bearer ${AI_HUB_KEY}"
JSON="Content-Type: application/json"
# CPU inference is slow; TAGit analyses several tickers one after another.
MAX_TIME="${MAX_TIME:-300}"

title() { printf '\n=== %s ===\n' "$1"; }

# 1) Health — public, no key. "defaultModelReady": false means the model is still downloading.
health() {
  title "GET /health"
  curl -sS --max-time 20 "${HUB}/health"
  echo
}

# 2) Models the hub can serve.
models() {
  title "GET /v1/models"
  curl -sS --max-time 20 "${HUB}/v1/models" -H "${AUTH}"
  echo
}

# 3) OpenAI-compatible completion (non-stream). The model name can be anything;
#    unknown names map to the hub's configured model.
completion() {
  title "POST /v1/chat/completions"
  curl -sS --max-time "${MAX_TIME}" "${HUB}/v1/chat/completions" \
    -H "${AUTH}" -H "${JSON}" \
    -d '{
      "model": "gpt-4o-mini",
      "messages": [
        { "role": "system", "content": "أنت مساعد موجز. أجب بلغة السؤال." },
        { "role": "user", "content": "اكتب جملة ترحيب قصيرة لعميل جديد." }
      ],
      "temperature": 0.3,
      "max_tokens": 120
    }'
  echo
}

# 4) Same endpoint, streamed (server-sent events, ends with "data: [DONE]").
stream() {
  title "POST /v1/chat/completions (stream)"
  curl -sS -N --max-time "${MAX_TIME}" "${HUB}/v1/chat/completions" \
    -H "${AUTH}" -H "${JSON}" \
    -d '{
      "model": "gpt-4o-mini",
      "messages": [ { "role": "user", "content": "Name three uses of a weekly review." } ],
      "max_tokens": 120,
      "stream": true
    }'
  echo
}

# 5) Hub chat with per-project knowledge. Returns { content, sources, usage }.
#    A project key can use its own project and "general".
chat() {
  title "POST /api/chat"
  curl -sS --max-time "${MAX_TIME}" "${HUB}/api/chat" \
    -H "${AUTH}" -H "${JSON}" \
    -d '{
      "project": "general",
      "lang": "ar",
      "stream": false,
      "messages": [ { "role": "user", "content": "ما الذي تستطيع مساعدتي فيه؟" } ]
    }'
  echo
}

# 6) TAGit analysis for one sample row (use a key whose project is "tagit", or the admin key).
#    The numbers below are SAMPLE VALUES for testing the endpoint, not market data.
#    The hub adds free public headlines and SEC filings itself; it never invents them.
tagit() {
  title "POST /api/tagit/analyze"
  curl -sS --max-time "${MAX_TIME}" "${HUB}/api/tagit/analyze" \
    -H "${AUTH}" -H "${JSON}" \
    -d '{
      "lang": "ar",
      "liveFeedUpdatedAtUTC": "2026-01-01T14:30:00Z",
      "rows": [
        {
          "ticker": "AAPL",
          "signalType": "SAMPLE_BREAKOUT",
          "price": 100.00,
          "changePct": 2.5,
          "volume": 1000000,
          "relativeVolume": 1.8
        }
      ]
    }'
  echo
}

case "${1:-all}" in
  health)     health ;;
  models)     models ;;
  completion) completion ;;
  stream)     stream ;;
  chat)       chat ;;
  tagit)      tagit ;;
  all)        health; models; completion; stream; chat; tagit ;;
  *)
    echo "Unknown example: $1 (use: health models completion stream chat tagit all)" >&2
    exit 2
    ;;
esac
