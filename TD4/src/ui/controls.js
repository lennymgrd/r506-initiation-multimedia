/**
 * Barre supérieure, contrôles cartographiques, bandeau d'alerte, HUD cockpit,
 * barre d'état inférieure et panneau des paramètres.
 */
import {
  formatAltitude,
  formatCoordinates,
  formatHeading,
  formatSpeed,
} from '../utils/flightUtils.js';

const timeFormat = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * @param {{
 *   store: ReturnType<import('../state/appState.js').createStore>,
 *   onManualRefresh: () => void,
 *   onChangePreference: (patch: Partial<import('../config/settings.js').DEFAULT_PREFERENCES>) => void,
 *   onWorldView: () => void,
 *   onGeolocate: () => void,
 *   onSearchPlace: (query: string) => Promise<Array<{ displayName: string, destination: unknown }>>,
 *   onSelectPlaceResult: (destination: unknown) => void,
 *   onExitCockpit: () => void,
 *   onResetCameraOffset: () => void,
 * }} handlers
 */
export function createControlsUI({
  store,
  onManualRefresh,
  onChangePreference,
  onWorldView,
  onGeolocate,
  onSearchPlace,
  onSelectPlaceResult,
  onExitCockpit,
  onResetCameraOffset,
}) {
  // Zone 1 : barre supérieure
  const toggleMenuBtn = document.querySelector('#btn-toggle-menu');
  const statusPill = document.querySelector('#connection-status-pill');
  const statusDot = document.querySelector('#connection-status-dot');
  const statusText = document.querySelector('#connection-status-text');
  const loadedCountEl = document.querySelector('#topbar-aircraft-count');
  const lastUpdateEl = document.querySelector('#topbar-last-update');
  const refreshBtn = document.querySelector('#btn-refresh-now');
  const demoToggleBtn = document.querySelector('#btn-quick-demo');
  const settingsBtn = document.querySelector('#btn-open-settings');

  // Bandeaux d'information / erreur
  const apiBanner = document.querySelector('#api-alert-banner');
  const apiBannerMsg = document.querySelector('#api-alert-message');
  const apiBannerAction = document.querySelector('#api-alert-action');
  const apiBannerClose = document.querySelector('#api-alert-close');

  const globeBanner = document.querySelector('#globe-alert-banner');
  const globeBannerMsg = document.querySelector('#globe-alert-message');
  const globeBannerClose = document.querySelector('#globe-alert-close');

  // Recherche de lieu (géocodeur Cesium)
  const placeForm = document.querySelector('#place-search-form');
  const placeInput = document.querySelector('#place-search-input');
  const placeSubmitBtn = document.querySelector('#place-search-submit');
  const placeResultsList = document.querySelector('#place-search-results');

  // Boutons flottants sur la carte
  const worldViewBtn = document.querySelector('#btn-world-view');
  const geolocateBtn = document.querySelector('#btn-geolocate');

  // Barre inférieure : coordonnées, rayon, chargement 3D
  const coordsDisplay = document.querySelector('#status-coordinates');
  const areaRadiusDisplay = document.querySelector('#status-area-radius');
  const tilesLoadingBadge = document.querySelector('#tiles-loading-badge');
  const qualityBadge = document.querySelector('#status-quality-badge');

  // Fenêtre de paramètres
  const settingsModal = document.querySelector('#settings-modal');
  const settingsCloseBtn = document.querySelector('#btn-close-settings');
  const settingsBackdrop = document.querySelector('#settings-backdrop');
  const qualityInputs = Array.from(document.querySelectorAll('input[name="pref-quality"]'));
  const altUnitInputs = Array.from(document.querySelectorAll('input[name="pref-alt-unit"]'));
  const speedUnitInputs = Array.from(document.querySelectorAll('input[name="pref-speed-unit"]'));
  const intervalSelect = document.querySelector('#pref-refresh-interval');
  const prefGroundCheckbox = document.querySelector('#pref-show-ground');
  const prefLabelsCheckbox = document.querySelector('#pref-show-labels');
  const prefDemoCheckbox = document.querySelector('#pref-demo-mode');

  const sidebar = document.querySelector('#flights-sidebar');
  const mobileBackdrop = document.querySelector('#sidebar-backdrop');

  // --- Écouteurs barre supérieure et navigation -----------------------------

  toggleMenuBtn.addEventListener('click', () => {
    const { menuOpen } = store.getState();
    store.setState({ menuOpen: !menuOpen });
  });

  mobileBackdrop?.addEventListener('click', () => {
    store.setState({ menuOpen: false });
  });

  refreshBtn.addEventListener('click', () => {
    onManualRefresh();
  });

  demoToggleBtn.addEventListener('click', () => {
    const { preferences } = store.getState();
    onChangePreference({ demoMode: !preferences.demoMode });
  });

  settingsBtn.addEventListener('click', () => {
    store.setState({ settingsOpen: true });
  });

  settingsCloseBtn.addEventListener('click', () => {
    store.setState({ settingsOpen: false });
  });

  settingsBackdrop.addEventListener('click', () => {
    store.setState({ settingsOpen: false });
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const state = store.getState();
      if (state.settingsOpen) {
        store.setState({ settingsOpen: false });
      } else if (!placeResultsList.hidden) {
        placeResultsList.hidden = true;
      }
    }
  });

  worldViewBtn.addEventListener('click', () => {
    onWorldView();
  });

  geolocateBtn.addEventListener('click', () => {
    onGeolocate();
  });

  apiBannerClose.addEventListener('click', () => {
    apiBanner.hidden = true;
  });

  globeBannerClose.addEventListener('click', () => {
    globeBanner.hidden = true;
  });

  apiBannerAction.addEventListener('click', () => {
    onChangePreference({ demoMode: true });
    apiBanner.hidden = true;
  });

  // --- Recherche de lieu (géocodeur Cesium) ---------------------------------

  placeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = placeInput.value.trim();
    if (!query || placeInput.disabled) return;
    placeSubmitBtn.disabled = true;
    placeResultsList.hidden = false;
    placeResultsList.innerHTML = '<li class="place-result-empty">Recherche en cours…</li>';
    try {
      const results = await onSearchPlace(query);
      placeResultsList.innerHTML = '';
      if (!results || results.length === 0) {
        placeResultsList.innerHTML = '<li class="place-result-empty">Aucun lieu trouvé.</li>';
        return;
      }
      for (const item of results.slice(0, 6)) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'place-result-btn';
        btn.textContent = item.displayName;
        btn.addEventListener('click', () => {
          placeResultsList.hidden = true;
          onSelectPlaceResult(item.destination);
        });
        li.appendChild(btn);
        placeResultsList.appendChild(li);
      }
    } catch (error) {
      placeResultsList.innerHTML = `<li class="place-result-empty">${escapeText(error.message || 'Erreur de géocodage.')}</li>`;
    } finally {
      placeSubmitBtn.disabled = false;
    }
  });

  document.addEventListener('click', (event) => {
    if (!placeForm.contains(event.target)) {
      placeResultsList.hidden = true;
    }
  });

  // --- Écouteurs du panneau de paramètres -----------------------------------

  for (const input of qualityInputs) {
    input.addEventListener('change', () => {
      if (input.checked) onChangePreference({ quality: input.value });
    });
  }

  for (const input of altUnitInputs) {
    input.addEventListener('change', () => {
      if (input.checked) onChangePreference({ altitudeUnit: input.value });
    });
  }

  for (const input of speedUnitInputs) {
    input.addEventListener('change', () => {
      if (input.checked) onChangePreference({ speedUnit: input.value });
    });
  }

  intervalSelect.addEventListener('change', () => {
    onChangePreference({ refreshIntervalS: Number.parseInt(intervalSelect.value, 10) });
  });

  prefGroundCheckbox.addEventListener('change', () => {
    onChangePreference({ showGround: prefGroundCheckbox.checked });
  });

  prefLabelsCheckbox.addEventListener('change', () => {
    onChangePreference({ showLabels: prefLabelsCheckbox.checked });
  });

  prefDemoCheckbox.addEventListener('change', () => {
    onChangePreference({ demoMode: prefDemoCheckbox.checked });
  });

  // --- Rendu réactif --------------------------------------------------------

  function renderTopBar(state) {
    const { dataStatus, flights, preferences, menuOpen } = state;

    sidebar.classList.toggle('is-open', menuOpen);
    sidebar.classList.toggle('is-collapsed-desktop', !menuOpen);
    if (mobileBackdrop) mobileBackdrop.hidden = !menuOpen;
    toggleMenuBtn.setAttribute('aria-expanded', String(menuOpen));

    const totalLoaded = flights.size;
    loadedCountEl.textContent = `${totalLoaded} avion${totalLoaded > 1 ? 's' : ''}`;

    lastUpdateEl.textContent = dataStatus.lastUpdateMs
      ? timeFormat.format(new Date(dataStatus.lastUpdateMs))
      : 'En attente…';

    refreshBtn.disabled = dataStatus.state === 'loading';
    refreshBtn.classList.toggle('is-spinning', dataStatus.state === 'loading');

    demoToggleBtn.classList.toggle('is-active', preferences.demoMode);
    demoToggleBtn.setAttribute('aria-pressed', String(preferences.demoMode));
    demoToggleBtn.textContent = preferences.demoMode ? 'Mode démo actif' : 'Mode démo';

    // Pilule d'état de connexion aux données aériennes
    statusPill.dataset.status = dataStatus.state;
    statusDot.className = 'status-dot';
    if (preferences.demoMode || dataStatus.source === 'demo') {
      statusDot.classList.add('is-demo');
      statusText.textContent = 'Mode démo (données fictives)';
    } else if (dataStatus.state === 'loading') {
      statusDot.classList.add('is-loading');
      statusText.textContent = 'Actualisation ADSB.fi…';
    } else if (dataStatus.state === 'error') {
      statusDot.classList.add('is-error');
      statusText.textContent = 'Erreur API aérienne';
    } else if (dataStatus.state === 'ready') {
      statusDot.classList.add('is-live');
      statusText.textContent = 'En direct · ADSB.fi';
    } else {
      statusText.textContent = 'Connexion…';
    }

    // Bandeau d'erreur API aérienne
    if (dataStatus.state === 'error' && dataStatus.message) {
      apiBanner.hidden = false;
      apiBannerMsg.textContent = dataStatus.message;
      apiBannerAction.hidden = preferences.demoMode;
    } else {
      apiBanner.hidden = true;
    }
  }

  function renderGlobeStatus(state) {
    const { globeStatus, area } = state;
    qualityBadge.textContent = globeStatus.quality === 'high' ? '3D Photoréaliste' : 'Globe léger';
    qualityBadge.dataset.quality = globeStatus.quality;

    if (area) {
      areaRadiusDisplay.textContent = `Zone : rayon ${area.radiusNm} NM`;
    }

    if (globeStatus.message && (globeStatus.state === 'error' || globeStatus.quality === 'low')) {
      globeBanner.hidden = false;
      globeBannerMsg.textContent = globeStatus.message;
    } else {
      globeBanner.hidden = true;
    }
  }

  function renderSettings(state) {
    const { preferences, settingsOpen } = state;
    settingsModal.hidden = !settingsOpen;

    for (const input of qualityInputs) {
      input.checked = input.value === preferences.quality;
    }
    for (const input of altUnitInputs) {
      input.checked = input.value === preferences.altitudeUnit;
    }
    for (const input of speedUnitInputs) {
      input.checked = input.value === preferences.speedUnit;
    }
    intervalSelect.value = String(preferences.refreshIntervalS);
    prefGroundCheckbox.checked = preferences.showGround;
    prefLabelsCheckbox.checked = preferences.showLabels;
    prefDemoCheckbox.checked = preferences.demoMode;
  }

  store.subscribe(renderTopBar, ['dataStatus', 'flights', 'preferences', 'menuOpen']);
  store.subscribe(renderGlobeStatus, ['globeStatus', 'area']);
  store.subscribe(renderSettings, ['preferences', 'settingsOpen']);

  renderTopBar(store.getState());
  renderGlobeStatus(store.getState());
  renderSettings(store.getState());

  return {
    setCoordinates(lat, lon) {
      coordsDisplay.textContent = formatCoordinates(lat, lon);
    },
    setTilesLoading(pendingCount) {
      tilesLoadingBadge.hidden = pendingCount <= 0;
      if (pendingCount > 0) {
        tilesLoadingBadge.textContent = `Tuiles 3D (${pendingCount})…`;
      }
    },
    setGeocoderEnabled(enabled) {
      placeInput.disabled = !enabled;
      placeSubmitBtn.disabled = !enabled;
      placeInput.placeholder = enabled
        ? 'Rechercher un lieu (ville, aéroport)…'
        : 'Recherche de lieu (token Cesium ion requis)';
      placeForm.title = enabled
        ? 'Géocodeur Cesium ion'
        : 'Configurez VITE_CESIUM_ION_TOKEN dans .env pour activer le géocodeur.';
    },
    showBannerMessage(message) {
      globeBanner.hidden = false;
      globeBannerMsg.textContent = message;
    },
  };
}

function escapeText(str) {
  return String(str).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

