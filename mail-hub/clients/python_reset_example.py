"""Minimal integration for a Python project (standard library only).

Env: MAIL_HUB_URL=https://mailer.tryn.cc  MAIL_HUB_KEY=mh_<project>_...
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("MAIL_HUB_URL", "")
KEY = os.environ.get("MAIL_HUB_KEY", "")


def call(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def forgot_password(user):
    """Call only when the user exists; always show the visitor the same neutral message."""
    return call("/v1/password-reset", {"email": user["email"], "user_id": str(user["id"]), "locale": "ar"})


def check_reset_link(token):
    status, data = call("/v1/password-reset/verify", {"token": token})
    return data if status == 200 else None


def complete_reset(token, set_password, new_password):
    status, data = call("/v1/password-reset/consume", {"token": token})
    if status != 200:
        return False
    set_password(data["user_id"], new_password)  # hash it and sign out other sessions
    call("/v1/notify/password-changed", {"email": data["email"]})
    return True


if __name__ == "__main__":
    if not (BASE and KEY and len(sys.argv) > 1):
        sys.exit("usage: MAIL_HUB_URL=… MAIL_HUB_KEY=… python3 python_reset_example.py you@example.com")
    print(call("/v1/password-reset", {"email": sys.argv[1], "locale": "ar"}))
