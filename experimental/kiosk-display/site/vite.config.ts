import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the bundle works both under a plain HTTP server and via file:// inside the VM.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
