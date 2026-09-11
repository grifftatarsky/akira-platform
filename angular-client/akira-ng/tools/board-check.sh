#!/bin/bash
# Build the board, serve it statically, and report GPU cost plus any shader
# error, in one step.
#
# Never runs while `ng serve` is live: building into dist while the dev server
# watches it poisons the bundle with "ngDevMode is not defined" and every MFE
# goes blank. This kills the server first, every time, on purpose.
cd "$(dirname "$0")/.." || exit 1
pkill -f "ng serve" 2>/dev/null || true
pkill -f serve-ooze 2>/dev/null || true
sleep 1

export PATH="$PWD/node_modules/.bin:$PATH"
node tools/wgsl-lint.mjs projects/ooze/src/app/board/bab/*.ts || exit 1

BUILD=$(npx ng build ooze 2>&1)
if ! echo "$BUILD" | grep -q "bundle generation complete"; then
  echo "BUILD FAILED"
  echo "$BUILD" | grep -iE "error|✘" | head -10
  exit 1
fi

nohup node /tmp/serve-ooze.mjs "$PWD/dist/ooze/browser" > /tmp/static.log 2>&1 &
sleep 2

SHOW_LOGS=${SHOW_LOGS:-6} node tools/chrome-probe.mjs "http://localhost:4300/board/bab" '
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 25 && !window.bab; i++) await wait(1000);
if (!window.bab) return { error: "board never started" };
const b = window.bab, s = b.stage.scene, e = s.getEngine();
b.meadow.setDensity(1);
const c = b.stage.camera;
c.setTarget(new (c.target.constructor)(220, 0, 150));
c.radius = 150; c.beta = 1.36; c.alpha = -Math.PI/2 + 0.2;
await wait(8000);
const read = () => +((e.gpuTimeInFrameForMainPass.counter.lastSecAverage)/1e6).toFixed(2);
const mid = read();
c.radius = 480; c.beta = 0.95; await wait(5000); const far = read();
c.radius = 60; c.beta = 1.45; await wait(5000); const near = read();
c.radius = 150; c.beta = 1.36; await wait(2000);
return { midMs: mid, wholeBoardMs: far, nearMs: near, fps: Math.round(e.getFps()),
  shadowMs: +(((b.stage.shadows.getShadowMap()?.renderTarget?.gpuTimeInFrame?.counter?.lastSecAverage) ?? 0)/1e6).toFixed(2) };
' 2>&1 | tail -20
