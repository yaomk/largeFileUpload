import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createHtmlPlugin } from 'vite-plugin-html'
import { viteInjectAppLoadingPlugin } from './plugins/inject-app-loading'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    viteInjectAppLoadingPlugin(),
    createHtmlPlugin({ minify: true }),
  ],
  resolve: {
    alias: {
      "@": '/src'
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: path => path.replace(/^\/api/, ''),
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: '[ext]/[name]-[hash].[ext]',
        chunkFileNames(chunkinfo) {
          console.log(chunkinfo);
          return  'js/[name]-[hash].js'
        },
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    }
  }
})
