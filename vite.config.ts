import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { apiPlugin } from "./src/server/apiPlugin.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), apiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src/client"),
      "@shared": path.resolve(import.meta.dirname, "./src/shared"),
    },
  },
  server: {
    port: 3000,
  },
});
