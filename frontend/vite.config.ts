import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
})
