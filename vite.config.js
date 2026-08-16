import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3333',
      '/raw-image': 'http://localhost:3333'
    },
    watch: {
      // The backend rewrites this on every scan/apply/save-config call — without this,
      // each write triggers a full-page reload, which re-scans on mount, which rewrites
      // it again, forever.
      ignored: ['**/blur_studio_config.json']
    }
  }
});
