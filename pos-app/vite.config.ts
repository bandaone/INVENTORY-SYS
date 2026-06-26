import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    watch: {
      usePolling: true
    },
    proxy: {
      '/api': {
        target: 'http://dashboard:3000',
        changeOrigin: true,
      }
    }
  }
})
