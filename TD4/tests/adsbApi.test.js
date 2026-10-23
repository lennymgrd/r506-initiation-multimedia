import { describe, expect, it, vi } from 'vitest';
import { createAdsbClient, FlightApiError } from '../src/services/adsbApi.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('client ADSB.fi', () => {
  it('construit l’URL documentée /v3/lat/{lat}/lon/{lon}/dist/{dist}', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ac: [{ hex: '3c54a5', lat: 43.9, lon: 6.2, seen_pos: 1 }], now: 1, total: 1 }));
    const client = createAdsbClient({ baseUrl: 'https://opendata.adsb.fi/api/', fetchImpl, minIntervalMs: 0 });
    const result = await client.fetchAircraftInArea({ lat: 43.7, lon: 7.3, radiusNm: 400 });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://opendata.adsb.fi/api/v3/lat/43.7000/lon/7.3000/dist/250');
    expect(result.aircraft).toHaveLength(1);
    expect(result.source).toBe('live');
  });

  it('signale une erreur 429 de manière explicite', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429, { 'Retry-After': '20' }));
    const client = createAdsbClient({ baseUrl: '/adsb-api', fetchImpl, minIntervalMs: 0 });
    const error = await client.fetchAircraftInArea({ lat: 0.5, lon: 0.5, radiusNm: 50 }).catch((e) => e);
    expect(error).toBeInstanceOf(FlightApiError);
    expect(error.kind).toBe('rate-limit');
    expect(error.retryAfterS).toBe(20);
  });

  it('signale une erreur HTTP et un JSON invalide', async () => {
    const http = createAdsbClient({ baseUrl: '/x', fetchImpl: async () => jsonResponse({}, 503), minIntervalMs: 0 });
    expect((await http.fetchAircraftInArea({ lat: 1, lon: 1, radiusNm: 10 }).catch((e) => e)).kind).toBe('http');
    const bad = createAdsbClient({ baseUrl: '/x', fetchImpl: async () => new Response('<html>', { status: 200 }), minIntervalMs: 0 });
    expect((await bad.fetchAircraftInArea({ lat: 1, lon: 1, radiusNm: 10 }).catch((e) => e)).kind).toBe('invalid');
  });

  it('refuse un indicatif invalide sans appeler le réseau', async () => {
    const fetchImpl = vi.fn();
    const client = createAdsbClient({ baseUrl: '/x', fetchImpl, minIntervalMs: 0 });
    const error = await client.fetchByCallsign('a b/c').catch((e) => e);
    expect(error.kind).toBe('invalid');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('espace les requêtes pour respecter la limite de 1 requête/seconde', async () => {
    const times = [];
    const fetchImpl = vi.fn(async () => {
      times.push(Date.now());
      return jsonResponse({ ac: [], now: 1, total: 0 });
    });
    const client = createAdsbClient({ baseUrl: '/x', fetchImpl, minIntervalMs: 200 });
    await Promise.all([
      client.fetchByCallsign('AFR1'),
      client.fetchByCallsign('AFR2'),
      client.fetchByCallsign('AFR3'),
    ]);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(190);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(190);
  });
});

