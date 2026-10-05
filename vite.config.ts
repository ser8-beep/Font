import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build`               -> dist/         installable PWA, works offline after first load
// `vite build --mode single` -> dist-single/  one self-contained HTML file for a USB stick / zip
export default defineConfig(({ mode }) => {
  if (mode === 'single') {
    return {
      base: './',
      plugins: [react(), viteSingleFile()],
      build: { outDir: 'dist-single', assetsInlineLimit: 100_000_000 },
    };
  }
  return {
    base: './',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Photo → Font Station',
          short_name: 'Font Station',
          description: 'Turn a photo of handmade letters into a font.',
          theme_color: '#1b1b3a',
          background_color: '#fffaf0',
          display: 'standalone',
          start_url: './',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,jpg,webmanifest}'],
          navigateFallbackDenylist: [/^\/api/, /^\/ws/],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
    server: { host: true },
    preview: { host: true },
  };
});
