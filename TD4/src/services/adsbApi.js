/**
 * Accès réseau à l'API ouverte ADSB.fi (https://github.com/adsbfi/opendata).
 *
 * Responsabilités :
 *  - construire les URL des endpoints documentés ;
 *  - respecter la limite publique (1 requête / seconde) grâce à une file d'attente ;
 *  - classer les erreurs (réseau, CORS, 429, HTTP, délai dépassé, JSON invalide) ;
 *  - renvoyer des données normalisées (voir utils/flightUtils.js).
 *
 * Aucune logique d'affichage ici : le module peut être remplacé par une autre source.
 */
import { SETTINGS } from '../config/settings.js';
import { normalizeResponse } from '../utils/flightUtils.js';

/** Erreur réseau typée, avec un message compréhensible par l'utilisateur. */
export class FlightApiError extends Error {
  /**
   * @param {'offline'|'cors'|'rate-limit'|'http'|'timeout'|'invalid'|'aborted'} kind
   * @param {string} message message destiné à l'utilisateur
   * @param {{ status?: number, retryAfterS?: number, cause?: unknown }} [details]
   */
  constructor(kind, message, details = {}) {
    super(message, { cause: details.cause });
    this.name = 'FlightApiError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.retryAfterS = details.retryAfterS ?? null;
  }
}

const CALLSIGN_PATTERN = /^[A-Z0-9]{2,8}$/;

/**
 * Crée un client ADSB.fi.
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, minIntervalMs?: number, timeoutMs?: number, now?: () => number }} [options]
 */
export function createAdsbClient({
  baseUrl = SETTINGS.adsb.apiBase,
  fetchImpl = (...args) => fetch(...args),
  minIntervalMs = SETTINGS.adsb.minRequestIntervalMs,
  timeoutMs = SETTINGS.adsb.requestTimeoutMs,
  now = () => Date.now(),
} = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  /** Sérialise les requêtes et garantit un intervalle minimal entre deux appels. */
  function schedule(task) {
    const run = queue.then(async () => {
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastRequestAt = now();
      return task();
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function getJson(path, signal) {
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
    const onAbort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });

    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (error) {
      throw classifyFetchFailure(error, controller.signal, signal, base);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (response.status === 429) {
      const retryAfterS = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
      throw new FlightApiError('rate-limit', 'Trop de requêtes envoyées à ADSB.fi (HTTP 429). Actualisation ralentie automatiquement.', {
        status: 429,
        retryAfterS: Number.isFinite(retryAfterS) ? retryAfterS : null,
      });
    }
    if (!response.ok) {
      throw new FlightApiError('http', `ADSB.fi a refusé la requête (HTTP ${response.status}).`, { status: response.status });
    }

    const receivedAtMs = now();
    try {
      return { json: await response.json(), receivedAtMs };
    } catch (error) {
      throw new FlightApiError('invalid', 'Réponse ADSB.fi illisible (JSON invalide).', { cause: error });
    }
  }

  async function fetchNormalized(path, signal) {
    const { json, receivedAtMs } = await schedule(() => getJson(path, signal));
    try {
      const result = normalizeResponse(json, receivedAtMs, { maxPositionAgeS: SETTINGS.flights.maxPositionAgeS });
      return { ...result, receivedAtMs, source: 'live' };
    } catch (error) {
      throw new FlightApiError('invalid', error.message, { cause: error });
    }
  }

  return {
    baseUrl: base,

    /** Avions dans un cercle (centre GPS + rayon en milles nautiques, max 250). */
    fetchAircraftInArea({ lat, lon, radiusNm }, { signal } = {}) {
      const dist = Math.round(Math.min(SETTINGS.adsb.maxRadiusNm, Math.max(1, radiusNm)));
      return fetchNormalized(`/v3/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${dist}`, signal);
    },

    /** Recherche distante explicite par indicatif (endpoint documenté /v2/callsign). */
    fetchByCallsign(callsign, { signal } = {}) {
      const value = String(callsign ?? '').trim().toUpperCase();
      if (!CALLSIGN_PATTERN.test(value)) {
        // On évite d'envoyer une requête invalide (elles comptent dans la limite ADSB.fi).
        return Promise.reject(new FlightApiError('invalid', 'Indicatif invalide : 2 à 8 lettres ou chiffres (ex. AFR1234).'));
      }
      return fetchNormalized(`/v2/callsign/${value}`, signal);
    },

    /** Recherche d'un appareil par adresse OACI (hex). */
    fetchByHex(hex, { signal } = {}) {
      const value = String(hex ?? '').replace('~', '').trim().toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(value)) {
        return Promise.reject(new FlightApiError('invalid', 'Adresse OACI invalide.'));
      }
      return fetchNormalized(`/v2/hex/${value}`, signal);
    },
  };
}

/** Transforme un échec de fetch() en erreur explicite. */
function classifyFetchFailure(error, internalSignal, externalSignal, base) {
  if (externalSignal?.aborted) {
    return new FlightApiError('aborted', 'Requête annulée.', { cause: error });
  }
  if (internalSignal.aborted) {
    return new FlightApiError('timeout', 'ADSB.fi ne répond pas (délai dépassé).', { cause: error });
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new FlightApiError('offline', 'Aucune connexion Internet.', { cause: error });
  }
  const crossOrigin = typeof location !== 'undefined' && /^https?:\/\//.test(base) && !base.startsWith(location.origin);
  if (crossOrigin) {
    // Le navigateur ne donne pas le détail d'un blocage CORS : fetch() échoue avec une TypeError.
    return new FlightApiError(
      'cors',
      "Le navigateur a bloqué l'appel direct à ADSB.fi (CORS ou réseau). Configurez un relais (VITE_ADSB_API_BASE, voir README) ou activez le mode démo.",
      { cause: error },
    );
  }
  return new FlightApiError('offline', 'Impossible de joindre le service de données aériennes.', { cause: error });
}

