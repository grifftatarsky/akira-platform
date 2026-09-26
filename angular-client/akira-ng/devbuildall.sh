#!/bin/sh
# Builds the host and then every remote. The host goes first because its
# stylesheet @sources the remotes and emits their Tailwind (see CLAUDE.md).
#
# Meant to run on the box that also serves the site, so it builds at the
# lowest CPU and I/O priority and with a bounded heap: the services keep
# answering, and the build is what waits. Both limits can be overridden:
#
#   NODE_OPTIONS=--max-old-space-size=4096 NG_BUILD_MAX_WORKERS=4 ./devbuildall.sh
set -eu

cd "$(dirname "$0")"

# A cap, not a reservation: V8 collects harder as it nears it instead of
# growing. A full build peaks near 1.1 GB.
case "${NODE_OPTIONS:-}" in
  *max-old-space-size*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=2048" ;;
esac
# Angular's transform workers, each with a heap of its own.
export NG_BUILD_MAX_WORKERS="${NG_BUILD_MAX_WORKERS:-2}"

low="nice -n 19"
if command -v ionice >/dev/null 2>&1; then
  low="$low ionice -c 2 -n 7"
fi

began=$(date +%s)

build() {
  started=$(date +%s)
  echo "Building $1..."
  $low ./node_modules/.bin/ng build "$2"
  echo "$1 complete in $(($(date +%s) - started))s."
}

build "Akira" "akira-ng"
build "Oozengine" "ooze"
build "President" "president"
build "Jo Peace Stickers" "jpss-ui"

echo "All builds green in $(($(date +%s) - began))s."
