/**
 * Création et configuration du globe CesiumJS.
 *
 * Deux modes graphiques :
 *  - "high" : Google Photorealistic 3D Tiles (via Cesium ion) — globe Cesium masqué ;
 *  - "low"  : globe Cesium classique avec imagerie (Bing via Cesium ion si le token
 *             le permet, sinon l'imagerie Natural Earth II embarquée dans Cesium).
 *
 * Si les tuiles Google échouent, on revient automatiquement au mode léger :
 * l'écran n'est jamais vide.
 */
import {
  buildModuleUrl,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  createGooglePhotorealistic3DTileset,
  DirectionalLight,
  Ion,
  IonGeocodeProviderType,
  IonGeocoderService,
  IonImageryProvider,
  Math as CesiumMath,
  Rectangle,
  TileMapServiceImageryProvider,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { SETTINGS } from '../config/settings.js';

/** Vérifie que le navigateur peut créer un contexte WebGL. */
export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Heuristique simple pour détecter un terminal mobile / peu puissant. */
export function isLowPowerDevice() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const memory = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  return coarse || memory <= 4 || cores <= 4;
}

/**
 * Crée le globe.
 * @param {HTMLElement} container
 * @param {{ token: string, lowPower: boolean, onStatus: (status: object) => void, onTilesLoading: (pending: number) => void }} options
 */
export function createGlobe(container, { token, lowPower, onStatus, onTilesLoading }) {
  if (token) Ion.defaultAccessToken = token;

  const viewer = new Viewer(container, {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shadows: false,
    msaaSamples: lowPower ? 1 : 4,
    useBrowserRecommendedResolution: true,
  });

  const { scene } = viewer;
  scene.globe.baseColor = Color.fromCssColorString('#0b1a2e');
  scene.globe.showGroundAtmosphere = !lowPower;
  scene.globe.maximumScreenSpaceError = lowPower ? 3 : 2;
  scene.fog.enabled = true;
  scene.highDynamicRange = false;
  if (scene.postProcessStages?.fxaa) {
    scene.postProcessStages.fxaa.enabled = !lowPower;
  }
  // Éclairage "frontal" depuis la caméra : le modèle 3D reste lisible même la nuit.
  scene.light = new DirectionalLight({ direction: Cartesian3.clone(scene.camera.directionWC) });
  if (lowPower) {
    viewer.targetFrameRate = 30;
    viewer.resolutionScale = Math.min(1, 1.35 / (window.devicePixelRatio || 1));
  }

  const onWindowResize = () => viewer.resize();
  window.addEventListener('resize', onWindowResize, { passive: true });

  let tileset = null;
  let tilesetFailures = 0;
  let quality = null;
  let imagerySource = null;
  let geocoder = null;

  scene.preRender.addEventListener(() => {
    Cartesian3.clone(scene.camera.directionWC, scene.light.direction);
  });
  scene.globe.tileLoadProgressEvent.addEventListener((pending) => {
    if (quality === 'low') onTilesLoading(pending);
  });
  scene.renderError.addEventListener((_scene, error) => {
    console.error('[globe] Erreur de rendu Cesium :', error);
    onStatus({ state: 'error', message: `Erreur de rendu 3D : ${error?.message ?? error}` });
  });

  /** Imagerie du mode léger (une seule fois). */
  async function ensureLightImagery() {
    if (imagerySource) return imagerySource;
    if (token) {
      try {
        // Asset 2 = Bing Maps Aerial, disponible avec un compte Cesium ion gratuit.
        viewer.imageryLayers.addImageryProvider(await IonImageryProvider.fromAssetId(2));
        imagerySource = 'ion';
        return imagerySource;
      } catch (error) {
        console.warn('[globe] Imagerie Cesium ion indisponible, repli sur Natural Earth II :', error);
      }
    }
    const provider = await TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'));
    viewer.imageryLayers.addImageryProvider(provider);
    imagerySource = 'natural-earth';
    return imagerySource;
  }

  async function enableLow(reason = '') {
    quality = 'low';
    if (tileset) tileset.show = false;
    scene.globe.show = true;
    const source = await ensureLightImagery();
    updateGeocoder();
    const detail = source === 'ion' ? 'imagerie Bing via Cesium ion' : 'imagerie Natural Earth II (hors ligne)';
    onStatus({ state: 'ready', quality: 'low', message: reason ? `${reason} Mode léger : ${detail}.` : `Mode léger : ${detail}.` });
  }

  async function enableHigh() {
    if (!token) {
      await enableLow('Token Cesium ion absent : Google Photorealistic 3D Tiles indisponibles.');
      return 'low';
    }
    onStatus({ state: 'loading', quality: 'high', message: 'Chargement des Google Photorealistic 3D Tiles…' });
    try {
      if (!tileset) {
        tileset = await createGooglePhotorealistic3DTileset(
          { onlyUsingWithGoogleGeocoder: true },
          {
            maximumScreenSpaceError: lowPower ? 32 : 16,
            cacheBytes: (lowPower ? 256 : 512) * 1024 * 1024,
            showCreditsOnScreen: true,
          },
        );
        scene.primitives.add(tileset);
        tileset.loadProgress.addEventListener((pending, processing) => {
          if (quality === 'high') onTilesLoading(pending + processing);
        });
        tileset.tileFailed.addEventListener(({ message }) => {
          tilesetFailures += 1;
          console.warn('[globe] Tuile Google en échec :', message);
          if (tilesetFailures === 15 && quality === 'high') {
            enableLow('Trop d’erreurs de chargement des tuiles Google.').catch(reportError);
          }
        });
      }
      tilesetFailures = 0;
      tileset.show = true;
      scene.globe.show = false;
      quality = 'high';
      updateGeocoder();
      onStatus({ state: 'ready', quality: 'high', message: 'Google Photorealistic 3D Tiles actives.' });
      return 'high';
    } catch (error) {
      console.error('[globe] Google Photorealistic 3D Tiles indisponibles :', error);
      const text = String(error?.message ?? error);
      const reason = /401|unauthori[sz]ed|invalid.*token/i.test(text)
        ? 'Token Cesium ion invalide ou expiré.'
        : /404|403|access/i.test(text)
          ? 'Accès aux Google Photorealistic 3D Tiles refusé pour ce compte Cesium ion.'
          : 'Impossible de charger les Google Photorealistic 3D Tiles.';
      await enableLow(reason);
      return 'low';
    }
  }

  function reportError(error) {
    console.error('[globe]', error);
    onStatus({ state: 'error', message: String(error?.message ?? error) });
  }

  /**
   * Géocodeur compatible avec les données affichées (conditions Google / Bing) :
   * Google avec les tuiles Google, Bing avec l'imagerie Bing, sinon celui par défaut.
   */
  function updateGeocoder() {
    if (!token) {
      geocoder = null;
      return;
    }
    const type = quality === 'high'
      ? IonGeocodeProviderType.GOOGLE
      : imagerySource === 'ion' ? IonGeocodeProviderType.BING : IonGeocodeProviderType.DEFAULT;
    geocoder = new IonGeocoderService({ scene, geocodeProviderType: type });
  }

  return {
    viewer,
    scene,
    get quality() {
      return quality;
    },
    get canSearchPlaces() {
      return Boolean(token);
    },

    /** Active un mode graphique ; renvoie le mode effectivement obtenu. */
    async setQuality(mode) {
      if (mode === 'high') return enableHigh();
      await enableLow();
      return 'low';
    },

    /** Recherche de lieu via le géocodeur Cesium ion. */
    async searchPlace(query) {
      if (!geocoder) throw new Error('La recherche de lieu nécessite un token Cesium ion.');
      const results = await geocoder.geocode(query);
      if (geocoder.credit) viewer.creditDisplay.addStaticCredit(geocoder.credit);
      return results;
    },

    /** Vol vers un résultat de géocodage (rectangle ou point). */
    flyToDestination(destination) {
      if (destination instanceof Rectangle) {
        viewer.camera.flyTo({ destination, duration: 2.5 });
        return;
      }
      const carto = Cartographic.fromCartesian(destination);
      carto.height = Math.max(carto.height, 15_000);
      viewer.camera.flyTo({ destination: Cartographic.toCartesian(carto), duration: 2.5 });
    },

    flyToWorld(duration = 2.5) {
      const { lon, lat, height } = SETTINGS.camera.worldView;
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, height), duration });
    },

    setInitialView() {
      const { lon, lat, height } = SETTINGS.camera.initialView;
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, height) });
    },

    /**
     * Zone actuellement regardée : point au centre de l'écran (ou sous la caméra
     * si l'on regarde le ciel) et hauteur de la caméra.
     */
    getViewCenter() {
      const { camera, canvas } = scene;
      const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
      const picked = camera.pickEllipsoid(center, scene.globe.ellipsoid);
      const carto = picked ? Cartographic.fromCartesian(picked) : camera.positionCartographic;
      return {
        lat: CesiumMath.toDegrees(carto.latitude),
        lon: CesiumMath.toDegrees(carto.longitude),
        cameraHeightM: camera.positionCartographic.height,
      };
    },

    /** Coordonnées géographiques sous un point de l'écran (ou null). */
    pickCoordinates(screenPosition) {
      const picked = scene.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid);
      if (!picked) return null;
      const carto = Cartographic.fromCartesian(picked);
      return { lat: CesiumMath.toDegrees(carto.latitude), lon: CesiumMath.toDegrees(carto.longitude) };
    },

    destroy() {
      window.removeEventListener('resize', onWindowResize);
      viewer.destroy();
    },
  };
}

