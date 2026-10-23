/**
 * Menu latéral des vols détectés ("Vols dans la zone").
 *
 * Responsabilités :
 *  - afficher la liste des avions détectés dans la zone consultée ;
 *  - filtrer localement la liste (texte, préfixe d'indicatif, avions au sol) ;
 *  - proposer une recherche distante explicite par indicatif via ADSB.fi
 *    (/v2/callsign/{callsign}), clairement distinguée du filtre local ;
 *  - trier par indicatif, altitude ou vitesse ;
 *  - sélectionner un avion au clic et synchroniser l'élément actif.
 */
import { PLANE_PATH } from '../globe/aircraft.js';
import {
  callsignPrefixes,
  displayValue,
  filterAndSortFlights,
  formatAltitude,
  formatSpeed,
} from '../utils/flightUtils.js';

/**
 * @param {HTMLElement} root
 * @param {{
 *   store: ReturnType<import('../state/appState.js').createStore>,
 *   onSelectFlight: (id: string) => void,
 *   onRemoteCallsignSearch: (callsign: string) => void,
 *   onClearRemoteSearch: () => void,
 *   onToggleGround: (showGround: boolean) => void,
 *   onCloseMobileMenu: () => void,
 * }} handlers
 */
export function createFlightListUI(
  root,
  {
    store,
    onSelectFlight,
    onRemoteCallsignSearch,
    onClearRemoteSearch,
    onToggleGround,
    onCloseMobileMenu,
  },
) {
  const searchInput = root.querySelector('#flight-search-input');
  const clearSearchBtn = root.querySelector('#flight-search-clear');
  const remoteSearchBtn = root.querySelector('#remote-callsign-btn');
  const remoteBanner = root.querySelector('#remote-search-banner');
  const remoteBannerText = root.querySelector('#remote-search-text');
  const remoteBannerReset = root.querySelector('#remote-search-reset');
  const prefixSelect = root.querySelector('#callsign-prefix-select');
  const sortSelect = root.querySelector('#flight-sort-select');
  const groundCheckbox = root.querySelector('#filter-ground-checkbox');
  const countBadge = root.querySelector('#sidebar-flight-count');
  const loadingIndicator = root.querySelector('#sidebar-loading');
  const listContainer = root.querySelector('#flight-list-items');
  const emptyState = root.querySelector('#flight-list-empty');
  const emptyTitle = root.querySelector('#flight-empty-title');
  const emptySubtitle = root.querySelector('#flight-empty-subtitle');
  const mobileCloseBtn = root.querySelector('#sidebar-close-btn');

  // Événements de recherche et de filtrage local.
  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    clearSearchBtn.hidden = query.length === 0;
    const { filters } = store.getState();
    store.setState({ filters: { ...filters, query } });
    updateRemoteButtonState();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && searchInput.value.trim().length >= 2) {
      event.preventDefault();
      onRemoteCallsignSearch(searchInput.value.trim());
    }
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.hidden = true;
    const { filters } = store.getState();
    store.setState({ filters: { ...filters, query: '' } });
    if (store.getState().remoteResults) {
      onClearRemoteSearch();
    }
    updateRemoteButtonState();
  });

  remoteSearchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query.length >= 2) {
      onRemoteCallsignSearch(query);
    }
  });

  remoteBannerReset.addEventListener('click', () => {
    onClearRemoteSearch();
  });

  prefixSelect.addEventListener('change', () => {
    const { filters } = store.getState();
    store.setState({ filters: { ...filters, callsignPrefix: prefixSelect.value } });
  });

  sortSelect.addEventListener('change', () => {
    const { filters } = store.getState();
    store.setState({ filters: { ...filters, sortBy: sortSelect.value } });
  });

  groundCheckbox.addEventListener('change', () => {
    onToggleGround(groundCheckbox.checked);
  });

  mobileCloseBtn?.addEventListener('click', () => {
    onCloseMobileMenu();
  });

  listContainer.addEventListener('click', (event) => {
    const item = event.target.closest('[data-flight-id]');
    if (!item) return;
    onSelectFlight(item.dataset.flightId);
  });

  function updateRemoteButtonState() {
    const candidate = searchInput.value.trim().toUpperCase();
    const valid = /^[A-Z0-9]{2,8}$/.test(candidate);
    remoteSearchBtn.disabled = !valid;
    remoteSearchBtn.title = valid
      ? `Interroger ADSB.fi pour l'indicatif exact « ${candidate} » (/v2/callsign/${candidate})`
      : 'Saisissez un indicatif de 2 à 8 caractères (ex. AFR1234) pour lancer une recherche distante';
  }

  /** Met à jour la liste déroulante des préfixes d'indicatifs présents dans la zone. */
  function updatePrefixOptions(allAircraft, currentPrefix) {
    const prefixes = callsignPrefixes(allAircraft).slice(0, 35);
    const currentValues = Array.from(prefixSelect.options).map((o) => o.value);
    const nextValues = ['', ...prefixes];
    if (currentValues.join(',') === nextValues.join(',')) {
      prefixSelect.value = currentPrefix;
      return;
    }
    prefixSelect.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'Tous les indicatifs';
    prefixSelect.appendChild(allOpt);
    for (const prefix of prefixes) {
      const opt = document.createElement('option');
      opt.value = prefix;
      opt.textContent = `${prefix}…`;
      prefixSelect.appendChild(opt);
    }
    if (currentPrefix && !prefixes.includes(currentPrefix)) {
      const customOpt = document.createElement('option');
      customOpt.value = currentPrefix;
      customOpt.textContent = `${currentPrefix}…`;
      prefixSelect.appendChild(customOpt);
    }
    prefixSelect.value = currentPrefix;
  }

  function render() {
    const state = store.getState();
    const { flights, filters, preferences, selectedId, dataStatus, remoteResults } = state;

    groundCheckbox.checked = preferences.showGround;
    sortSelect.value = filters.sortBy;
    loadingIndicator.hidden = dataStatus.state !== 'loading';

    const allZoneAircraft = Array.from(flights.values()).map((entry) => ({
      ...entry.data,
      missing: entry.missing,
    }));

    updatePrefixOptions(allZoneAircraft, filters.callsignPrefix);

    // Si une recherche distante (/v2/callsign) est active, on l'indique clairement.
    const isRemoteActive = Boolean(remoteResults);
    remoteBanner.hidden = !isRemoteActive;
    if (isRemoteActive) {
      remoteBannerText.textContent = `Recherche distante ADSB.fi « ${remoteResults.callsign} » (${remoteResults.aircraft.length} résultat${remoteResults.aircraft.length > 1 ? 's' : ''})`;
    }

    const sourceList = isRemoteActive
      ? remoteResults.aircraft
      : filterAndSortFlights(allZoneAircraft, {
          query: filters.query,
          callsignPrefix: filters.callsignPrefix,
          sortBy: filters.sortBy,
          showGround: preferences.showGround,
        });

    countBadge.textContent = isRemoteActive
      ? `${sourceList.length} (distant)`
      : `${sourceList.length} / ${allZoneAircraft.length}`;

    if (sourceList.length === 0) {
      listContainer.innerHTML = '';
      emptyState.hidden = false;
      if (dataStatus.state === 'loading' && allZoneAircraft.length === 0) {
        emptyTitle.textContent = 'Récupération des vols en cours…';
        emptySubtitle.textContent = 'Interrogation de la zone géographique affichée.';
      } else if (isRemoteActive) {
        emptyTitle.textContent = `Aucun avion trouvé pour « ${remoteResults.callsign} »`;
        emptySubtitle.textContent = "Vérifiez l'indicatif OACI ou revenez aux vols de la zone.";
      } else if (allZoneAircraft.length > 0) {
        emptyTitle.textContent = 'Aucun vol ne correspond aux filtres';
        emptySubtitle.textContent = 'Modifiez votre recherche locale ou réinitialisez les filtres.';
      } else {
        emptyTitle.textContent = 'Aucun avion détecté dans cette zone';
        emptySubtitle.textContent = 'Déplacez le globe, zoomez sur une région habitée ou actualisez les données.';
      }
      return;
    }

    emptyState.hidden = true;
    const fragment = document.createDocumentFragment();

    for (const aircraft of sourceList) {
      const li = document.createElement('li');
      li.className = 'flight-item';
      if (aircraft.id === selectedId) li.classList.add('is-selected');
      if (aircraft.missing) li.classList.add('is-missing');
      li.dataset.flightId = aircraft.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');

      const callsignLabel = aircraft.callsign ?? `Sans indicatif (${aircraft.hex})`;
      const countryLabel = displayValue(aircraft.country);
      const altitudeLabel = formatAltitude(aircraft.altitudeFt, preferences.altitudeUnit, aircraft.onGround);
      const speedLabel = formatSpeed(aircraft.groundSpeedKt, preferences.speedUnit);
      const rotation = Number.isFinite(aircraft.trackDeg) ? Math.round(aircraft.trackDeg) : 0;
      const typeBadge = aircraft.typeCode ? `<span class="flight-type-tag">${escapeHtml(aircraft.typeCode)}</span>` : '';
      const missingBadge = aircraft.missing ? '<span class="flight-missing-tag" title="Dernière position conservée temporairement">Signal perdu</span>' : '';

      li.innerHTML = `
        <div class="flight-item-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" style="transform: rotate(${rotation}deg)">
            <path d="${PLANE_PATH}" fill="currentColor" />
          </svg>
        </div>
        <div class="flight-item-main">
          <div class="flight-item-top">
            <span class="flight-callsign">${escapeHtml(callsignLabel)}</span>
            <div class="flight-badges">${typeBadge}${missingBadge}</div>
          </div>
          <div class="flight-item-sub">
            <span class="flight-country" title="Pays d'immatriculation OACI">${escapeHtml(countryLabel)}</span>
            <span class="flight-hex">HEX ${escapeHtml(aircraft.hex)}</span>
          </div>
        </div>
        <div class="flight-item-metrics">
          <span class="metric-pill metric-alt" title="Altitude">${escapeHtml(altitudeLabel)}</span>
          <span class="metric-pill metric-spd" title="Vitesse sol">${escapeHtml(speedLabel)}</span>
        </div>
      `;

      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectFlight(aircraft.id);
        }
      });

      fragment.appendChild(li);
    }

    const previousScroll = listContainer.scrollTop;
    listContainer.replaceChildren(fragment);
    listContainer.scrollTop = previousScroll;
  }

  store.subscribe(render, [
    'flights',
    'filters',
    'preferences',
    'selectedId',
    'dataStatus',
    'remoteResults',
  ]);

  updateRemoteButtonState();
  render();

  return {
    render,
    focusSearch() {
      searchInput.focus();
    },
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

