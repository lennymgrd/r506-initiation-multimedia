/**
 * Point d'entrée principal de Flight Explorer 3D.
 *
 * Orchestre :
 *  - la création du store d'état et la persistance des préférences ;
 *  - l'initialisation du globe 3D CesiumJS, de la couche d'avions et des caméras ;
 *  - l'interrogation périodique et stabilisée de l'API ADSB.fi (ou du mode démo) ;
 *  - la synchronisation avec l'interface utilisateur responsive.
 */
import './style.css';
import { Cartesian2, Cartesian3, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import { MOBILE_LAYOUT_QUERY, SETTINGS } from './config/settings.js';
import { createDemoClient } from './data/demoFlights.js';
import { createAircraftLayer, pickAircraftId } from './globe/aircraft.js';
import { createCameraController } from './globe/camera.js';
import { createGlobe, isLowPowerDevice, isMobileDevice, isWebGLAvailable } from './globe/globe.js';
import { createAdsbClient } from './services/adsbApi.js';
import { createInitialState, createStore, loadPreferences, savePreferences } from './state/appState.js';
import { createControlsUI } from './ui/controls.js';
import { createFlightDetailsUI } from './ui/flightDetails.js';
import { createFlightListUI } from './ui/flightList.js';
import { hasAreaChanged, mergeFlights, radiusForCameraHeight } from './utils/flightUtils.js';

function bootstrap() {
  const globeContainer = document.querySelector('#cesium-container');
  const webglFallback = document.querySelector('#webgl-error-screen');

  if (!isWebGLAvailable()) {
    webglFallback.hidden = false;
    return;
  }

  const lowPower = isLowPowerDevice();
  const mobile = isMobileDevice();
  const initialPreferences = loadPreferences(undefined, { lowPower, mobile });
  const isMobileLayout = window.matchMedia(MOBILE_LAYOUT_QUERY).matches;

  const store = createStore({
    ...createInitialState(initialPreferences),
    // Sur PC le panneau latéral est ouvert par défaut ; sur mobile il s'ouvre à la demande.
    menuOpen: !isMobileLayout,
  });

  // Clients de données : ADSB.fi en direct + mode démo local clairement séparé.
  const liveClient = createAdsbClient();
  const demoClient = createDemoClient();
  const activeClient = () => (store.getState().preferences.demoMode ? demoClient : liveClient);

  let globe;
  try {
    globe = createGlobe(globeContainer, {
      token: SETTINGS.cesium.ionToken,
      lowPower,
      mobile,
      mobileRendering: initialPreferences.mobileRendering,
      onStatus(globeStatus) {
        store.setState({ globeStatus: { ...store.getState().globeStatus, ...globeStatus } });
      },
      onTilesLoading(pending, refining) {
        controlsUI?.setTilesLoading(pending, refining);
      },
    });
  } catch (error) {
    console.error('[main] Échec de création du globe Cesium :', error);
    webglFallback.hidden = false;
    const msg = webglFallback.querySelector('p');
    if (msg) msg.textContent = `Impossible d’initialiser CesiumJS : ${error?.message ?? error}`;
    return;
  }

  const aircraftLayer = createAircraftLayer(globe.scene, {
    lowPower,
    mobile,
    onModelError() {
      controlsUI?.showBannerMessage(
        'Modèle 3D airplane.glb indisponible : utilisation du marqueur vectoriel orienté.',
      );
    },
  });

  let detailsUI = null;
  const cameraController = createCameraController(globe.viewer, {
    aircraftLayer,
    mobile,
    onOrientationStatus(status) {
      detailsUI?.setOrientationStatus(status);
    },
  });

  // --- Interface utilisateur ------------------------------------------------

  const controlsUI = createControlsUI({
    store,
    mobile,
    onManualRefresh() {
      fetchAreaFlights({ force: true });
    },
    onChangePreference(patch) {
      updatePreferences(patch);
    },
    onWorldView() {
      stopTrackingAndReturnGlobal();
      globe.flyToWorld(2.2);
    },
    onGeolocate() {
      locateUserOnGlobe();
    },
    onSearchPlace(query) {
      return globe.searchPlace(query);
    },
    onSelectPlaceResult(destination) {
      stopTrackingAndReturnGlobal();
      globe.flyToDestination(destination);
    },
    onExitCockpit() {
      setCameraMode('chase');
    },
    onResetCameraOffset() {
      cameraController.resetViewOffset();
    },
  });

  controlsUI.setGeocoderEnabled(globe.canSearchPlaces);

  createFlightListUI(document.querySelector('#flights-sidebar'), {
    store,
    onSelectFlight(id) {
      selectFlight(id, { fromList: true });
    },
    onRemoteCallsignSearch(callsign) {
      runRemoteCallsignSearch(callsign);
    },
    onClearRemoteSearch() {
      store.setState({ remoteResults: null });
    },
    onToggleGround(showGround) {
      updatePreferences({ showGround });
    },
    onCloseMobileMenu() {
      store.setState({ menuOpen: false });
    },
  });

  detailsUI = createFlightDetailsUI(document.querySelector('#flight-details-card'), {
    store,
    onSelectCameraMode(mode) {
      setCameraMode(mode);
    },
    onResetCameraOffset() {
      cameraController.resetViewOffset();
    },
    onZoomChase(factor) {
      cameraController.zoomChase(factor);
    },
    onToggleOrientationSensor() {
      cameraController.toggleDeviceOrientation();
    },
    onStopTracking() {
      stopTrackingAndReturnGlobal();
    },
  });

  // --- Sélection et suivi d'avion -------------------------------------------

  function selectFlight(id, { fromList = false } = {}) {
    const state = store.getState();
    if (!id || !state.flights.has(id)) return;

    aircraftLayer.setSelected(id);
    // Synchronise immédiatement la position affichée avant le déplacement caméra.
    aircraftLayer.update(Date.now());

    // Sur mobile, lorsqu'on choisit un vol dans la liste, on referme le tiroir pour voir le globe.
    const closeDrawer = fromList && window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
    const nextCameraMode = state.selectedId === id ? state.cameraMode : 'chase';

    store.setState({
      selectedId: id,
      cameraMode: nextCameraMode,
      ...(closeDrawer ? { menuOpen: false } : {}),
    });

    cameraController.setTracking(id, nextCameraMode, { flyOnGlobalSelect: true });
  }

  function setCameraMode(mode) {
    const { selectedId } = store.getState();
    if (!selectedId) return;
    store.setState({ cameraMode: mode });
    cameraController.setTracking(selectedId, mode, { flyOnGlobalSelect: mode === 'global' });
  }

  function stopTrackingAndReturnGlobal() {
    aircraftLayer.setSelected(null);
    cameraController.setTracking(null, 'global');
    store.setState({ selectedId: null, cameraMode: 'global' });
  }

  // --- Clic sur un avion dans le globe 3D et coordonnées du curseur ---------

  const inputHandler = new ScreenSpaceEventHandler(globe.scene.canvas);

  inputHandler.setInputAction((movement) => {
    const pickedId = pickAircraftId(globe.scene, movement.position);
    if (pickedId) {
      selectFlight(pickedId, { fromList: false });
    }
  }, ScreenSpaceEventType.LEFT_CLICK);

  let lastCoordUpdateMs = 0;
  if (!mobile && !lowPower) {
    inputHandler.setInputAction((movement) => {
      const now = performance.now();
      if (now - lastCoordUpdateMs < 90) return;
      lastCoordUpdateMs = now;
      const coords = globe.pickCoordinates(new Cartesian2(movement.endPosition.x, movement.endPosition.y));
      if (coords) {
        controlsUI.setCoordinates(coords.lat, coords.lon);
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);
  }

  // --- Boucle d'animation (interpolation des avions et suivi caméra) --------

  globe.scene.preRender.addEventListener(() => {
    const nowMs = Date.now();
    aircraftLayer.update(nowMs);
    cameraController.update();
  });

  // --- Récupération des vols et gestion de la zone consultée ----------------

  let currentFetchController = null;
  let refreshTimer = null;
  let cameraSettleTimer = null;
  let lastAreaFetchMs = 0;
  let consecutiveRateLimits = 0;

  function computeCurrentArea() {
    const state = store.getState();
    // On ne verrouille la zone sur l'avion suivi que si l'on est en caméra poursuivante ou cockpit.
    // En vue globale, déplacer la carte interroge toujours la région réellement consultée.
    if (state.cameraMode !== 'global' && state.selectedId && state.flights.has(state.selectedId)) {
      const tracked = state.flights.get(state.selectedId).data;
      return { lat: tracked.lat, lon: tracked.lon, radiusNm: 120 };
    }
    const center = globe.getViewCenter();
    const radiusNm = radiusForCameraHeight(center.cameraHeightM, {
      minNm: SETTINGS.adsb.minRadiusNm,
      maxNm: SETTINGS.adsb.maxRadiusNm,
    });
    return { lat: center.lat, lon: center.lon, radiusNm };
  }

  async function fetchAreaFlights({ force = false, dropMissing = false } = {}) {
    if (document.hidden && !force) return;

    const area = computeCurrentArea();
    controlsUI.setCoordinates(area.lat, area.lon);

    currentFetchController?.abort();
    const controller = new AbortController();
    currentFetchController = controller;

    const prevState = store.getState();
    store.setState({
      area,
      dataStatus: {
        ...prevState.dataStatus,
        state: 'loading',
        source: prevState.preferences.demoMode ? 'demo' : 'live',
      },
    });

    try {
      const result = await activeClient().fetchAircraftInArea(area, { signal: controller.signal });
      consecutiveRateLimits = 0;
      lastAreaFetchMs = Date.now();

      const current = store.getState();
      const keepIds = current.selectedId ? new Set([current.selectedId]) : new Set();

      // Si un avion est suivi en dehors du cercle ou via recherche distante, on fusionne sans le perdre.
      const merged = mergeFlights(current.flights, result.aircraft, {
        nowMs: result.receivedAtMs,
        missingGraceS: SETTINGS.flights.missingGraceS,
        keepIds,
        dropMissing,
        area,
      });

      aircraftLayer.sync(merged.flights, result.receivedAtMs);

      store.setState({
        flights: merged.flights,
        dataStatus: {
          state: 'ready',
          source: result.source,
          lastUpdateMs: result.receivedAtMs,
          message: '',
          error: null,
        },
      });
    } catch (error) {
      if (error?.kind === 'aborted') return;
      console.warn('[adsb] Erreur de récupération des vols :', error);

      if (error?.kind === 'rate-limit') {
        consecutiveRateLimits += 1;
        scheduleNextRefresh();
      }

      const current = store.getState();
      store.setState({
        dataStatus: {
          ...current.dataStatus,
          state: 'error',
          message: error?.message ?? 'Erreur lors de la récupération des données aériennes.',
          error: error?.kind ?? 'unknown',
        },
      });
    }
  }

  /** Recherche distante explicite par indicatif (/v2/callsign/{callsign}). */
  async function runRemoteCallsignSearch(rawCallsign) {
    const callsign = rawCallsign.trim().toUpperCase();
    if (!callsign) return;

    const prevState = store.getState();
    store.setState({
      dataStatus: { ...prevState.dataStatus, state: 'loading' },
    });

    try {
      const result = await activeClient().fetchByCallsign(callsign);
      const current = store.getState();
      const keepIds = current.selectedId ? new Set([current.selectedId]) : new Set();

      // On ajoute les appareils trouvés à la carte pour pouvoir les sélectionner et les suivre.
      const merged = mergeFlights(current.flights, result.aircraft, {
        nowMs: result.receivedAtMs,
        missingGraceS: SETTINGS.flights.missingGraceS,
        keepIds: new Set([...keepIds, ...current.flights.keys()]),
        dropMissing: false,
      });

      aircraftLayer.sync(merged.flights, result.receivedAtMs);

      store.setState({
        flights: merged.flights,
        remoteResults: { callsign, aircraft: result.aircraft },
        dataStatus: {
          state: 'ready',
          source: result.source,
          lastUpdateMs: result.receivedAtMs,
          message: '',
          error: null,
        },
      });

      if (result.aircraft.length === 1) {
        selectFlight(result.aircraft[0].id, { fromList: false });
      }
    } catch (error) {
      if (error?.kind === 'aborted') return;
      const current = store.getState();
      store.setState({
        dataStatus: {
          ...current.dataStatus,
          state: 'error',
          message: error?.message ?? "Erreur lors de la recherche distante par indicatif.",
          error: error?.kind ?? 'unknown',
        },
      });
    }
  }

  function scheduleNextRefresh() {
    clearTimeout(refreshTimer);
    const { preferences } = store.getState();
    const baseS = preferences.refreshIntervalS;
    const backoffS = consecutiveRateLimits > 0
      ? Math.min(SETTINGS.refresh.maxBackoffS, baseS * SETTINGS.refresh.backoffFactor ** consecutiveRateLimits)
      : baseS;
    const delayMs = (document.hidden ? Math.max(backoffS * 2, 60) : backoffS) * 1000;

    refreshTimer = setTimeout(async () => {
      await fetchAreaFlights();
      scheduleNextRefresh();
    }, delayMs);
  }

  // Stabilisation des mouvements de caméra : dès que l'utilisateur se déplace sur le globe,
  // la liste des avions et la carte sont actualisées pour la nouvelle zone (avec respect du délai minimal).
  globe.viewer.camera.moveEnd.addEventListener(() => {
    const state = store.getState();
    if (state.cameraMode !== 'global') return;
    aircraftLayer.onCameraChange();
    clearTimeout(cameraSettleTimer);

    const nextArea = computeCurrentArea();
    controlsUI.setCoordinates(nextArea.lat, nextArea.lon);

    const elapsedMs = Date.now() - lastAreaFetchMs;
    const waitMs = Math.max(
      SETTINGS.refresh.cameraSettleMs,
      SETTINGS.refresh.minAreaRequestGapMs - elapsedMs,
    );

    cameraSettleTimer = setTimeout(() => {
      const targetArea = computeCurrentArea();
      const prevArea = store.getState().area;
      controlsUI.setCoordinates(targetArea.lat, targetArea.lon);
      if (hasAreaChanged(prevArea, targetArea, SETTINGS.refresh.areaChangeRatio)) {
        fetchAreaFlights({ dropMissing: true });
      }
    }, waitMs);
  });

  // Pause / reprise intelligente lorsque l'onglet devient inactif ou actif.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const elapsed = Date.now() - lastAreaFetchMs;
      if (elapsed > store.getState().preferences.refreshIntervalS * 1000) {
        fetchAreaFlights();
      }
    }
    scheduleNextRefresh();
  });

  // --- Préférences utilisateur ----------------------------------------------

  async function updatePreferences(patch) {
    const prev = store.getState().preferences;
    const next = { ...prev, ...patch };
    savePreferences(next);
    store.setState({ preferences: next });

    if (patch.showGround !== undefined) {
      aircraftLayer.setShowGround(next.showGround);
    }
    if (patch.showLabels !== undefined) {
      aircraftLayer.setLabelsVisible(next.showLabels);
    }
    if (patch.quality !== undefined && patch.quality !== prev.quality) {
      await globe.setQuality(next.quality);
      controlsUI.setGeocoderEnabled(globe.canSearchPlaces);
    }
    if (patch.mobileRendering !== undefined && patch.mobileRendering !== prev.mobileRendering) {
      globe.setMobileRendering(next.mobileRendering);
    }
    if (patch.demoMode !== undefined && patch.demoMode !== prev.demoMode) {
      stopTrackingAndReturnGlobal();
      store.setState({ flights: new Map(), remoteResults: null });
      aircraftLayer.sync(new Map());
      await fetchAreaFlights({ force: true, dropMissing: true });
    }
    if (patch.refreshIntervalS !== undefined) {
      scheduleNextRefresh();
    }
  }

  // --- Géolocalisation HTML5 (optionnelle, non bloquante) -------------------

  function locateUserOnGlobe() {
    if (!('geolocation' in navigator)) {
      controlsUI.showBannerMessage("La géolocalisation n'est pas supportée par ce navigateur.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        stopTrackingAndReturnGlobal();
        const { latitude, longitude } = pos.coords;
        globe.viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(longitude, latitude, 180_000),
          duration: 2.0,
        });
      },
      (err) => {
        console.warn('[geolocation] Permission refusée ou position indisponible :', err);
        controlsUI.showBannerMessage(
          "Géolocalisation refusée ou indisponible : vous pouvez naviguer librement sur le globe.",
        );
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  // --- Démarrage initial ----------------------------------------------------

  globe.setInitialView();
  aircraftLayer.setShowGround(initialPreferences.showGround);
  aircraftLayer.setLabelsVisible(initialPreferences.showLabels);

  globe.setQuality(initialPreferences.quality).then(() => {
    controlsUI.setGeocoderEnabled(globe.canSearchPlaces);
  });

  fetchAreaFlights({ force: true }).then(() => {
    scheduleNextRefresh();
  });
}

bootstrap();

