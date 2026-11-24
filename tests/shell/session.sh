#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Runs inside the private D-Bus session that tests/shell/run.sh creates; never
# run it against a real session. Enables the given extensions, starts a headless
# GNOME Shell, waits until every extension has a state and PATTERN (when not
# empty) appears in the log, then lets asynchronous work settle and writes each
# extension's GetExtensionInfo reply to OUT/<uuid>.
#
#   session.sh LOG OUT MONITOR PATTERN TIMEOUT UUID...
set -euo pipefail

readonly SETTLE_SECONDS=2

log="$1"
out="$2"
monitor="$3"
pattern="$4"
limit="$5"
shift 5

enabled="$(printf "'%s'," "$@")"
gsettings set org.gnome.shell enabled-extensions "[${enabled%,}]"
gsettings set org.gnome.shell disable-user-extensions false

gnome-shell --headless --no-x11 --virtual-monitor "${monitor}" >"${log}" 2>&1 &
shell=$!

# Print an extension's GetExtensionInfo reply, or nothing before the Shell is up.
info() {
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.GetExtensionInfo "$1" 2>/dev/null || true
}

# Succeed once every extension has a state and the pattern, if any, is logged.
ready() {
  local uuid reply
  for uuid in "$@"; do
    reply="$(info "${uuid}")"
    [[ "${reply}" == *"'state'"* ]] || return 1
  done
  [[ -z "${pattern}" ]] || grep -q -F -- "${pattern}" "${log}"
}

deadline=$((SECONDS + limit))
while ! ready "$@" && ((SECONDS < deadline)) && kill -0 "${shell}" 2>/dev/null; do
  sleep 1
done
sleep "${SETTLE_SECONDS}"
for uuid in "$@"; do
  info "${uuid}" >"${out}/${uuid}"
done
kill "${shell}" 2>/dev/null || true
wait "${shell}" 2>/dev/null || true
