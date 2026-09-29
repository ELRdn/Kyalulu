import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Explicit build-time allowlist: never glob public/ or cache runtime responses.
function shellPrecache(): Plugin {
  let root: string;
  let outDir: string;
  return {
    name: "kyalulu-shell-precache",
    apply: "build",
    enforce: "post",
    configResolved(config) { root = config.root; outDir = resolve(root, config.build.outDir); },
    async writeBundle(_options, bundle) {
      const files = ["index.html", "theme-init.js", "manifest.webmanifest", "apple-touch-icon.png", "favicon.ico", "favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "mascot/nap.webp",
        ...Object.keys(bundle).filter((name) => /\.(js|css|wasm)$/.test(name)),
      ].sort();
      const hash = createHash("sha256");
      const template = await readFile(resolve(root, "public/sw.js"), "utf8");
      hash.update(template);
      const integrity: Record<string, string> = {};
      for (const file of files) {
        const content = await readFile(resolve(outDir, file));
        hash.update(file); hash.update(content);
        integrity[file] = `sha256-${createHash("sha256").update(content).digest("base64")}`;
      }
      await writeFile(resolve(outDir, "sw.js"), template
        .replace("/* BUILD_FILES */ []", JSON.stringify(files))
        .replace("/* BUILD_INTEGRITY */ {}", JSON.stringify(integrity))
        .replace("BUILD_VERSION", hash.digest("hex").slice(0, 20)));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), shellPrecache()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.KYALULU_API_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
