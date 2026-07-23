import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    lib: {
      cssFileName: "styles",
      entry: "src/index.tsx",
      fileName: "index",
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
