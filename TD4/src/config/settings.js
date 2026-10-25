/**
 * Configuration centralisée de Flight Explorer 3D.
 *
 * Toutes les constantes "réglables" (intervalles, seuils, URL, caméras…)
 * sont regroupées ici pour éviter les nombres magiques dans le code.
 */

/** Lit une variable Vite (définie dans .env) avec une valeur par défaut. */
function env(name, fallback = '') {
  const value = import.meta.env?.[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

// Même seuil que les styles du tiroir et de la fiche, y compris les téléphones en paysage.
export const MOBILE_LAYOUT_QUERY = '(max-width: 820px), (max-width: 1024px) and (max-height: 520px) and (pointer: coarse)';

export const MOBILE_RENDER_PROFILES = {
  economy: { pixelRatio: 1, screenSpaceError: 26, cacheMb: 128, overflowMb: 32, fxaa: false },
  balanced: { pixelRatio: 1.5, screenSpaceError: 20, cacheMb: 256, overflowMb: 64, fxaa: true },
  high: { pixelRatio: 2, screenSpaceError: 16, cacheMb: 256, overflowMb: 64, fxaa: true },
};

export const SETTINGS = {
  appName: 'Flight Explorer 3D',

  cesium: {
    /** Token Cesium ion (visible côté navigateur : utiliser un token dédié et restreint). */
    ionToken: env('VITE_CESIUM_ION_TOKEN'),
  },

  adsb: {
    /**
     * URL de base de l'API ADSB.fi.
     * - En développement, Vite redirige "/adsb-api" vers https://opendata.adsb.fi/api
     *   (proxy local de développement, voir vite.config.js) car l'API n'envoie pas
     *   d'en-têtes CORS.
     * - En production, on peut renseigner l'URL d'une petite fonction serverless
     *   (voir serverless/cloudflare-worker.js) via VITE_ADSB_API_BASE.
     */
    apiBase: env(
      'VITE_ADSB_API_BASE',
      import.meta.env?.DEV ? '/adsb-api' : 'https://opendata.adsb.fi/api',
    ),
    /** Rayon maximum documenté par ADSB.fi (milles nautiques). */
    maxRadiusNm: 250,
    minRadiusNm: 25,
    /** Délai minimal entre deux requêtes (limite publique : 1 requête / seconde). */
    minRequestIntervalMs: 1100,
    /** Délai maximal d'attente d'une réponse. */
    requestTimeoutMs: 15000,
  },

  refresh: {
    /** Intervalle par défaut entre deux actualisations automatiques. */
    defaultIntervalS: 30,
    allowedIntervalsS: [15, 30, 60, 120],
    /** Délai de stabilisation de la caméra avant de requêter une nouvelle zone. */
    cameraSettleMs: 700,
    /** Intervalle minimal entre deux requêtes déclenchées par la caméra. */
    minAreaRequestGapMs: 1800,
    /** Proportion du rayon à partir de laquelle on considère que la zone a changé. */
    areaChangeRatio: 0.18,
    /** Multiplicateur appliqué après une erreur 429 (temporisation exponentielle). */
    backoffFactor: 2,
    maxBackoffS: 300,
  },

  flights: {
    /** Une position plus ancienne que ce seuil est ignorée. */
    maxPositionAgeS: 120,
    /** Durée pendant laquelle un avion absent des relevés (mais dans la zone) reste affiché. */
    missingGraceS: 45,
    /** Extrapolation maximale de la position à partir de la vitesse et du cap. */
    maxExtrapolationS: 45,
    /** Durée du lissage entre la position affichée et la nouvelle position reçue. */
    blendDurationS: 2.5,
    /** Nombre maximal de marqueurs affichés simultanément (PC vs smartphone). */
    maxMarkers: 800,
    maxMarkersMobile: 250,
  },

  camera: {
    worldView: { lon: 2.35, lat: 30, height: 18_000_000 },
    initialView: { lon: 2.35, lat: 46.6, height: 2_200_000 },
    selectFlyHeightM: 25_000,
    chase: { rangeM: 140, mobileRangeM: 68, pitchDeg: -12, mobilePitchDeg: -15, minRangeM: 32, maxRangeM: 3000 },
    /** Part du petit côté occupée par le modèle en suivi mobile. */
    mobileModelFraction: 0.62,
    cockpit: { forwardOffsetM: 18, upOffsetM: 2.5 },
    /** Lissage de la caméra (0 = immobile, 1 = aucune inertie). */
    smoothing: 0.18,
  },

  model: {
    url: `${import.meta.env?.BASE_URL ?? '/'}models/airplane.glb`,
    minimumPixelSize: 48,
    /** Le modèle généré mesure environ 38 m d'envergure (échelle réelle). */
    scale: 1,
    /** Rayon de secours avant que la sphère englobante du modèle soit disponible. */
    radiusM: 20,
  },

  storageKey: 'flight-explorer-3d:preferences',
};

/** Préférences utilisateur par défaut (sauvegardées dans localStorage). */
export const DEFAULT_PREFERENCES = {
  quality: 'high', // 'high' = Google Photorealistic 3D Tiles, 'low' = globe classique
  mobileRendering: 'balanced',
  altitudeUnit: 'm', // 'm' | 'ft'
  speedUnit: 'kmh', // 'kmh' | 'kt'
  refreshIntervalS: SETTINGS.refresh.defaultIntervalS,
  showGround: true,
  showLabels: true,
  demoMode: false,
};

