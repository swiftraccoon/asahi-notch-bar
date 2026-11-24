#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Tests the compiled extension against the GNOME Shell installed on this machine.
# Run `npm run test:shell`, which compiles first.
#
#   api     The installed typelibs provide every GObject method the extension calls.
#   smoke   The real build reaches ACTIVE in a headless Shell with no errors. On a
#           notched Mac it reads the real device tree; a virtual monitor is never
#           built in, so the bar is left alone.
#   layout  The build with tests/shell/hardware.js in place of hardware.js, beside
#           the probe extension, which checks the bar across overview cycles and
#           a disable and re-enable.
#
# Each Shell runs in a private D-Bus session with its own home, dconf and runtime
# directory, so the running desktop is never touched. Set KEEP_WORK=DIR to keep
# each scenario's files, Shell log and extension replies in DIR.
set -euo pipefail

readonly MONITOR_WIDTH=1920
readonly MONITOR_HEIGHT=1080
readonly NOTCH_ROWS=64
readonly SHELL_TIMEOUT=60

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly root
readonly build="${root}/build"
uuid="$(node -p 'require(process.argv[1]).uuid' "${root}/metadata.json")"
readonly uuid
probe="$(node -p 'require(process.argv[1]).uuid' "${root}/tests/shell/probe/metadata.json")"
readonly probe

work="$(mktemp -d)"
readonly work
# Wayland socket paths are limited to 108 bytes, so runtime directories stay short.
runtime="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/notch.XXXXXX")"
readonly runtime

cleanup() {
  local mount
  # The private session can start the document portal, whose FUSE mount may
  # outlive the session briefly.
  for mount in "${runtime}"/*/doc; do
    if grep -qs " ${mount} " /proc/mounts; then
      fusermount3 -u -z "${mount}" 2>/dev/null || fusermount -u -z "${mount}" 2>/dev/null || true
    fi
  done
  if [[ -n "${KEEP_WORK:-}" ]]; then
    cp -r "${work}" "${KEEP_WORK}"
  fi
  rm -rf "${work}" "${runtime}"
}
trap 'cleanup' EXIT

failures=0
pass() { printf 'ok    %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1" >&2
  failures=$((failures + 1))
}

# Copy files into SCENARIO's extension directory for UUID.
#   stage SCENARIO UUID FILE...
stage() {
  local dest="${work}/$1/data/gnome-shell/extensions/$2"
  shift 2
  mkdir -p "${dest}"
  cp "$@" "${dest}/"
}

# Run a headless Shell for SCENARIO with the given extensions enabled.
#   run_shell SCENARIO PATTERN UUID...
run_shell() {
  local scenario="$1" pattern="$2" dir="${work}/$1"
  shift 2
  mkdir -p "${dir}/home" "${dir}/config" "${dir}/cache" "${dir}/info"
  mkdir -m 700 "${runtime}/${scenario}"
  env -i PATH=/usr/bin:/usr/sbin HOME="${dir}/home" XDG_CONFIG_HOME="${dir}/config" \
    XDG_DATA_HOME="${dir}/data" XDG_CACHE_HOME="${dir}/cache" \
    XDG_RUNTIME_DIR="${runtime}/${scenario}" \
    NOTCH_TEST_TARGET="${uuid}" NOTCH_TEST_ROWS="${NOTCH_ROWS}" \
    NOTCH_TEST_PANEL_ROWS="${MONITOR_HEIGHT}" \
    timeout $((SHELL_TIMEOUT + 30)) dbus-run-session -- "${root}/tests/shell/session.sh" \
    "${dir}/shell.log" "${dir}/info" "${MONITOR_WIDTH}x${MONITOR_HEIGHT}" "${pattern}" \
    "${SHELL_TIMEOUT}" "$@" >/dev/null 2>&1 || true
}

# Succeed when SCENARIO's Shell reports UUID ACTIVE (state 1) with no error.
active() {
  local reply="${work}/$1/info/$2"
  grep -qE "'state': <1(\.0)?>" "${reply}" 2>/dev/null && grep -qF "'error': <''>" "${reply}"
}

# Print SCENARIO's log lines that report errors from UUID's files or logger.
extension_errors() {
  grep -E "JS ERROR|CRITICAL|WARNING" "${work}/$1/shell.log" 2>/dev/null |
    grep -F -e "extensions/$2/" -e "[$3]" || true
}

# api: resolve the library directory of the installed Shell's Mutter.
gnome_shell="$(command -v gnome-shell)"
# awk reads all input: exiting early would kill ldd with SIGPIPE under pipefail.
libmutter="$(ldd "${gnome_shell}" | awk '/libmutter-[0-9]+\.so/ && !found {print $3; found = 1}')"
libdir="$(dirname "${libmutter}")"
mutter="$(basename "${libmutter}" | grep -oE 'mutter-[0-9]+')"
if GI_TYPELIB_PATH="${libdir}/${mutter}:${libdir}/gnome-shell" \
  LD_LIBRARY_PATH="${libdir}/${mutter}:${libdir}/gnome-shell" \
  gjs -m "${build}/tests/shell/api.js"; then
  pass 'api: installed typelibs match the calls'
else
  fail 'api: installed typelibs lack methods the extension calls'
fi

name="$(node -p 'require(process.argv[1]).name' "${root}/metadata.json")"
modules=("${build}"/src/*.js)

# smoke: the real build, unmodified.
stage smoke "${uuid}" "${modules[@]}" "${root}/metadata.json"
run_shell smoke '' "${uuid}"
errors="$(extension_errors smoke "${uuid}" "${name}")"
if active smoke "${uuid}" && [[ -z "${errors}" ]]; then
  pass 'smoke: the real build is ACTIVE with no errors'
else
  fail "smoke: the real build is not cleanly ACTIVE ${errors}"
fi

# layout: fake hardware plus the probe.
stage layout "${uuid}" "${modules[@]}" "${root}/metadata.json"
cp "${build}/tests/shell/hardware.js" "${work}/layout/data/gnome-shell/extensions/${uuid}/hardware.js"
stage layout "${probe}" "${build}/tests/shell/probe/extension.js" \
  "${root}/tests/shell/probe/metadata.json"
run_shell layout NOTCHPROBE "${uuid}" "${probe}"
result="$(grep -oE 'NOTCHPROBE (PASS|FAIL).*' "${work}/layout/shell.log" | head -1 || true)"
errors="$(extension_errors layout "${uuid}" "${name}")"
if active layout "${uuid}" && [[ "${result}" == 'NOTCHPROBE PASS' ]] && [[ -z "${errors}" ]]; then
  pass "layout: ${NOTCH_ROWS} rows through ${MONITOR_HEIGHT}p overview cycles, disable and re-enable"
else
  fail "layout: ${result:-no probe result} ${errors}"
fi

# The script's status is that of this test; the EXIT trap still cleans up.
((failures == 0))
