import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/clear-cut/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: false,
      injectManifest: {
        // Precache only the small app shell. Big assets (the 24MB
        // onnxruntime WASM, anything else under assets/) are runtime-
        // cached on first fetch so SW install isn't a 24MB download.
        globPatterns: ["**/*.{js,mjs,css,html,svg,ico,webmanifest}"],
        globIgnores: ["**/*.wasm"],
      },
      // No devOptions: the SW only runs in production builds. In dev,
      // Vite serves COOP/COEP via server.headers below — that's enough
      // to enable threaded WASM without dragging in vite-plugin-pwa's
      // dev shim, which races Vite's HMR client at startup.
    }),
  ],
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  optimizeDeps: {
    exclude: ["@imgly/background-removal", "onnxruntime-web"],
  },
  assetsInclude: ["**/*.wasm"],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/components/ui/**",
        "src/main.tsx",
      ],
    },
  },
});
