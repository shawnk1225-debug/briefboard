import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Relative base + hash routing means the site works from any GitHub Pages path.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Starting a real database for the access-rule tests can be slow on a busy machine.
  test: { environment: 'node', include: ['tests/**/*.test.ts'], hookTimeout: 60000 },
})
