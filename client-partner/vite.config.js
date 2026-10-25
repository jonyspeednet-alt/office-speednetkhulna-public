import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Partner portal SPA. In dev, API + uploads proxy to the office Node server.
export default defineConfig({
  plugins: [react(), {
    name: 'production-document-csp',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: () => [{
      tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
      injectTo: 'head-prepend',
    }] },
  }],
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://localhost:5001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5001', changeOrigin: true },
    },
  },
  appType: 'spa',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
