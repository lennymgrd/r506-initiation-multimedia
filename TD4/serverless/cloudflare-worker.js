/**
 * Relais serverless minimal (Cloudflare Worker gratuit) pour ADSB.fi.
 *
 * Pourquoi ce fichier existe-t-il ?
 * L'API ouverte https://opendata.adsb.fi/api/ fonctionne en accès direct HTTP GET,
 * mais ses réponses ne comportent pas l'en-tête `Access-Control-Allow-Origin`.
 * Lorsqu'une page hébergée sur GitHub Pages (`https://utilisateur.github.io`)
 * appelle directement `https://opendata.adsb.fi`, le navigateur bloque la lecture
 * de la réponse par sécurité (politique Same-Origin / CORS).
 *
 * En développement local (`npm run dev`), le serveur Vite relaie `/adsb-api/*`.
 * Pour un déploiement statique sur GitHub Pages, cette fonction serverless de
 * quelques lignes relaie uniquement les endpoints GET autorisés et ajoute l'en-tête
 * CORS pour votre domaine GitHub Pages.
 */

const UPSTREAM_ORIGIN = 'https://opendata.adsb.fi/api';
const ALLOWED_PATH = /^\/(v3\/lat\/-?\d+(?:\.\d+)?\/lon\/-?\d+(?:\.\d+)?\/dist\/\d+|v2\/(?:callsign|hex|icao)\/[A-Za-z0-9~]+)$/;

export default {
  async fetch(request, env) {
    const allowedOrigin = env?.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (!ALLOWED_PATH.test(url.pathname)) {
      return new Response('Forbidden endpoint', { status: 403, headers: corsHeaders });
    }

    const upstreamResponse = await fetch(`${UPSTREAM_ORIGIN}${url.pathname}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'FlightExplorer3D-BUT3/1.0' },
    });

    const headers = new Headers(upstreamResponse.headers);
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    });
  },
};

