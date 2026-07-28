import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the built bundle works both under a plain HTTP server
// (python -m http.server) and directly via file:// inside the VM.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
