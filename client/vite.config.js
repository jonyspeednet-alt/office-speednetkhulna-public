import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const releaseSha = loadEnv(mode, process.cwd(), 'VITE_').VITE_RELEASE_SHA;
  if (releaseSha && !/^[a-f\d]{7,40}$/i.test(releaseSha)) {
    throw new Error('VITE_RELEASE_SHA must be a hexadecimal Git commit SHA.');
  }

  return {
    plugins: [react(), {
      name: 'release-sha-fallback',
      apply: 'build',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replace(/%VITE_RELEASE_SHA%/g, releaseSha || 'local'),
      },
    }, {
      name: 'production-document-csp',
      apply: 'build',
      transformIndexHtml: { order: 'post', handler: () => [{
        tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
        injectTo: 'head-prepend',
      }] },
    }],
    server: {
      port: 5173,
      open: true,
      // Proxy API requests to backend server
      proxy: {
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true
        },
        '/uploads': {
          target: 'http://localhost:5000',
          changeOrigin: true
        }
      }
    },
    // SPA fallback configuration
    appType: 'spa',
    build: {
      outDir: 'dist',
      // FIX: sourcemap disabled in production to prevent source code exposure
      sourcemap: false,
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
            calendar: ['@fullcalendar/react', '@fullcalendar/daygrid', '@fullcalendar/timegrid', '@fullcalendar/interaction'],
            charts: ['chart.js', 'react-chartjs-2'],
            xlsx: ['xlsx'],
            ui: ['sweetalert2', 'react-hot-toast', 'react-bootstrap', 'bootstrap'],
            utils: ['axios', 'moment', 'html2canvas'],
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@components': path.resolve(__dirname, './src/components'),
        '@pages': path.resolve(__dirname, './src/pages'),
        '@services': path.resolve(__dirname, './src/services'),
        '@styles': path.resolve(__dirname, './src/styles'),
        '@config': path.resolve(__dirname, './src/config'),
        '@hooks': path.resolve(__dirname, './src/hooks'),
      }
    }
  };
})
