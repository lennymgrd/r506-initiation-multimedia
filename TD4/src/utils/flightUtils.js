/**
 * Utilitaires "purs" pour les données aériennes : conversions d'unités,
 * normalisation des réponses ADSB.fi, fusion des relevés successifs,
 * calculs géographiques et interpolation des positions.
 *
 * Ce module ne dépend ni de Cesium ni du DOM : il est donc testable
 * directement avec Vitest (voir tests/flightUtils.test.js).
 */
import { countryFromIcaoHex } from './icaoCountries.js';

// ---------------------------------------------------------------------------
// Constantes et conversions d'unités
// ---------------------------------------------------------------------------

export const FEET_TO_METERS = 0.3048;
export const KNOTS_TO_KMH = 1.852;
export const NM_TO_METERS = 1852;
export const EARTH_RADIUS_M = 6_371_008.8;
export const NOT_AVAILABLE = 'Non disponible';

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export function feetToMeters(feet) {
  return isFiniteNumber(feet) ? feet * FEET_TO_METERS : null;
}

export function knotsToKmh(knots) {
  return isFiniteNumber(knots) ? knots * KNOTS_TO_KMH : null;
}

export function nauticalMilesToMeters(nm) {
  return isFiniteNumber(nm) ? nm * NM_TO_METERS : null;
}

// ---------------------------------------------------------------------------
// Formatage pour l'affichage
// ---------------------------------------------------------------------------

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** Altitude (fournie en pieds) formatée dans l'unité choisie. */
export function formatAltitude(feet, unit = 'm', onGround = false) {
  if (onGround) return 'Au sol';
  if (!isFiniteNumber(feet)) return NOT_AVAILABLE;
  return unit === 'ft'
    ? `${numberFormat.format(feet)} ft`
    : `${numberFormat.format(feetToMeters(feet))} m`;
}

/** Vitesse (fournie en nœuds) formatée dans l'unité choisie. */
export function formatSpeed(knots, unit = 'kmh') {
  if (!isFiniteNumber(knots)) return NOT_AVAILABLE;
  return unit === 'kt'
    ? `${numberFormat.format(knots)} kt`
    : `${numberFormat.format(knotsToKmh(knots))} km/h`;
}

export function formatHeading(degrees) {
  if (!isFiniteNumber(degrees)) return NOT_AVAILABLE;
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const label = cardinals[Math.round(normalizeDegrees(degrees) / 45) % 8];
  return `${Math.round(normalizeDegrees(degrees))}° ${label}`;
}

export function formatVerticalRate(feetPerMinute, unit = 'm') {
  if (!isFiniteNumber(feetPerMinute)) return NOT_AVAILABLE;
  const sign = feetPerMinute > 0 ? '+' : '';
  return unit === 'ft'
    ? `${sign}${numberFormat.format(feetPerMinute)} ft/min`
    : `${sign}${(feetPerMinute * FEET_TO_METERS / 60).toFixed(1)} m/s`;
}

export function formatCoordinates(lat, lon) {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return NOT_AVAILABLE;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'O';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/** Ancienneté lisible : "il y a 12 s", "il y a 3 min". */
export function formatAge(seconds) {
  if (!isFiniteNumber(seconds) || seconds < 0) return NOT_AVAILABLE;
  if (seconds < 1) return "à l'instant";
  if (seconds < 60) return `il y a ${Math.round(seconds)} s`;
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  return `il y a ${Math.floor(seconds / 3600)} h`;
}

export function displayValue(value) {
  return value === null || value === undefined || value === '' ? NOT_AVAILABLE : String(value);
}

// ---------------------------------------------------------------------------
// Normalisation des données ADSB.fi
// ---------------------------------------------------------------------------

/** Catégories d'émetteur ADS-B (DO-260B). */
const CATEGORY_LABELS = {
  A1: 'Avion léger',
  A2: 'Avion moyen (petit)',
  A3: 'Avion moyen (gros)',
  A4: 'Gros porteur à fort sillage',
  A5: 'Avion lourd',
  A6: 'Haute performance',
  A7: 'Hélicoptère',
  B1: 'Planeur',
  B2: 'Ballon / dirigeable',
  B4: 'ULM',
  B6: 'Drone',
  C1: 'Véhicule de surface (urgence)',
  C2: 'Véhicule de surface (service)',
};

export function categoryLabel(code) {
  return CATEGORY_LABELS[code] ?? null;
}

/** Supprime les espaces de remplissage de l'indicatif ("AFR123  " → "AFR123"). */
export function cleanCallsign(flight) {
  if (typeof flight !== 'string') return null;
  const value = flight.trim().toUpperCase();
  return value === '' ? null : value;
}

/** Identifiant stable d'un appareil : son adresse OACI 24 bits (hex) en minuscules. */
export function aircraftId(hex) {
  if (typeof hex !== 'string') return null;
  const value = hex.trim().toLowerCase();
  return /^~?[0-9a-f]{6}$/.test(value) ? value : null;
}

export function isValidPosition(lat, lon) {
  return isFiniteNumber(lat) && isFiniteNumber(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    && !(lat === 0 && lon === 0);
}

/**
 * Transforme un objet "aircraft" brut d'ADSB.fi en objet interne cohérent.
 * Retourne `null` si l'appareil est inexploitable (identifiant ou position invalide,
 * position trop ancienne).
 *
 * @param {object} raw          objet brut de la réponse (`ac[i]`)
 * @param {number} receivedAtMs heure locale de réception de la réponse
 * @param {object} [options]
 * @param {number} [options.maxPositionAgeS=60]
 */
export function normalizeAircraft(raw, receivedAtMs, { maxPositionAgeS = 60 } = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const id = aircraftId(raw.hex);
  if (!id) return null;

  // Certaines réponses (v2) placent la dernière position connue dans `lastPosition`.
  let { lat, lon } = raw;
  let seenPos = isFiniteNumber(raw.seen_pos) ? raw.seen_pos : null;
  if (!isValidPosition(lat, lon) && raw.lastPosition && isValidPosition(raw.lastPosition.lat, raw.lastPosition.lon)) {
    ({ lat, lon } = raw.lastPosition);
    seenPos = isFiniteNumber(raw.lastPosition.seen_pos) ? raw.lastPosition.seen_pos : null;
  }
  if (!isValidPosition(lat, lon)) return null;

  const positionAgeS = seenPos ?? (isFiniteNumber(raw.seen) ? raw.seen : 0);
  if (positionAgeS > maxPositionAgeS) return null;

  const onGround = raw.alt_baro === 'ground';
  const altBaroFt = isFiniteNumber(raw.alt_baro) ? raw.alt_baro : null;
  const altGeomFt = isFiniteNumber(raw.alt_geom) ? raw.alt_geom : null;
  const trackDeg = firstFinite(raw.track, raw.true_heading, raw.mag_heading);

  return {
    id,
    hex: id.replace('~', '').toUpperCase(),
    callsign: cleanCallsign(raw.flight),
    registration: typeof raw.r === 'string' && raw.r.trim() ? raw.r.trim() : null,
    typeCode: typeof raw.t === 'string' && raw.t.trim() ? raw.t.trim() : null,
    description: typeof raw.desc === 'string' && raw.desc.trim() ? raw.desc.trim() : null,
    category: typeof raw.category === 'string' ? raw.category : null,
    country: id.startsWith('~') ? null : countryFromIcaoHex(id),
    lat,
    lon,
    onGround,
    altBaroFt,
    altGeomFt,
    /** Altitude affichée : barométrique en priorité (celle des contrôleurs aériens). */
    altitudeFt: onGround ? 0 : firstFinite(altBaroFt, altGeomFt),
    groundSpeedKt: isFiniteNumber(raw.gs) ? raw.gs : null,
    trackDeg: isFiniteNumber(trackDeg) ? normalizeDegrees(trackDeg) : null,
    verticalRateFpm: firstFinite(raw.geom_rate, raw.baro_rate),
    squawk: typeof raw.squawk === 'string' ? raw.squawk : null,
    emergency: typeof raw.emergency === 'string' && raw.emergency !== 'none' ? raw.emergency : null,
    sourceType: typeof raw.type === 'string' ? raw.type : null,
    seenS: isFiniteNumber(raw.seen) ? raw.seen : null,
    seenPosS: positionAgeS,
    /** Heure locale (ms) à laquelle la position a été mesurée. */
    positionTimeMs: receivedAtMs - positionAgeS * 1000,
  };
}

/**
 * Altitude (m) utilisée pour placer l'avion dans la scène 3D.
 * L'altitude géométrique (GNSS, rapportée à l'ellipsoïde WGS84) correspond au
 * repère de Cesium ; à défaut on utilise l'altitude barométrique (approximation).
 */
export function positioningAltitudeMeters(aircraft) {
  if (!aircraft || aircraft.onGround) return 0;
  const feet = firstFinite(aircraft.altGeomFt, aircraft.altBaroFt);
  return isFiniteNumber(feet) ? Math.max(0, feet * FEET_TO_METERS) : 0;
}

/**
 * Valide et normalise une réponse JSON complète d'ADSB.fi.
 * Accepte les formats v3 (`ac`) et v2 (`aircraft` ou `ac`).
 * Les doublons éventuels (même hex) sont fusionnés en gardant la position la plus récente.
 */
export function normalizeResponse(json, receivedAtMs, options = {}) {
  if (!json || typeof json !== 'object') {
    throw new TypeError('Réponse ADSB.fi invalide : objet JSON attendu.');
  }
  const list = Array.isArray(json.ac) ? json.ac : Array.isArray(json.aircraft) ? json.aircraft : null;
  if (!list) {
    // Une réponse sans avion peut contenir `ac: null` ou aucun champ : ce n'est pas une erreur.
    if (json.ac === null || json.total === 0 || json.msg) {
      return { aircraft: [], rejected: 0, serverTimeMs: json.now ?? null };
    }
    throw new TypeError('Réponse ADSB.fi invalide : liste "ac" absente.');
  }

  const byId = new Map();
  let rejected = 0;
  for (const raw of list) {
    const aircraft = normalizeAircraft(raw, receivedAtMs, options);
    if (!aircraft) {
      rejected += 1;
      continue;
    }
    const existing = byId.get(aircraft.id);
    if (!existing || aircraft.positionTimeMs > existing.positionTimeMs) byId.set(aircraft.id, aircraft);
  }
  return { aircraft: [...byId.values()], rejected, serverTimeMs: json.now ?? null };
}

// ---------------------------------------------------------------------------
// Fusion des relevés successifs (sans duplication)
// ---------------------------------------------------------------------------

/**
 * Fusionne un nouveau relevé avec les avions déjà connus.
 *
 * - Un avion déjà connu est mis à jour (même objet de suivi, pas de doublon).
 * - Un avion sorti de la zone géographique `area` (ou lorsque `dropMissing` vaut `true`)
 *   est retiré immédiatement pour que la liste reflète fidèlement la zone consultée.
 * - Un avion toujours dans la zone mais absent d'un relevé est conservé `missingGraceS`
 *   secondes (marqué `missing`).
 * - Les avions de `keepIds` (ex. l'avion sélectionné) ne sont jamais supprimés.
 *
 * @returns {{ flights: Map, added: string[], updated: string[], removed: string[] }}
 */
export function mergeFlights(
  previous,
  incoming,
  { nowMs, missingGraceS = 75, keepIds = new Set(), dropMissing = false, area = null } = {},
) {
  const flights = new Map();
  const added = [];
  const updated = [];
  const removed = [];

  for (const aircraft of incoming) {
    const before = previous.get(aircraft.id);
    if (before) {
      // On ignore un relevé plus ancien que celui déjà connu.
      const data = aircraft.positionTimeMs >= before.data.positionTimeMs ? aircraft : before.data;
      flights.set(aircraft.id, { ...before, data, missing: false, lastSeenMs: nowMs });
      updated.push(aircraft.id);
    } else {
      flights.set(aircraft.id, { id: aircraft.id, data: aircraft, missing: false, firstSeenMs: nowMs, lastSeenMs: nowMs });
      added.push(aircraft.id);
    }
  }

  for (const [id, entry] of previous) {
    if (flights.has(id)) continue;
    const expired = nowMs - entry.lastSeenMs > missingGraceS * 1000;
    const outOfArea = area
      ? distanceNm(area.lat, area.lon, entry.data.lat, entry.data.lon) > area.radiusNm * 1.05
      : false;
    if (keepIds.has(id) || (!dropMissing && !expired && !outOfArea)) {
      flights.set(id, { ...entry, missing: true });
    } else {
      removed.push(id);
    }
  }

  return { flights, added, updated, removed };
}

// ---------------------------------------------------------------------------
// Géographie
// ---------------------------------------------------------------------------

export function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Distance orthodromique (formule de haversine) en milles nautiques. */
export function distanceNm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return (2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))) / NM_TO_METERS;
}

/** Point atteint en partant de (lat, lon) selon un cap (°) et une distance (m). */
export function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/**
 * Rayon de requête (NM) adapté à la hauteur de la caméra : plus on est haut,
 * plus la zone est grande, dans la limite des 250 NM documentés par ADSB.fi.
 */
export function radiusForCameraHeight(heightM, { minNm = 25, maxNm = 250 } = {}) {
  if (!isFiniteNumber(heightM) || heightM <= 0) return maxNm;
  const radius = (heightM * 0.9) / NM_TO_METERS;
  return Math.round(Math.min(maxNm, Math.max(minNm, radius)));
}

/** Indique si la zone consultée a suffisamment changé pour justifier une nouvelle requête. */
export function hasAreaChanged(previous, next, ratio = 0.18) {
  if (!previous) return true;
  const moved = distanceNm(previous.lat, previous.lon, next.lat, next.lon);
  const radiusChange = Math.abs(next.radiusNm - previous.radiusNm) / previous.radiusNm;
  return moved > previous.radiusNm * ratio || radiusChange > 0.2;
}

// ---------------------------------------------------------------------------
// Interpolation / extrapolation des mouvements
// ---------------------------------------------------------------------------

/**
 * Position estimée d'un avion à l'instant `atMs` par estime (vitesse + cap),
 * limitée à `maxExtrapolationS` secondes après la dernière mesure.
 */
export function extrapolatePosition(aircraft, atMs, maxExtrapolationS = 45) {
  const altitudeM = positioningAltitudeMeters(aircraft);
  const base = { lat: aircraft.lat, lon: aircraft.lon, altitudeM };
  const canMove = !aircraft.onGround || (aircraft.groundSpeedKt ?? 0) > 3;
  if (!canMove || !isFiniteNumber(aircraft.groundSpeedKt) || !isFiniteNumber(aircraft.trackDeg)) return base;

  const dtS = Math.min(Math.max(0, (atMs - aircraft.positionTimeMs) / 1000), maxExtrapolationS);
  if (dtS === 0) return base;

  const speedMs = (aircraft.groundSpeedKt * NM_TO_METERS) / 3600;
  const point = destinationPoint(aircraft.lat, aircraft.lon, aircraft.trackDeg, speedMs * dtS);
  const climbM = isFiniteNumber(aircraft.verticalRateFpm) && !aircraft.onGround
    ? (aircraft.verticalRateFpm * FEET_TO_METERS * dtS) / 60
    : 0;
  return { lat: point.lat, lon: point.lon, altitudeM: Math.max(0, altitudeM + climbM) };
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/** Interpolation entre deux positions (gère le passage de l'antiméridien ±180°). */
export function interpolatePositions(from, to, t) {
  const k = smoothstep(Math.min(1, Math.max(0, t)));
  let dLon = to.lon - from.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return {
    lat: from.lat + (to.lat - from.lat) * k,
    lon: ((from.lon + dLon * k + 540) % 360) - 180,
    altitudeM: from.altitudeM + (to.altitudeM - from.altitudeM) * k,
  };
}

/** Interpolation d'angle par le plus court chemin (ex. 350° → 10°). */
export function interpolateHeading(fromDeg, toDeg, t) {
  if (!isFiniteNumber(fromDeg)) return toDeg;
  if (!isFiniteNumber(toDeg)) return fromDeg;
  let delta = normalizeDegrees(toDeg) - normalizeDegrees(fromDeg);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeDegrees(fromDeg + delta * Math.min(1, Math.max(0, t)));
}

// ---------------------------------------------------------------------------
// Recherche, filtres et tri de la liste
// ---------------------------------------------------------------------------

/** Texte utilisé par la recherche locale. */
function searchableText(aircraft) {
  return [aircraft.callsign, aircraft.hex, aircraft.registration, aircraft.typeCode, aircraft.country]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const SORTERS = {
  // Les avions sans indicatif sont placés en fin de liste.
  callsign: (a, b) => {
    if (!a.callsign || !b.callsign) return (a.callsign ? 0 : 1) - (b.callsign ? 0 : 1);
    return a.callsign.localeCompare(b.callsign);
  },
  altitude: (a, b) => (b.altitudeFt ?? -1) - (a.altitudeFt ?? -1),
  speed: (a, b) => (b.groundSpeedKt ?? -1) - (a.groundSpeedKt ?? -1),
};

/**
 * Filtre et trie une liste d'avions normalisés.
 * @param {object[]} list
 * @param {{ query?: string, callsignPrefix?: string, sortBy?: 'callsign'|'altitude'|'speed', showGround?: boolean }} options
 */
export function filterAndSortFlights(list, { query = '', callsignPrefix = '', sortBy = 'callsign', showGround = true } = {}) {
  const needle = query.trim().toLowerCase();
  const prefix = callsignPrefix.trim().toUpperCase();
  return list
    .filter((a) => showGround || !a.onGround)
    .filter((a) => !prefix || (a.callsign ?? '').startsWith(prefix))
    .filter((a) => !needle || searchableText(a).includes(needle))
    .sort(SORTERS[sortBy] ?? SORTERS.callsign);
}

/** Préfixes OACI des compagnies (3 lettres) présents dans la liste, pour le filtre. */
export function callsignPrefixes(list) {
  const counts = new Map();
  for (const a of list) {
    const match = /^([A-Z]{3})\d/.exec(a.callsign ?? '');
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
}

function firstFinite(...values) {
  return values.find(isFiniteNumber) ?? null;
}
