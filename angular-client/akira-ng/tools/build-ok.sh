#!/bin/bash
# Is the dev server currently serving the code on disk?
#
# <b>It keeps serving the last good bundle when a build fails.</b> There is no
# error on the page and no error in the probe — the board simply is not the
# board in the working tree, and every screenshot and every measurement taken
# against it is a measurement of an older build. That cost an hour of debugging
# a bug that had already been fixed, twice.
#
# Usage: tools/build-ok.sh <serve.log>   (exit 1 and print the error if stale)
LOG="${1:?usage: build-ok.sh <serve.log>}"
LAST=$(grep -n "Application bundle generation \(complete\|failed\)" "$LOG" | tail -1)
if [ -z "$LAST" ]; then echo "no build line in $LOG"; exit 1; fi
case "$LAST" in
  *failed*)
    echo "STALE: the dev server is serving an older bundle. Last build failed:"
    grep -n "ERROR" -A 5 "$LOG" | tail -25
    exit 1;;
esac
echo "served bundle is current"
