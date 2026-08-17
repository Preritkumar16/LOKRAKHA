import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Ignore large generated map assets and the source MBTiles database to avoid
      // Windows watch lock errors while the app is running.
      watch: process.env.DISABLE_HMR === 'true'
        ? null
        : {
            ignored: ['**/*.mbtiles', '**/public/assets/maps/**'],
          },
    },
  };
});
