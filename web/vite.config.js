import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev and preview talk to the live deployment by default, so `npm run dev` on a laptop shows real data.
// Point at a local engine with LG_API=http://localhost:8000 (and LG_STDB=http://localhost:3000 for SpacetimeDB).
const API = process.env.LG_API ?? 'https://htb.stefvuck.dev/api'
const STDB = process.env.LG_STDB ?? 'https://htb.stefvuck.dev'
const proxy = {
  '/api': {
    target: API,
    changeOrigin: true,
    secure: true,
    // The target already ends in /api for the live site (Caddy strips it); a local uvicorn serves at the root.
    rewrite: (p) => p.replace(/^\/api/, ''),
  },
  '/v1': { target: STDB, changeOrigin: true, secure: true, ws: true },
}

export default defineConfig({
  plugins: [react()],
  // Event movies read the committed event library in ../data/events, outside the web root.
  server: { proxy, fs: { allow: ['..'] } },
  preview: { proxy },
})
