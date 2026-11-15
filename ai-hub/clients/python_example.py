#!/usr/bin/env python3
"""AI Hub client example — Python standard library only (no pip install).

Usage:
    export AI_HUB_URL="https://ai.example.com"     # no trailing slash needed
    export AI_HUB_KEY="hub_..."                    # a project key created in /admin
    python3 python_example.py "اكتب ثلاث أفكار لعنوان بريد ترحيبي"

Shows two calls against the OpenAI-compatible endpoint:
  1. a normal (non-stream) completion
  2. a streamed completion, printed token by token
"""

import json
import os
import sys
import urllib.error
import urllib.request

# CPU inference is slow: keep the client timeout above the hub's LLM_TIMEOUT_MS (180 s).
TIMEOUT_SEC = 240


def settings():
    url = os.environ.get("AI_HUB_URL", "").strip().rstrip("/")
    key = os.environ.get("AI_HUB_KEY", "").strip()
    if not url or not key:
        sys.exit("Set AI_HUB_URL and AI_HUB_KEY in the environment first.")
    return url, key


def build_request(url, key, payload):
    return urllib.request.Request(
        url + "/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
        },
    )


def explain_http_error(err):
    """Hub errors use the OpenAI shape: { "error": { "message", "type", "code" } }."""
    body = err.read().decode("utf-8", "replace")
    try:
        message = json.loads(body)["error"]["message"]
    except (ValueError, KeyError, TypeError):
        message = body[:300]
    return "HTTP %s: %s" % (err.code, message)


def chat(url, key, messages, max_tokens=300):
    """Non-stream call. Returns (text, usage dict)."""
    payload = {
        # Any name works: names the hub does not know map to the hub's own model.
        "model": "gpt-4o-mini",
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": max_tokens,
    }
    with urllib.request.urlopen(build_request(url, key, payload), timeout=TIMEOUT_SEC) as res:
        data = json.loads(res.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"], data.get("usage", {})


def chat_stream(url, key, messages, max_tokens=300):
    """Streamed call. Yields text pieces as the model produces them."""
    payload = {
        "model": "gpt-4o-mini",
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "stream": True,
    }
    with urllib.request.urlopen(build_request(url, key, payload), timeout=TIMEOUT_SEC) as res:
        # Server-sent events: lines of the form "data: {json}" and a final "data: [DONE]".
        for raw in res:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except ValueError:
                continue
            if chunk.get("error"):
                raise RuntimeError(chunk["error"].get("message", "stream error"))
            choices = chunk.get("choices") or []
            if not choices:
                continue
            piece = (choices[0].get("delta") or {}).get("content")
            if piece:
                yield piece


def main():
    url, key = settings()
    question = " ".join(sys.argv[1:]) or "عرّف بنفسك في جملتين."
    messages = [
        {"role": "system", "content": "أنت مساعد موجز ودقيق. أجب بلغة السؤال."},
        {"role": "user", "content": question},
    ]

    try:
        print("--- non-stream ---")
        text, usage = chat(url, key, messages)
        print(text)
        print("usage:", usage)

        print("\n--- stream ---")
        for piece in chat_stream(url, key, messages):
            sys.stdout.write(piece)
            sys.stdout.flush()
        print()
    except urllib.error.HTTPError as err:
        sys.exit(explain_http_error(err))
    except urllib.error.URLError as err:
        sys.exit("Cannot reach the hub at %s: %s" % (url, err.reason))
    except TimeoutError:
        sys.exit("Timed out. The model may still be loading; check %s/health" % url)


if __name__ == "__main__":
    main()
