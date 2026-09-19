import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Plain HTTP so typing `localhost:3001` (which Chrome treats as http://)
    // loads the app. Google allows http://localhost redirect URIs for local dev.
    port: 3001,
    proxy: {
      // Auth + API requests are forwarded to the Express server so the
      // browser only ever talks to one origin (cookies stay first-party).
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
