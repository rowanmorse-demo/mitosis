#!/usr/bin/env bash
# Plays the Android app in a running emulator (or a phone on adb) and saves screenshots, logcat and results.
#
#   android/tools/emulator-test.sh DEBUG_APK OUT_DIR [RELEASE_TEST_APK]
#
# DEBUG_APK gets the full test (android/tools/emulator-test.js over the WebView's DevTools socket). RELEASE_TEST_APK,
# if given, is a minified release build (built with -Pmitosis.serverUrl=http://10.0.2.2:3000 and signed with a
# throwaway key): it gets a smoke test through adb alone, since release WebViews can't be inspected. Both talk to
# a game server on this machine's port 3000 (`node server.js`), which the emulator reaches as 10.0.2.2, never to
# the live one. Run from the repo root. Exits 1 if a check failed or the app crashed.
set -uo pipefail
APK=$1 OUT=$2 REL=${3:-}
PKG=com.mitosisgame.app
status=0
ADB_BIN=$(command -v adb)
mkdir -p "$OUT/debug"
fail() { echo "FAIL  $*"; status=1; }
adb() { timeout 60 "$ADB_BIN" "$@"; }   # an emulator that stops answering must fail the test, not hang it

adb wait-for-device
adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true

# Into the job log as it happens (readable even when the artifact isn't): the app, the WebView and anything that
# kills processes, plus a heartbeat every 10 s showing that the emulator, adb and the app are still alive.
("$ADB_BIN" logcat -v time 2>/dev/null | grep --line-buffered -E "/Mitosis|chromium|cr_|AndroidRuntime|FATAL|lowmemorykiller|am_kill|Process .*mitosis|died|ANR" | head -300 | sed -u 's/^/[logcat] /') &
DIAG1=$!
(while sleep 10; do echo "[heartbeat] $(date +%T) emulator:$(pgrep -f qemu-system >/dev/null && echo up || echo GONE) adb:$(timeout 5 "$ADB_BIN" get-state 2>&1 | tr -d '\r') app-pid:$(timeout 5 "$ADB_BIN" shell pidof $PKG 2>/dev/null | tr -d '\r')"; done) &
DIAG2=$!

crashes() { # $1 = file. True if the app's own process crashed (Java or native) or hung. The WebView renderer the
  # test crashes on purpose is a process of its own (…webview:sandboxed_process…) and doesn't count.
  adb logcat -d -b crash -v time > "$1" 2>&1 || true
  adb logcat -d -b main,system -v time | grep -E "ANR in $PKG" >> "$1" || true
  grep -qE "Process: $PKG, PID|>>> $PKG <<<|ANR in $PKG" "$1"
}

# ---------------------------------------------------------------- debug build: the full test
adb logcat -c || true
"$ADB_BIN" logcat -v time > "$OUT/debug/logcat.txt" 2>&1 &   # runs all test long: no timeout
LOGCAT=$!
trap 'kill $LOGCAT $DIAG1 $DIAG2 2>/dev/null || true' EXIT
adb install -r "$APK" || fail "install $APK"
adb shell am start -W -n "$PKG/.MainActivity" --es server http://10.0.2.2:3000
SOCK=""
for _ in $(seq 60); do
  PID=$(adb shell pidof "$PKG" | tr -d '\r')
  [ -n "$PID" ] && SOCK=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_$PID" | head -1)
  [ -n "$SOCK" ] && break
  sleep 1
done
if [ -z "$SOCK" ]; then
  fail "no WebView DevTools socket for $PKG"
  adb exec-out screencap -p > "$OUT/debug/no-devtools.png"
else
  adb forward tcp:9222 "localabstract:$SOCK"
  timeout 900 node android/tools/emulator-test.js --adb --out="$OUT/debug" || status=1
fi
crashes "$OUT/debug/crashes.txt" && fail "debug build crashed or hung (see crashes.txt)"
kill $LOGCAT 2>/dev/null || true
grep -E " (I|W|E)/Mitosis" "$OUT/debug/logcat.txt" > "$OUT/debug/bridge-log.txt" || true
if [ $status -ne 0 ]; then # enough in the job log to see what went wrong without downloading the artifact
  echo "---- app and WebView log (last 80 lines)"
  grep -E "/Mitosis|chromium|cr_|WebView|AndroidRuntime|FATAL" "$OUT/debug/logcat.txt" | tail -80 || true
  echo "---- crash buffer"; tail -40 "$OUT/debug/crashes.txt" || true
fi

# ---------------------------------------------------------------- minified release build: a smoke test
if [ -n "$REL" ]; then
  mkdir -p "$OUT/release"
  adb uninstall "$PKG" >/dev/null 2>&1 || true   # signed with another key than the debug build
  adb logcat -c || true
  adb install "$REL" || fail "install $REL"
  adb shell am start -W -n "$PKG/.MainActivity"
  sleep 15
  adb exec-out screencap -p > "$OUT/release/01-launch.png"
  P0=$(adb shell pidof "$PKG" | tr -d '\r')
  [ -n "$P0" ] || fail "release build is not running after launch"
  # leave and come back: the app tells the page (native → JS) and the page logs it back (JS → native), so this
  # line in logcat proves the bridge survived minification in both directions
  adb shell input keyevent KEYCODE_HOME; sleep 2
  adb shell am start -W -n "$PKG/.MainActivity"; sleep 5
  adb exec-out screencap -p > "$OUT/release/02-returned.png"
  adb logcat -d -v time > "$OUT/release/logcat.txt" 2>&1 || true
  grep -q "Mitosis.*\[page\] app becomeActive" "$OUT/release/logcat.txt" && echo "PASS  release: bridge works both ways" || fail "release: no '[page] app becomeActive' in logcat (bridge broken?)"
  [ "$(adb shell pidof "$PKG" | tr -d '\r')" = "$P0" ] && echo "PASS  release: same process after returning" || fail "release: process changed or died"
  crashes "$OUT/release/crashes.txt" && fail "release build crashed or hung (see crashes.txt)"
fi

# ---------------------------------------------------------------- summary for the Actions run page
if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -f "$OUT/debug/results.json" ]; then
  node -e '
    const r = require(process.argv[1]);
    const rows = r.map(c => `| ${c.ok ? "✅" : c.required ? "❌" : "⚠️"} | ${c.name} | ${String(c.detail).replace(/\|/g, "\\|").slice(0, 160)} |`);
    console.log(`### Emulator test (debug build): ${r.filter(c => c.ok).length}/${r.length} checks passed\n\n| | Check | Detail |\n|---|---|---|\n${rows.join("\n")}\n\nScreenshots, logcat and results are in the **emulator-results** artifact.`);
  ' "$PWD/$OUT/debug/results.json" >> "$GITHUB_STEP_SUMMARY"
fi
exit $status
