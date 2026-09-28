#!/bin/sh
# Container entrypoint: a Railway volume is mounted owned by root, so give it to the unprivileged
# `node` user, then drop root before starting the server (setpriv ships with Debian's util-linux).
# Any failure here falls back to starting the server anyway: storage is optional, uptime is not.
if [ "$(id -u)" = "0" ] && id node >/dev/null 2>&1; then
  uid=$(id -u node); gid=$(id -g node)
  if [ -n "$RAILWAY_VOLUME_MOUNT_PATH" ]; then
    mkdir -p "$RAILWAY_VOLUME_MOUNT_PATH" && chown -R "$uid:$gid" "$RAILWAY_VOLUME_MOUNT_PATH" || echo "volume chown failed"
  fi
  if command -v setpriv >/dev/null 2>&1 && setpriv --reuid="$uid" --regid="$gid" --clear-groups true 2>/dev/null; then
    exec setpriv --reuid="$uid" --regid="$gid" --clear-groups node server.mjs
  fi
  echo "cannot drop privileges; starting as root"
fi
exec node server.mjs
