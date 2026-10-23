import { describe, expect, it } from 'vitest';
import {
  aircraftId,
  callsignPrefixes,
  cleanCallsign,
  destinationPoint,
  distanceNm,
  extrapolatePosition,
  feetToMeters,
  filterAndSortFlights,
  formatAge,
  formatAltitude,
  formatSpeed,
  hasAreaChanged,
  interpolateHeading,
  interpolatePositions,
  knotsToKmh,
  mergeFlights,
  normalizeAircraft,
  normalizeResponse,
  positioningAltitudeMeters,
  radiusForCameraHeight,
} from '../src/utils/flightUtils.js';
import { countryFromIcaoHex } from '../src/utils/icaoCountries.js';
import { buildDemoResponse } from '../src/data/demoFlights.js';

const NOW = 1_800_000_000_000;

/** Extrait réel (simplifié) d'une réponse ADSB.fi v3. */
const RAW = {
  hex: '3C54A5',
  type: 'adsb_icao',
  flight: 'EWG4L   ',
  r: 'D-AEEE',
  t: 'A21N',
  desc: 'AIRBUS A-321neo',
  alt_baro: 36000,
  alt_geom: 36925,
  gs: 514.3,
  track: 23.13,
  geom_rate: 32,
  squawk: '5516',
  emergency: 'none',
  category: 'A3',
  lat: 43.965408,
  lon: 6.287246,
  seen_pos: 0.29,
  seen: 0.1,
};

describe('conversions d’unités', () => {
  it('convertit les pieds en mètres', () => {
    expect(feetToMeters(1000)).toBeCloseTo(304.8, 5);
    expect(feetToMeters(36000)).toBeCloseTo(10972.8, 3);
    expect(feetToMeters(undefined)).toBeNull();
  });

  it('convertit les nœuds en km/h', () => {
    expect(knotsToKmh(100)).toBeCloseTo(185.2, 5);
    expect(knotsToKmh(null)).toBeNull();
  });

  it('formate altitude et vitesse selon l’unité choisie', () => {
    expect(formatAltitude(36000, 'm')).toMatch(/10\s?973 m/);
    expect(formatAltitude(36000, 'ft')).toMatch(/36\s?000 ft/);
    expect(formatAltitude(null, 'm', true)).toBe('Au sol');
    expect(formatAltitude(undefined)).toBe('Non disponible');
    expect(formatSpeed(500, 'kmh')).toBe('926 km/h');
    expect(formatSpeed(500, 'kt')).toBe('500 kt');
    expect(formatSpeed(undefined)).toBe('Non disponible');
  });

  it('formate une ancienneté', () => {
    expect(formatAge(0.2)).toBe("à l'instant");
    expect(formatAge(12)).toBe('il y a 12 s');
    expect(formatAge(125)).toBe('il y a 2 min 5 s');
  });
});

describe('normalisation des données ADSB.fi', () => {
  it('normalise un avion complet', () => {
    const a = normalizeAircraft(RAW, NOW);
    expect(a.id).toBe('3c54a5');
    expect(a.hex).toBe('3C54A5');
    expect(a.callsign).toBe('EWG4L');
    expect(a.registration).toBe('D-AEEE');
    expect(a.typeCode).toBe('A21N');
    expect(a.country).toBe('Allemagne');
    expect(a.altitudeFt).toBe(36000);
    expect(a.onGround).toBe(false);
    expect(a.emergency).toBeNull();
    expect(a.positionTimeMs).toBe(NOW - 290);
    // Altitude de placement : géométrique en priorité.
    expect(positioningAltitudeMeters(a)).toBeCloseTo(36925 * 0.3048, 3);
  });

  it('gère les champs manquants et l’absence d’indicatif', () => {
    const a = normalizeAircraft({ hex: '4ca123', lat: 53.4, lon: -6.2 }, NOW);
    expect(a.callsign).toBeNull();
    expect(a.altitudeFt).toBeNull();
    expect(a.groundSpeedKt).toBeNull();
    expect(a.trackDeg).toBeNull();
    expect(a.country).toBe('Irlande');
    expect(positioningAltitudeMeters(a)).toBe(0);
  });

  it('gère les avions au sol', () => {
    const a = normalizeAircraft({ ...RAW, alt_baro: 'ground', alt_geom: undefined, gs: 12 }, NOW);
    expect(a.onGround).toBe(true);
    expect(a.altitudeFt).toBe(0);
    expect(positioningAltitudeMeters(a)).toBe(0);
  });

  it('rejette les positions invalides ou trop anciennes', () => {
    expect(normalizeAircraft({ ...RAW, lat: undefined }, NOW)).toBeNull();
    expect(normalizeAircraft({ ...RAW, lat: 95 }, NOW)).toBeNull();
    expect(normalizeAircraft({ ...RAW, lat: 0, lon: 0 }, NOW)).toBeNull();
    expect(normalizeAircraft({ ...RAW, seen_pos: 300 }, NOW)).toBeNull();
    expect(normalizeAircraft({ ...RAW, hex: 'xyz' }, NOW)).toBeNull();
    expect(normalizeAircraft(null, NOW)).toBeNull();
  });

  it('utilise lastPosition lorsque la position courante manque (format v2)', () => {
    const a = normalizeAircraft({ hex: '3c54a5', lastPosition: { lat: 48.8, lon: 2.3, seen_pos: 20 } }, NOW);
    expect(a.lat).toBe(48.8);
    expect(a.seenPosS).toBe(20);
  });

  it('accepte les adresses non OACI (TIS-B, préfixe ~)', () => {
    const a = normalizeAircraft({ ...RAW, hex: '~2a0b1c' }, NOW);
    expect(a.id).toBe('~2a0b1c');
    expect(a.country).toBeNull();
  });

  it('normalise une réponse et fusionne les doublons', () => {
    const json = {
      ac: [RAW, { ...RAW, seen_pos: 5, lat: 44 }, { hex: 'bad' }, { ...RAW, hex: '4ca123' }],
      now: NOW,
      total: 4,
    };
    const result = normalizeResponse(json, NOW);
    expect(result.aircraft).toHaveLength(2);
    expect(result.rejected).toBe(1);
    // La position la plus récente (seen_pos 0.29) est conservée.
    expect(result.aircraft.find((a) => a.id === '3c54a5').lat).toBe(RAW.lat);
  });

  it('accepte une réponse vide et rejette une réponse invalide', () => {
    expect(normalizeResponse({ ac: null, msg: 'No error', total: 0 }, NOW).aircraft).toEqual([]);
    expect(() => normalizeResponse('oops', NOW)).toThrow(TypeError);
    expect(() => normalizeResponse({ foo: 1 }, NOW)).toThrow(TypeError);
  });

  it('nettoie les indicatifs et identifiants', () => {
    expect(cleanCallsign(' afr123  ')).toBe('AFR123');
    expect(cleanCallsign('   ')).toBeNull();
    expect(aircraftId('3C54A5')).toBe('3c54a5');
    expect(aircraftId('12345')).toBeNull();
  });

  it('déduit le pays d’immatriculation du code OACI', () => {
    expect(countryFromIcaoHex('3944ef')).toBe('France');
    expect(countryFromIcaoHex('a1b2c3')).toBe('États-Unis');
    expect(countryFromIcaoHex('de0001')).toBeNull();
    expect(countryFromIcaoHex('zzz')).toBeNull();
  });
});

describe('fusion des relevés et sélection', () => {
  const a = normalizeAircraft(RAW, NOW);
  const b = normalizeAircraft({ ...RAW, hex: '4ca123', flight: 'EIN12' }, NOW);

  it('n’ajoute pas de doublon lors des actualisations', () => {
    const first = mergeFlights(new Map(), [a, b], { nowMs: NOW });
    expect(first.added).toEqual(['3c54a5', '4ca123']);
    const moved = { ...a, lat: a.lat + 0.1, positionTimeMs: NOW + 30_000 };
    const second = mergeFlights(first.flights, [moved, b], { nowMs: NOW + 30_000 });
    expect(second.flights.size).toBe(2);
    expect(second.added).toEqual([]);
    expect(second.updated).toEqual(['3c54a5', '4ca123']);
    expect(second.flights.get('3c54a5').data.lat).toBeCloseTo(a.lat + 0.1);
    expect(second.flights.get('3c54a5').firstSeenMs).toBe(NOW);
  });

  it('conserve temporairement un avion disparu puis le supprime', () => {
    const first = mergeFlights(new Map(), [a, b], { nowMs: NOW });
    const missing = mergeFlights(first.flights, [b], { nowMs: NOW + 30_000, missingGraceS: 75 });
    expect(missing.flights.get('3c54a5').missing).toBe(true);
    const expired = mergeFlights(missing.flights, [b], { nowMs: NOW + 120_000, missingGraceS: 75 });
    expect(expired.flights.has('3c54a5')).toBe(false);
    expect(expired.removed).toEqual(['3c54a5']);
  });

  it('ne supprime jamais l’avion sélectionné', () => {
    const first = mergeFlights(new Map(), [a, b], { nowMs: NOW });
    const result = mergeFlights(first.flights, [], { nowMs: NOW + 600_000, keepIds: new Set(['3c54a5']), dropMissing: true });
    expect(result.flights.has('3c54a5')).toBe(true);
    expect(result.flights.get('3c54a5').missing).toBe(true);
    expect(result.flights.has('4ca123')).toBe(false);
  });

  it('ignore un relevé plus ancien que celui déjà connu', () => {
    const first = mergeFlights(new Map(), [a], { nowMs: NOW });
    const old = { ...a, lat: 10, positionTimeMs: NOW - 10_000 };
    const result = mergeFlights(first.flights, [old], { nowMs: NOW + 1000 });
    expect(result.flights.get('3c54a5').data.lat).toBe(a.lat);
  });

  it('retire immédiatement les avions sortis de la nouvelle zone consultée', () => {
    const nicePlane = normalizeAircraft({ ...RAW, hex: '390001', lat: 43.66, lon: 7.21 }, NOW);
    const parisPlane = normalizeAircraft({ ...RAW, hex: '390002', lat: 49.01, lon: 2.55 }, NOW);
    const first = mergeFlights(new Map(), [nicePlane], { nowMs: NOW });
    const afterMoveToParis = mergeFlights(first.flights, [parisPlane], {
      nowMs: NOW + 5000,
      area: { lat: 49.01, lon: 2.55, radiusNm: 80 },
    });
    expect(afterMoveToParis.flights.has('390001')).toBe(false);
    expect(afterMoveToParis.flights.has('390002')).toBe(true);
  });
});

describe('géographie et mouvement', () => {
  it('calcule des distances en milles nautiques', () => {
    // Paris CDG → Nice ≈ 370 NM
    expect(distanceNm(49.0097, 2.5479, 43.6584, 7.2159)).toBeGreaterThan(355);
    expect(distanceNm(49.0097, 2.5479, 43.6584, 7.2159)).toBeLessThan(385);
  });

  it('calcule un point de destination cohérent', () => {
    const p = destinationPoint(45, 5, 90, 1852 * 60);
    expect(p.lat).toBeLessThan(45);
    expect(p.lon).toBeGreaterThan(6.3);
    const north = destinationPoint(0, 0, 0, 1852 * 60);
    expect(north.lat).toBeCloseTo(1, 1);
  });

  it('extrapole la position en limitant la durée', () => {
    const a = normalizeAircraft({ ...RAW, track: 0, gs: 360, geom_rate: 0, seen_pos: 0 }, NOW);
    const after10s = extrapolatePosition(a, NOW + 10_000, 45);
    // 360 kt = 0,1 NM/s → 1 NM en 10 s vers le nord.
    expect(distanceNm(a.lat, a.lon, after10s.lat, after10s.lon)).toBeCloseTo(1, 1);
    const after10min = extrapolatePosition(a, NOW + 600_000, 45);
    expect(distanceNm(a.lat, a.lon, after10min.lat, after10min.lon)).toBeCloseTo(4.5, 1);
  });

  it('n’extrapole pas un avion au sol immobile', () => {
    const a = normalizeAircraft({ ...RAW, alt_baro: 'ground', gs: 0 }, NOW);
    const p = extrapolatePosition(a, NOW + 20_000);
    expect(p.lat).toBe(a.lat);
    expect(p.lon).toBe(a.lon);
  });

  it('interpole positions et caps par le plus court chemin', () => {
    const mid = interpolatePositions({ lat: 0, lon: 179, altitudeM: 0 }, { lat: 0, lon: -179, altitudeM: 100 }, 0.5);
    expect(Math.abs(mid.lon)).toBeCloseTo(180, 5);
    expect(mid.altitudeM).toBeCloseTo(50);
    expect(interpolateHeading(350, 10, 0.5)).toBeCloseTo(0);
    expect(interpolateHeading(10, 350, 0.5)).toBeCloseTo(0);
  });

  it('adapte le rayon de requête à la hauteur de caméra', () => {
    expect(radiusForCameraHeight(10_000)).toBe(25);
    expect(radiusForCameraHeight(200_000)).toBe(97);
    expect(radiusForCameraHeight(20_000_000)).toBe(250);
  });

  it('détecte un changement significatif de zone', () => {
    const area = { lat: 45, lon: 5, radiusNm: 100 };
    expect(hasAreaChanged(null, area)).toBe(true);
    expect(hasAreaChanged(area, { lat: 45.1, lon: 5, radiusNm: 100 })).toBe(false);
    expect(hasAreaChanged(area, { lat: 47, lon: 5, radiusNm: 100 })).toBe(true);
    expect(hasAreaChanged(area, { lat: 45, lon: 5, radiusNm: 250 })).toBe(true);
  });
});

describe('recherche, filtres et tri', () => {
  const list = [
    normalizeAircraft({ ...RAW, hex: '3c0001', flight: 'DLH400', alt_baro: 30000, gs: 450 }, NOW),
    normalizeAircraft({ ...RAW, hex: '380001', flight: 'AFR1234', alt_baro: 38000, gs: 480 }, NOW),
    normalizeAircraft({ ...RAW, hex: '380002', flight: 'AFR77', alt_baro: 'ground', gs: 5 }, NOW),
    normalizeAircraft({ ...RAW, hex: '400001', flight: undefined, r: 'G-ABCD', alt_baro: 2000, gs: 100 }, NOW),
  ];

  it('filtre par texte (indicatif, immatriculation, hex)', () => {
    expect(filterAndSortFlights(list, { query: 'afr' }).map((a) => a.callsign)).toEqual(['AFR1234', 'AFR77']);
    expect(filterAndSortFlights(list, { query: 'g-ab' })).toHaveLength(1);
    expect(filterAndSortFlights(list, { query: '3c0001' })).toHaveLength(1);
  });

  it('filtre par préfixe d’indicatif et masque les avions au sol', () => {
    expect(filterAndSortFlights(list, { callsignPrefix: 'AFR', showGround: false }).map((a) => a.callsign)).toEqual(['AFR1234']);
  });

  it('trie par altitude, vitesse ou indicatif', () => {
    expect(filterAndSortFlights(list, { sortBy: 'altitude' })[0].callsign).toBe('AFR1234');
    expect(filterAndSortFlights(list, { sortBy: 'speed' }).at(-1).callsign).toBe('AFR77');
    // Les avions sans indicatif sont placés en fin de liste.
    expect(filterAndSortFlights(list, { sortBy: 'callsign' }).at(-1).callsign).toBeNull();
  });

  it('liste les préfixes de compagnies', () => {
    expect(callsignPrefixes(list)).toEqual(['AFR', 'DLH']);
  });
});

describe('mode démo', () => {
  it('produit des données clairement identifiées comme fictives', () => {
    const json = buildDemoResponse({ lat: 43.66, lon: 7.21, radiusNm: 250 }, NOW);
    const { aircraft } = normalizeResponse(json, NOW);
    expect(aircraft.length).toBeGreaterThan(5);
    for (const a of aircraft) {
      expect(a.callsign.startsWith('DEMO')).toBe(true);
      expect(a.id.startsWith('de')).toBe(true);
      expect(a.country).toBeNull();
    }
  });
});

