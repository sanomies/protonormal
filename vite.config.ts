import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// The cloudflare plugin runs worker/index.ts (including the RoomDO Durable
// Object) inside workerd during `vite dev`, so the WebSocket room server is
// live on the same port as the HMR client.
export default defineConfig({
  plugins: [react(), cloudflare()],
})
