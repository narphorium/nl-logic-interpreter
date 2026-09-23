// Builds the notebook's proof widget into one script, dist/widget/proof-widget.js, which
// notebooks/proofWidget.ts sends to the notebook as the widget's front end. It declares a global,
// NLProofWidget, holding the widget's render function.
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src/client"),
      "@shared": path.resolve(import.meta.dirname, "./src/shared"),
    },
  },
  // Library builds leave this for the host to define, and React needs it
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist/widget",
    lib: {
      entry: path.resolve(import.meta.dirname, "./src/client/widget/index.tsx"),
      formats: ["iife"],
      name: "NLProofWidget",
      fileName: () => "proof-widget.js",
    },
  },
});
