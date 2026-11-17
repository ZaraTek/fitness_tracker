import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Must match the GitHub repo name: https://<user>.github.io/fitness_tracker/
export default defineConfig({
  plugins: [react()],
  base: '/fitness_tracker/',
})
