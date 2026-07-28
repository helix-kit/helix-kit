import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const PORT = Number(process.env.HELIX_E2E_PORT ?? 3200);

export default defineConfig({
  root: path.resolve(__dirname, 'harness'),
  // Shared packages export TS source; dedupe so React resolves to one instance.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
});
