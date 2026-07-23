import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": "http://127.0.0.1:8790",
      "/openapi.json": "http://127.0.0.1:8790",
      "/tasks": "http://127.0.0.1:8790",
    },
  },
});
