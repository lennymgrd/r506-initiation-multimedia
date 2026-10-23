/**
 * Fiche détaillée de l'avion sélectionné et commandes des trois modes de caméra.
 *
 * Responsabilités :
 *  - afficher toutes les données ADS-B réellement disponibles (et « Non disponible »
 *    pour les champs absents, sans jamais inventer de départ ou de destination) ;
 *  - signaler clairement si l'avion sélectionné n'est plus détecté tout en
 *    conservant sa dernière position connue et son ancienneté ;
 *  - permettre de basculer entre Vue globale, Vue extérieure et Vue cockpit virtuelle ;
 *  - afficher le caractère simulé de la vue cockpit et l'option de capteur d'orientation ;
 *  - proposer le bouton « Arrêter le suivi ».
 */
import {
  categoryLabel,
  displayValue,
  formatAge,
  formatAltitude,
  formatCoordinates,
  formatHeading,
  formatSpeed,
  formatVerticalRate,
  NOT_AVAILABLE,
} from '../utils/flightUtils.js';

/**
 * @param {HTMLElement} panel
 * @param {{
 *   store: ReturnType<import('../state/appState.js').createStore>,
 *   onSelectCameraMode: (mode: 'global'|'chase'|'cockpit') => void,
 *   onResetCameraOffset: () => void,
 *   onToggleOrientationSensor: () => void,
 *   onStopTracking: () => void,
 * }} handlers
 */
export function createFlightDetailsUI(
  panel,
  {
    store,
    onSelectCameraMode,
    onResetCameraOffset,
    onToggleOrientationSensor,
    onStopTracking,
  },
) {
  const callsignEl = panel.querySelector('#detail-callsign');
  const subtitleEl = panel.querySelector('#detail-subtitle');
  const demoBadgeEl = panel.querySelector('#detail-demo-badge');
  const missingBannerEl = panel.querySelector('#detail-missing-banner');
  const missingAgeEl = panel.querySelector('#detail-missing-age');
  const simulatedNoticeEl = panel.querySelector('#detail-cockpit-notice');
  const orientationBarEl = panel.querySelector('#detail-orientation-bar');
  const orientationBtn = panel.querySelector('#btn-toggle-orientation');
  const orientationMsgEl = panel.querySelector('#orientation-status-msg');
  const resetViewBtn = panel.querySelector('#btn-reset-view-offset');
  const stopTrackingBtn = panel.querySelector('#btn-stop-tracking');
  const collapseBtn = panel.querySelector('#btn-collapse-details');

  const fields = {
    altitude: panel.querySelector('#detail-altitude'),
    altGeom: panel.querySelector('#detail-alt-geom'),
    speed: panel.querySelector('#detail-speed'),
    track: panel.querySelector('#detail-track'),
    verticalRate: panel.querySelector('#detail-vrate'),
    country: panel.querySelector('#detail-country'),
    registration: panel.querySelector('#detail-registration'),
    type: panel.querySelector('#detail-type'),
    hex: panel.querySelector('#detail-hex'),
    squawk: panel.querySelector('#detail-squawk'),
    coords: panel.querySelector('#detail-coords'),
    lastPos: panel.querySelector('#detail-last-pos'),
  };

  const cameraButtons = Array.from(panel.querySelectorAll('[data-camera-mode]'));

  let isCompactMobile = false;

  for (const btn of cameraButtons) {
    btn.addEventListener('click', () => {
      onSelectCameraMode(btn.dataset.cameraMode);
    });
  }

  resetViewBtn?.addEventListener('click', () => {
    onResetCameraOffset();
  });

  orientationBtn?.addEventListener('click', () => {
    onToggleOrientationSensor();
  });

  stopTrackingBtn.addEventListener('click', () => {
    onStopTracking();
  });

  collapseBtn?.addEventListener('click', () => {
    isCompactMobile = !isCompactMobile;
    panel.classList.toggle('is-collapsed', isCompactMobile);
    collapseBtn.setAttribute('aria-expanded', String(!isCompactMobile));
    collapseBtn.textContent = isCompactMobile ? 'Détails ▲' : 'Réduire ▼';
  });

  function render() {
    const state = store.getState();
    const { selectedId, flights, cameraMode, preferences } = state;

    if (!selectedId || !flights.has(selectedId)) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    const entry = flights.get(selectedId);
    const aircraft = entry.data;
    const nowMs = Date.now();
    const ageSeconds = Math.max(0, (nowMs - aircraft.positionTimeMs) / 1000);

    callsignEl.textContent = aircraft.callsign ?? `Sans indicatif (${aircraft.hex})`;

    const typeParts = [aircraft.description, aircraft.typeCode, categoryLabel(aircraft.category)].filter(Boolean);
    subtitleEl.textContent = typeParts.length > 0 ? typeParts.join(' · ') : 'Type d’appareil non disponible';

    const isDemo = aircraft.sourceType === 'demo' || state.dataStatus.source === 'demo';
    demoBadgeEl.hidden = !isDemo;

    // Avertissement si l'avion a disparu des derniers relevés.
    const isStale = entry.missing || ageSeconds > 95;
    missingBannerEl.hidden = !isStale;
    if (isStale) {
      missingAgeEl.textContent = formatAge(ageSeconds);
    }

    // Mise à jour des boutons de caméra.
    for (const btn of cameraButtons) {
      const active = btn.dataset.cameraMode === cameraMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    // Bandeau explicite pour la vue cockpit virtuelle simulée.
    const inCockpit = cameraMode === 'cockpit';
    simulatedNoticeEl.hidden = !inCockpit;
    orientationBarEl.hidden = !inCockpit;

    // Valeurs détaillées.
    fields.altitude.textContent = formatAltitude(aircraft.altitudeFt, preferences.altitudeUnit, aircraft.onGround);
    fields.altGeom.textContent = aircraft.onGround
      ? 'Au sol'
      : formatAltitude(aircraft.altGeomFt, preferences.altitudeUnit, false);
    fields.speed.textContent = formatSpeed(aircraft.groundSpeedKt, preferences.speedUnit);
    fields.track.textContent = formatHeading(aircraft.trackDeg);
    fields.verticalRate.textContent = formatVerticalRate(aircraft.verticalRateFpm, preferences.altitudeUnit);
    fields.country.textContent = displayValue(aircraft.country);
    fields.registration.textContent = displayValue(aircraft.registration);
    fields.type.textContent = aircraft.typeCode
      ? `${aircraft.typeCode}${aircraft.description ? ` (${aircraft.description})` : ''}`
      : NOT_AVAILABLE;
    fields.hex.textContent = displayValue(aircraft.hex);
    fields.squawk.textContent = aircraft.squawk
      ? `${aircraft.squawk}${aircraft.emergency ? ` · Urgence : ${aircraft.emergency}` : ''}`
      : NOT_AVAILABLE;
    fields.coords.textContent = formatCoordinates(aircraft.lat, aircraft.lon);
    fields.lastPos.textContent = formatAge(ageSeconds);
  }

  /** Rafraîchit chaque seconde l'ancienneté de la dernière position reçue. */
  const ageTimer = setInterval(() => {
    if (!panel.hidden) render();
  }, 1000);

  store.subscribe(render, ['selectedId', 'flights', 'cameraMode', 'preferences', 'dataStatus']);
  render();

  return {
    render,
    setOrientationStatus({ active, message }) {
      if (orientationBtn) {
        orientationBtn.classList.toggle('is-active', active);
        orientationBtn.setAttribute('aria-pressed', String(active));
        orientationBtn.textContent = active ? 'Capteur actif (désactiver)' : 'Orientation smartphone';
      }
      if (orientationMsgEl) {
        orientationMsgEl.textContent = message;
      }
    },
    destroy() {
      clearInterval(ageTimer);
    },
  };
}

