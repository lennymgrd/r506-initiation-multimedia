import { defineConfig } from 'vite';

/**
 * Configuration Vite.
 *
 * - `base` : chemin de publication. Sur GitHub Pages, un dépôt "flight-explorer-3d"
 *   est servi depuis https://UTILISATEUR.github.io/flight-explorer-3d/.
 *   Le workflow GitHub Actions fournit automatiquement BASE_PATH=/<nom-du-dépôt>/.
 * - `CESIUM_BASE_URL` : dossier où Cesium trouve ses Workers, Assets, Widgets…
 *   (copiés dans public/cesium/ par scripts/copy-cesium-assets.mjs).
 * - `server.proxy` : proxy de DÉVELOPPEMENT uniquement. L'API ADSB.fi ne renvoie
 *   pas d'en-tête CORS ; le serveur Vite local relaie donc /adsb-api/* vers
 *   https://opendata.adsb.fi/api/*. Ce proxy n'existe pas en production.
 */
export default defineConfig(({ command }) => {
  const base = command === 'build' ? process.env.BASE_PATH || '/flight-explorer-3d/' : '/';

  return {
    base,
    define: {
      CESIUM_BASE_URL: JSON.stringify(`${base}cesium/`),
    },
    server: {
      host: true,
      proxy: {
        '/adsb-api': {
          target: 'https://opendata.adsb.fi',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/adsb-api/, '/api'),
        },
      },
    },
    preview: {
      host: true,
      proxy: {
        '/adsb-api': {
          target: 'https://opendata.adsb.fi',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/adsb-api/, '/api'),
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 6000,
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.js'],
    },
  };
});

