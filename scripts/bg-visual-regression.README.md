# Background visual regression

Captures a thin horizontal strip of the kitchen background across ~240 frames
while the game is running, then compares per-frame mean pixel diffs.

A smooth scroll produces a stable, moderate diff between consecutive frames.
A flicker, seam jump, or parity-flip glitch produces a sudden spike that
stands out clearly.

## Run

Make sure the dev server is up at `http://localhost:8080`, then:

```bash
# First time — write baseline
node scripts/bg-visual-regression.mjs --update

# Subsequent runs — compare to baseline, exit 1 on regression
node scripts/bg-visual-regression.mjs
```

Frames around the worst-diff index are saved to
`scripts/__bg_baseline__/frames/` for manual inspection.

Requires `playwright` and `pngjs`. Install once:

```bash
bun add -d playwright pngjs
```

Override the target URL with `EGGSCAPE_URL=...`.
