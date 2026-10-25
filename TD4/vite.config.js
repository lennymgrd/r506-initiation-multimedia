import { defineConfig, loadEnv } from 'vite';

/**
 * Configuration Vite.
 *
 * - `base` : chemin de publication, "/" par défaut pour Vercel.
 *   BASE_PATH peut être défini dans .env ou dans l'environnement de compilation.
 *   Le workflow GitHub Actions fournit automatiquement BASE_PATH=/<nom-du-dépôt>/.
 * - `CESIUM_BASE_URL` : dossier où Cesium trouve ses Workers, Assets, Widgets…
 *   (copiés dans public/cesium/ par scripts/copy-cesium-assets.mjs).
 * - `server.proxy` : proxy de DÉVELOPPEMENT uniquement. L'API ADSB.fi ne renvoie
 *   pas d'en-tête CORS ; le serveur Vite local relaie donc /adsb-api/* vers
 *   https://opendata.adsb.fi/api/*. Sur Vercel, vercel.json assure ce relais.
 */
export default defineConfig(({ command, mode }) => {
  const { BASE_PATH } = loadEnv(mode, process.cwd(), 'BASE_PATH');
  const base = command === 'build' ? BASE_PATH || '/' : '/';

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

