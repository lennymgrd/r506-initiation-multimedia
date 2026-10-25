/**
 * Source d'état unique de l'application (petit "store" observable).
 *
 * Toutes les informations partagées entre modules passent par ici :
 * avion sélectionné, mode de caméra, préférences, statut des données, etc.
 * Un module modifie l'état avec `setState()` ; les autres réagissent via `subscribe()`.
 */
import { DEFAULT_PREFERENCES, MOBILE_RENDER_PROFILES, SETTINGS } from '../config/settings.js';

/** Charge les préférences sauvegardées (en ignorant les valeurs inconnues). */
export function loadPreferences(storage = globalThis.localStorage, { lowPower = false, mobile = false } = {}) {
  const defaults = {
    ...DEFAULT_PREFERENCES,
    ...((mobile || lowPower) ? { showLabels: false } : {}),
    ...(mobile && lowPower ? { mobileRendering: 'economy' } : {}),
  };
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS.storageKey) ?? '{}');
    // Sur smartphone, on désactive les étiquettes de texte par défaut pour fluidifier le rendu WebGL.
    const prefs = { ...defaults };
    for (const key of Object.keys(DEFAULT_PREFERENCES)) {
      if (typeof saved[key] === typeof DEFAULT_PREFERENCES[key]) prefs[key] = saved[key];
    }
    if (!SETTINGS.refresh.allowedIntervalsS.includes(prefs.refreshIntervalS)) {
      prefs.refreshIntervalS = SETTINGS.refresh.defaultIntervalS;
    }
    if (!Object.hasOwn(MOBILE_RENDER_PROFILES, prefs.mobileRendering)) {
      prefs.mobileRendering = defaults.mobileRendering;
    }
    return prefs;
  } catch {
    return defaults;
  }
}

export function savePreferences(prefs, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS.storageKey, JSON.stringify(prefs));
  } catch (error) {
    // Mode navigation privée ou stockage plein : l'application reste utilisable.
    console.warn('[preferences] Sauvegarde impossible :', error);
  }
}

export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  return {
    getState: () => state,

    /** Fusionne `patch` dans l'état et notifie les abonnés des clés modifiées. */
    setState(patch) {
      const changed = Object.keys(patch).filter((key) => state[key] !== patch[key]);
      if (changed.length === 0) return;
      const previous = state;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state, previous, changed);
    },

    /**
     * S'abonne aux changements. Si `keys` est fourni, la fonction n'est appelée
     * que lorsque l'une de ces clés change.
     */
    subscribe(listener, keys = null) {
      const wrapped = (current, previous, changed) => {
        if (!keys || changed.some((key) => keys.includes(key))) listener(current, previous);
      };
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },
  };
}

/** État initial de l'application. */
export function createInitialState(preferences) {
  return {
    preferences,
    /** Map<id, { id, data, missing, firstSeenMs, lastSeenMs }> */
    flights: new Map(),
    selectedId: null,
    /** 'global' | 'chase' | 'cockpit' */
    cameraMode: 'global',
    dataStatus: { state: 'idle', message: '', source: preferences.demoMode ? 'demo' : 'live', lastUpdateMs: null, error: null },
    globeStatus: { state: 'loading', message: 'Chargement du globe 3D…', quality: preferences.quality },
    area: null,
    filters: { query: '', callsignPrefix: '', sortBy: 'callsign' },
    remoteResults: null,
    menuOpen: false,
    settingsOpen: false,
  };
}

