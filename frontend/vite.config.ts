import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend talks to the backend through the Vite dev proxy at
// /api, so the browser never has to reach the backend directly.
// That is what fixes the login "Network Error" in Codespaces:
// previously the app guessed a separate -8000.app.github.dev URL,
// which only works if the backend is running AND that port is
// forwarded AND made visible. With the proxy, the frontend origin
// (5173) forwards /api to the backend on the same machine, so it
// works on desktop, in Codespaces, and on a phone opening the
// Codespaces frontend URL.
//
// Backend target: VITE_BACKEND_URL (docker compose sets it to
// http://backend:8000), otherwise http://localhost:8000.
const backendTarget = process.env.VITE_BACKEND_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
})
