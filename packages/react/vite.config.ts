import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    lib: {
      cssFileName: "styles",
      entry: {
        core: "src/core.ts",
        headless: "src/headless.tsx",
        index: "src/index.tsx",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "@cloudflare/think/react",
        "agents/react",
        "ai",
        "react",
        "react-dom",
        "react/jsx-runtime",
      ],
    },
  },
});
