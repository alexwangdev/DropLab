import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the browser only talks to /api on the Vite origin; Vite forwards it to Express.
// No secrets live in the client.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
