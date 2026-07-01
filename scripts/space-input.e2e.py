"""Playwright e2e: verify Space (and other jump inputs) reliably trigger jumps.

Run: python3 scripts/space-input.e2e.py
Requires dev server at http://localhost:8080 with import.meta.env.DEV true.
"""
import asyncio
import os
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright

URL = "http://localhost:8080/"
OUT = Path("/tmp/browser/space-input")
OUT.mkdir(parents=True, exist_ok=True)

results = []
def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(f"{'✅' if cond else '❌'} {name}{' — ' + extra if extra else ''}")

async def get_phase(page):
    return await page.evaluate("() => window.__eggscape && window.__eggscape.getPhase()")

async def get_y(page):
    return await page.evaluate("() => window.__eggscape.getState().eggY")

async def wait_grounded(page, timeout=3.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        on_ground = await page.evaluate("() => window.__eggscape.getState().onGround")
        if on_ground:
            return
        await asyncio.sleep(0.05)



async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        page.on("console", lambda m: print("[console.error]", m.text) if m.type == "error" else None)

        await page.goto(URL, wait_until="domcontentloaded")
        await page.wait_for_function("() => !!window.__eggscape", timeout=10000)

        check("initial phase is idle", (await get_phase(page)) == "idle")
        await page.keyboard.press("Space")
        await asyncio.sleep(0.2)
        check("Space from idle starts running", (await get_phase(page)) == "running")
        await page.screenshot(path=str(OUT / "1_after_space_idle.png"))

        # ArrowUp mid-run
        await wait_grounded(page)
        g = await get_y(page)
        await page.keyboard.press("ArrowUp")
        await asyncio.sleep(0.15)
        a = await get_y(page)
        check("ArrowUp triggers jump (y goes up)", a < g, f"ground={g} air={a}")

        # Enter jumps
        await wait_grounded(page)
        g = await get_y(page)
        await page.keyboard.press("Enter")
        await asyncio.sleep(0.15)
        a = await get_y(page)
        check("Enter triggers jump", a < g, f"ground={g} air={a}")

        # Canvas tap
        await wait_grounded(page)
        g = await get_y(page)
        await page.locator("canvas").click(position={"x": 400, "y": 300})
        await asyncio.sleep(0.15)
        a = await get_y(page)
        check("Canvas tap triggers jump", a < g, f"ground={g} air={a}")


        # Wait for gameover (stop pressing anything)
        t0 = time.time()
        while time.time() - t0 < 25 and (await get_phase(page)) != "gameover":
            await asyncio.sleep(0.2)
        check("game reaches gameover without jumping", (await get_phase(page)) == "gameover")
        await page.screenshot(path=str(OUT / "2_gameover.png"))

        # Click Try Again then press Space — the flaky case
        await page.get_by_role("button", name="Try again").click()
        await asyncio.sleep(0.15)
        check("Try Again returns to idle", (await get_phase(page)) == "idle")
        await page.screenshot(path=str(OUT / "3_after_tryagain.png"))
        await page.keyboard.press("Space")
        await asyncio.sleep(0.2)
        check("Space right after Try Again starts running", (await get_phase(page)) == "running")
        await page.screenshot(path=str(OUT / "4_space_after_tryagain.png"))

        # Loop the flaky case 5x
        flaky = 0
        for i in range(5):
            t0 = time.time()
            while time.time() - t0 < 25 and (await get_phase(page)) != "gameover":
                await asyncio.sleep(0.2)
            if (await get_phase(page)) != "gameover":
                flaky += 1
                continue
            await page.get_by_role("button", name="Try again").click()
            await asyncio.sleep(0.12)
            await page.keyboard.press("Space")
            await asyncio.sleep(0.2)
            if (await get_phase(page)) != "running":
                flaky += 1
        check("5x tryAgain->Space loop, no misses", flaky == 0, f"misses={flaky}")

        await browser.close()

    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
