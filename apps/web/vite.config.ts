import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiProxyUrl = process.env.API_PROXY_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    proxy: {
      '/api': apiProxyUrl,
    },
  },
});
