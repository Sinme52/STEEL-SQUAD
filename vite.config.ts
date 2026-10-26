import { defineConfig } from 'vite';

// Electron から file:// で読むので相対パスで出力する
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
});
