import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // During development the API runs on :4000; in production both are served
    // from the same origin so no proxy is needed.
    proxy: { "/api": "http://localhost:4000" },
  },
  build: { outDir: "dist", sourcemap: false },
});
