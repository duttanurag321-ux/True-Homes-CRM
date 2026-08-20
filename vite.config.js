import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// IMPORTANT: if you deploy to https://<username>.github.io/<repo-name>/
// set base to '/<repo-name>/'. If you deploy to a custom domain or to
// https://<username>.github.io/ (a "user site" repo), set base to '/'.
export default defineConfig({
  base: '/True-Homes-CRM/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'True Homes',
        short_name: 'True Homes',
        description: 'True Homes — real estate lead & pipeline CRM',
        theme_color: '#B08D3E',
        background_color: '#F7F5F0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/true-homes-crm/',
        scope: '/true-homes-crm/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
