/**
 * Jeu de données de DÉMONSTRATION (fictif).
 *
 * Utilisé uniquement lorsque l'utilisateur active explicitement le mode démo
 * (tests, API indisponible, blocage CORS). Les indicatifs commencent par "DEMO"
 * et les adresses OACI par "de" pour ne jamais être confondus avec des vols réels.
 *
 * Les objets ont le même format qu'une réponse ADSB.fi v3 : ils passent donc
 * par la même normalisation que les vraies données.
 */
import { destinationPoint, distanceNm, normalizeResponse } from '../utils/flightUtils.js';

/** Trajectoires fictives définies autour d'un point de référence (décalage en NM, cap, vitesse, altitude). */
const DEMO_TRACKS = [
  { n: 1, bearing: 20, dist: 40, track: 35, gs: 450, alt: 36000, t: 'A320', cat: 'A3' },
  { n: 2, bearing: 110, dist: 70, track: 250, gs: 470, alt: 38000, t: 'B738', cat: 'A3' },
  { n: 3, bearing: 200, dist: 25, track: 180, gs: 300, alt: 14000, t: 'A21N', cat: 'A3' },
  { n: 4, bearing: 300, dist: 90, track: 95, gs: 480, alt: 39000, t: 'B77W', cat: 'A5' },
  { n: 5, bearing: 60, dist: 120, track: 300, gs: 430, alt: 34000, t: 'A333', cat: 'A5' },
  { n: 6, bearing: 160, dist: 150, track: 10, gs: 460, alt: 37000, t: 'A359', cat: 'A5' },
  { n: 7, bearing: 250, dist: 60, track: 60, gs: 250, alt: 9000, t: 'E190', cat: 'A3' },
  { n: 8, bearing: 340, dist: 30, track: 210, gs: 120, alt: 3500, t: 'C172', cat: 'A1' },
  { n: 9, bearing: 80, dist: 15, track: 140, gs: 110, alt: 1500, t: 'EC35', cat: 'A7' },
  { n: 10, bearing: 230, dist: 180, track: 330, gs: 490, alt: 41000, t: 'B789', cat: 'A5' },
  { n: 11, bearing: 10, dist: 200, track: 170, gs: 440, alt: 35000, t: 'A20N', cat: 'A3' },
  { n: 12, bearing: 130, dist: 5, track: 45, gs: 0, alt: 'ground', t: 'A319', cat: 'A3' },
];

/** Durée d'un cycle : les avions reviennent à leur point de départ pour rester dans la zone. */
const LOOP_S = 20 * 60;

/**
 * Génère une réponse fictive au format ADSB.fi autour du centre demandé.
 * @param {{ lat: number, lon: number, radiusNm: number }} area
 * @param {number} nowMs
 */
export function buildDemoResponse(area, nowMs) {
  const elapsedS = (nowMs / 1000) % LOOP_S;
  const ac = DEMO_TRACKS.map((track) => {
    const start = destinationPoint(area.lat, area.lon, track.bearing, track.dist * 1852);
    const speedMs = (track.gs * 1852) / 3600;
    // Aller-retour : l'avion fait demi-tour à mi-cycle.
    const outbound = elapsedS < LOOP_S / 2;
    const travelS = outbound ? elapsedS : LOOP_S - elapsedS;
    const pos = destinationPoint(start.lat, start.lon, track.track, speedMs * travelS);
    return {
      hex: `de${String(track.n).padStart(4, '0')}`,
      type: 'demo',
      flight: `DEMO${String(track.n).padStart(2, '0')}  `,
      r: `DEMO-${track.n}`,
      t: track.t,
      desc: 'Appareil fictif (mode démo)',
      category: track.cat,
      alt_baro: track.alt,
      alt_geom: typeof track.alt === 'number' ? track.alt + 600 : undefined,
      gs: track.gs,
      track: outbound ? track.track : (track.track + 180) % 360,
      lat: pos.lat,
      lon: pos.lon,
      seen: 0.5,
      seen_pos: 0.8,
    };
  }).filter((a) => distanceNm(area.lat, area.lon, a.lat, a.lon) <= Math.max(area.radiusNm, 60));

  return { ac, msg: 'demo', now: nowMs, total: ac.length };
}

/** Source de données fictive ayant la même interface que le client ADSB.fi. */
export function createDemoClient({ now = () => Date.now() } = {}) {
  const respond = async (area) => {
    const receivedAtMs = now();
    const result = normalizeResponse(buildDemoResponse(area, receivedAtMs), receivedAtMs);
    return { ...result, receivedAtMs, source: 'demo' };
  };
  return {
    baseUrl: 'demo://local',
    fetchAircraftInArea: (area) => respond(area),
    async fetchByCallsign(callsign) {
      const result = await respond({ lat: 43.66, lon: 7.21, radiusNm: 250 });
      const value = String(callsign).trim().toUpperCase();
      return { ...result, aircraft: result.aircraft.filter((a) => a.callsign?.includes(value)) };
    },
    async fetchByHex() {
      return { aircraft: [], rejected: 0, receivedAtMs: now(), source: 'demo' };
    },
  };
}

