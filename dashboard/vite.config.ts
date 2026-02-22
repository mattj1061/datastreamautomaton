import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_AUTOMATON_DASHBOARD_API_ORIGIN || 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
