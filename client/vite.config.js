import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on every interface so phones on the same Wi-Fi can reach the
    // dev server, not just localhost.
    host: true,
    port: 5173,
    strictPort: true,
  },
})
