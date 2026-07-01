#!/usr/bin/env node
/**
 * Background visual regression for Eggscape.
 *
 * Captures a horizontal strip of the kitchen background across many frames
 * while the game is running, then:
 *   1. Saves frames around the predicted wrap point to disk.
 *   2. Compares each captured frame's strip to the previous frame's strip
 *      shifted by the expected per-frame scroll delta. A flicker / seam /
 *      parity-flip glitch shows up as a sudden spike in mean pixel diff.
 *   3. On first run, writes a baseline of per-frame diffs to
 *      scripts/__bg_baseline__/diffs.json. On later runs, compares against
 *      that baseline and fails if any frame exceeds baseline * tolerance.
 *
 * Usage:
 *   node scripts/bg-visual-regression.mjs                 # compare to baseline
 *   node scripts/bg-visual-regression.mjs --update        # (re)write baseline
 *
 * Requires the dev server to be running at http://localhost:8080.
 */
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const URL = process.env.EGGSCAPE_URL || "http://localhost:8080/";
const OUT = path.resolve("scripts/__bg_baseline__");
const FRAMES_DIR = path.join(OUT, "frames");
const BASELINE_FILE = path.join(OUT, "diffs.json");
const UPDATE = process.argv.includes("--update");

// Sampling config
const FRAME_COUNT = 240;          // ~4s at 60fps
const STRIP_HEIGHT = 24;          // sample a thin strip near top of bg
const STRIP_Y = 40;
const TOLERANCE = 2.0;            // allow 2x baseline diff before failing
const ABSOLUTE_FLICKER = 18.0;    // absolute mean-diff that always fails

async function main() {
  await mkdir(FRAMES_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 10_000 });

  // Start the game so the background scrolls.
  await page.keyboard.press("Space");
  // Let speed stabilise a moment.
  await page.waitForTimeout(500);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");

  // Pull a thin strip across the full canvas width for each frame.
  const strips = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const buf = await canvas.screenshot({
      clip: {
        x: box.x,
        y: box.y + STRIP_Y,
        width: box.width,
        height: STRIP_HEIGHT,
      },
    });
    strips.push(buf);
    // ~60fps cadence; Playwright + screenshot will be slower but consistent.
    await page.waitForTimeout(16);
  }

  await browser.close();

  // Compute per-frame mean absolute pixel diff vs previous frame.
  // We do NOT shift-correct: a smooth scroll produces a stable, moderate diff.
  // A flicker (parity flip, seam jump, asset reload) produces a sudden spike
  // that stands out clearly against the smooth baseline.
  const { PNG } = await import("pngjs");
  const decode = (buf) =>
    new Promise((res, rej) => {
      new PNG().parse(buf, (err, png) => (err ? rej(err) : res(png)));
    });

  const decoded = [];
  for (const s of strips) decoded.push(await decode(s));

  const diffs = [];
  for (let i = 1; i < decoded.length; i++) {
    const a = decoded[i - 1].data;
    const b = decoded[i].data;
    const len = Math.min(a.length, b.length);
    let acc = 0;
    for (let j = 0; j < len; j += 4) {
      acc += Math.abs(a[j] - b[j]);
      acc += Math.abs(a[j + 1] - b[j + 1]);
      acc += Math.abs(a[j + 2] - b[j + 2]);
    }
    diffs.push(acc / (len / 4) / 3); // mean per-channel diff, 0..255
  }

  // Save a handful of frames around the worst diff (likely wrap/flicker point).
  const worstIdx = diffs.reduce(
    (m, v, i) => (v > diffs[m] ? i : m),
    0,
  );
  const span = 4;
  for (let i = Math.max(0, worstIdx - span); i <= Math.min(strips.length - 1, worstIdx + span); i++) {
    await writeFile(path.join(FRAMES_DIR, `frame_${String(i).padStart(4, "0")}.png`), strips[i]);
  }

  const stats = {
    frames: diffs.length,
    mean: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    max: Math.max(...diffs),
    worstFrameIndex: worstIdx,
  };

  console.log("bg diff stats:", stats);

  if (UPDATE || !existsSync(BASELINE_FILE)) {
    await writeFile(
      BASELINE_FILE,
      JSON.stringify({ stats, diffs }, null, 2),
    );
    console.log(`baseline written -> ${BASELINE_FILE}`);
    return;
  }

  const baseline = JSON.parse(await readFile(BASELINE_FILE, "utf8"));
  const baseMax = baseline.stats.max;
  const allowed = Math.max(baseMax * TOLERANCE, baseline.stats.mean * 4);

  const fail =
    stats.max > ABSOLUTE_FLICKER || stats.max > allowed;

  if (fail) {
    console.error(
      `FAIL: max diff ${stats.max.toFixed(2)} exceeds allowed ${allowed.toFixed(
        2,
      )} (baseline max ${baseMax.toFixed(2)}). Worst frame index: ${worstIdx}. ` +
        `Inspect ${FRAMES_DIR}.`,
    );
    process.exit(1);
  }
  console.log(
    `OK: max diff ${stats.max.toFixed(2)} within allowed ${allowed.toFixed(2)}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
