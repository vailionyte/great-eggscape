// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Game images live on Lovable CDN (`/__l5e/assets-v1/...`). Local dev proxies them when
// LOVABLE_PREVIEW_HOST is set — derive it from asset metadata if not already in env.
if (!process.env.LOVABLE_PREVIEW_HOST) {
  try {
    const meta = JSON.parse(
      readFileSync(resolve("src/assets/egg.png.asset.json"), "utf8"),
    ) as { project_id?: string };
    if (meta.project_id) {
      process.env.LOVABLE_PREVIEW_HOST = `id-preview--${meta.project_id}.lovable.app`;
    }
  } catch {
    /* asset metadata missing — proxy stays disabled */
  }
}

export default defineConfig({
  nitro: { preset: "vercel" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
