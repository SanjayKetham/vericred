import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API stays on its own origin in production; proxying in dev keeps tokens same-origin.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
});
