import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' lets the same build run from a GitHub Pages sub-path, a custom
// domain, or inside a Capacitor shell later.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
})
