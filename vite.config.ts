import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../public", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/skill": "http://127.0.0.1:3000",
    },
  },
});
