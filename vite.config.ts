import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Relative base + hash routing means the site works from any GitHub Pages path.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
