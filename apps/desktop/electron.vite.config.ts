import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main"
    }
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } }
    }
  },
  renderer: {
    root: "src/renderer",
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html")
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@web": resolve(__dirname, "../web/src")
      }
    },
    server: {
      port: 5174,
      proxy: {
        "/api": { target: process.env["KYALULU_API_BASE"] || "http://127.0.0.1:8000", changeOrigin: true }
      }
    }
  }
});
