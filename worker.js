// Optional Cloudflare Worker proxy.
//
//   npx wrangler deploy worker.js --name sankatsathi-proxy
//   then set PROXY in public/js/config.js to https://<name>.<you>.workers.dev/?url=
//
// REQUIRED for one source, optional for the rest. BIPAD, GDACS and Open-Meteo
// were all verified on 30 Aug 2026 to return `Access-Control-Allow-Origin: *`,
// so the site calls them directly. Copernicus EMS Rapid Mapping returns no such
// header at all, so a browser cannot read it without this proxy — without one
// deployed the app falls back to its build-time snapshot and says so.
//
// Beyond that one source, this exists for the two things CORS does not solve:
//
//   1. Caching. BIPAD has no SLA and no rate limit published. A 120-second edge
//      cache means a demo audience hitting refresh doesn't hammer a government
//      server that is, at that moment, being used to coordinate a flood response.
//   2. Mixed content. DHM station photos are served over plain http://, which an
//      https:// page cannot load. Streaming them through here upgrades the hop.

const ALLOWED = new Set([
  "bipadportal.gov.np",
  "www.gdacs.org",
  "flood-api.open-meteo.com",
  "rapidmapping.emergency.copernicus.eu",   // sends no CORS header at all
  "overpass-api.de",
  "nominatim.openstreetmap.org",
  "daq.hydrology.gov.np",     // http-only station photos
  "navigate.dor.gov.np",      // Department of Roads photos
]);

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: cors() });
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("Missing ?url=", { status: 400, headers: cors() });

    let t;
    try {
      t = new URL(target);
    } catch {
      return new Response("Bad url", { status: 400, headers: cors() });
    }

    // The allowlist is not optional. An open ?url= proxy is found and abused
    // within days — it becomes someone else's anonymiser and the account goes.
    if (!ALLOWED.has(t.hostname)) {
      return new Response(`Host not allowed: ${t.hostname}`, { status: 403, headers: cors() });
    }
    if (t.protocol !== "https:" && t.protocol !== "http:") {
      return new Response("Bad scheme", { status: 400, headers: cors() });
    }

    let upstream;
    try {
      upstream = await fetch(t.toString(), {
        headers: {
          "User-Agent": "SankatSathi/1.0 (+https://sankatsathi.pages.dev)",
          Accept: request.headers.get("Accept") ?? "application/json",
        },
        cf: { cacheTtl: 120, cacheEverything: true },
      });
    } catch (err) {
      return new Response(`Upstream unreachable: ${err.message}`, { status: 502, headers: cors() });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors(),
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "public, max-age=120",
      },
    });
  },
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
