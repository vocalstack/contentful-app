import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Contentful hosts the bundle under its own path: keep every asset address relative.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000, outDir: 'build' },
  plugins: [react()],
  server: { port: 5173 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
