import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Backend API + WebSocket terminal run on :3001.
// Vite dev server proxies /api and /ws to the backend so the SPA talks to one origin.
// NOTE: targets use 127.0.0.1 (not "localhost"): on Windows "localhost" can resolve
// to IPv6 ::1 while the backend binds IPv4, which breaks the WebSocket upgrade.
export default defineConfig({
  // Relative base: assets load correctly both at the root (http://host:3001/)
  // and behind a reverse-proxy subpath (https://host/term/).
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: true },
    },
  },
})
