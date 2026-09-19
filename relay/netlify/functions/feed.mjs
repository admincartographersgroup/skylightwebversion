// Skylight flight-feed relay — a tiny Netlify Function.
//
// Why it exists: the free community ADS-B feeds (adsb.lol, adsb.fi) return
// good data but don't send CORS headers, so a browser on another website can't
// read them directly. (They also refuse Cloudflare Workers' shared addresses,
// which is why this runs on Netlify instead.) This function fetches the feed
// server-side and returns it with the header browsers need. It stores nothing.
//
// Usage:  GET https://<site>.netlify.app/feed?lat=37.62&lon=-122.38&dist=4
//         (dist = radius in nautical miles, 1-250)

// Only these sites may use the relay (protects the function quota).
const ALLOWED_ORIGINS = [
  "https://skylight.bradenframe.com",
  "https://admincartographersgroup.github.io",
];
// Local dev (npm run dev) on any port.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/;

// Tried in order; the first that answers wins.
const UPSTREAMS = [
  (lat, lon, d) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${d}`,
  (lat, lon, d) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${d}`,
];

// Identify ourselves to the volunteer-run feeds.
const UA = "skylight-web-proxy (+https://github.com/admincartographersgroup/skylightwebversion)";

const originAllowed = (o) => !o || ALLOWED_ORIGINS.includes(o) || LOCAL_ORIGIN.test(o);

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const json = (body, status, origin, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin), ...extra },
  });

export default async (request) => {
  const origin = request.headers.get("origin");
  if (!originAllowed(origin)) return json({ error: "origin not allowed" }, 403, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "GET") return json({ error: "GET only" }, 405, origin);

  const p = new URL(request.url).searchParams;
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  const dist = Number(p.get("dist") ?? 5);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(dist) ||
    Math.abs(lat) > 90 || Math.abs(lon) > 180 || dist < 1 || dist > 250
  ) {
    return json({ error: "need numeric lat (-90..90), lon (-180..180), dist (1..250 nm)" }, 400, origin);
  }

  // Round the centre (~1 km) so nearby viewers share one cached upstream
  // answer, and pad the radius to cover the rounding. The app trims to its
  // exact centre/radius itself.
  const rLat = lat.toFixed(2);
  const rLon = lon.toFixed(2);
  const rDist = Math.min(250, Math.ceil(dist) + 1);

  const errors = [];
  for (const build of UPSTREAMS) {
    const url = build(rLat, rLon, rDist);
    const host = new URL(url).host;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) {
        errors.push(`${host}: HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      JSON.parse(body); // reject HTML error pages served with a 200
      return new Response(body, {
        headers: {
          "Content-Type": "application/json",
          // Let Netlify's CDN share one answer between nearby viewers for 3s.
          "Netlify-CDN-Cache-Control": "public, s-maxage=3",
          "Cache-Control": "public, max-age=0",
          "X-Feed": host,
          ...corsHeaders(origin),
        },
      });
    } catch (e) {
      errors.push(`${host}: ${e && e.message ? e.message : "failed"}`);
    }
  }
  return json({ error: "all upstream feeds failed", details: errors }, 502, origin);
};

export const config = { path: "/feed" };
