import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Content Security Policy for the deployed site. Added at build time only,
// because the dev server relies on inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  'img-src \'self\' data: blob: https://*.supabase.co https://books.google.com https://books.googleusercontent.com https://covers.openlibrary.org https://archive.org https://*.archive.org',
  'connect-src \'self\' https://*.supabase.co wss://*.supabase.co https://www.googleapis.com https://openlibrary.org',
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const csp = (): Plugin => ({
  name: 'folio-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// Each build gets an id, baked into the app and published as version.json, so an open copy of
// Folio can tell when a newer one has been deployed and offer to reload.
const BUILD_ID = `${process.env.GITHUB_SHA?.slice(0, 12) ?? 'local'}-${Date.now().toString(36)}`
const version = (): Plugin => ({
  name: 'folio-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
  },
})

// base './' lets the same build run from a GitHub Pages sub-path or a custom domain.
export default defineConfig({
  plugins: [react(), csp(), version()],
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID) },
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
})
