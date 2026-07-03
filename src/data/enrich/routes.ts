// adsbdb.com enrichment: callsign -> route (origin/dest + airline) and
// hex -> aircraft type/registration. Fetched straight from the browser
// (adsbdb allows cross-origin requests) and cached in localStorage so a
// reload doesn't re-hammer the free API. One request per new key. Ported
// from server/src/enrich/routes.ts.

const API = "https://api.adsbdb.com/v0";
const CACHE_KEY = "skylight.enrichCache.v1";
const TTL_MS = 12 * 3600_000;
/** Drop entries this stale so the cache doesn't grow forever across many
 *  different aircraft over weeks of use. */
const EVICT_MS = TTL_MS * 6;

interface RouteInfo {
  airline?: string;
  origin?: string;
  destination?: string;
  originName?: string;
  destName?: string;
  originLat?: number;
  originLon?: number;
  destLat?: number;
  destLon?: number;
}
interface AircraftInfo {
  typeName?: string;
  registration?: string;
}
interface CacheEntry<T> {
  data: T | null; // null = looked up, not found (negative cache)
  at: number; // ms epoch
}
interface CacheShape {
  routes: Record<string, CacheEntry<RouteInfo>>;
  aircraft: Record<string, CacheEntry<AircraftInfo>>;
}

function loadCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CacheShape>;
      return { routes: parsed.routes ?? {}, aircraft: parsed.aircraft ?? {} };
    }
  } catch {
    /* first run or corrupt cache */
  }
  return { routes: {}, aircraft: {} };
}

const cache: CacheShape = loadCache();
const inflight = new Map<string, Promise<void>>();
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* storage full — the in-memory cache still works this session */
    }
  }, 3000);
}

function fresh<T>(e: CacheEntry<T> | undefined, now: number): boolean {
  return !!e && now - e.at < TTL_MS;
}

/** Synchronous read of whatever is cached; kicks off a fetch if missing. */
export function enrichSync(
  hex: string,
  callsign: string | undefined,
  now: number,
): { route?: RouteInfo; aircraft?: AircraftInfo } {
  const out: { route?: RouteInfo; aircraft?: AircraftInfo } = {};

  const ac = cache.aircraft[hex];
  if (fresh(ac, now)) out.aircraft = ac!.data ?? undefined;
  else fetchAircraft(hex);

  if (callsign) {
    const cs = callsign.trim().toUpperCase();
    const r = cache.routes[cs];
    if (fresh(r, now)) out.route = r!.data ?? undefined;
    else fetchRoute(cs);
  }
  return out;
}

function fetchRoute(cs: string): void {
  const key = "r:" + cs;
  if (inflight.has(key)) return;
  const p = (async () => {
    try {
      const res = await fetch(`${API}/callsign/${encodeURIComponent(cs)}`, {
        signal: AbortSignal.timeout(8000),
      });
      let data: RouteInfo | null = null;
      if (res.ok) {
        const json: any = await res.json();
        const fr = json?.response?.flightroute;
        if (fr) {
          data = {
            airline: fr.airline?.name,
            origin: fr.origin?.iata_code ?? fr.origin?.icao_code,
            destination: fr.destination?.iata_code ?? fr.destination?.icao_code,
            originName: fr.origin?.municipality,
            destName: fr.destination?.municipality,
            originLat: fr.origin?.latitude,
            originLon: fr.origin?.longitude,
            destLat: fr.destination?.latitude,
            destLon: fr.destination?.longitude,
          };
        }
      }
      cache.routes[cs] = { data, at: Date.now() };
      scheduleSave();
    } catch {
      // leave uncached so we retry later
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
}

function fetchAircraft(hex: string): void {
  const key = "a:" + hex;
  if (inflight.has(key)) return;
  const p = (async () => {
    try {
      const res = await fetch(`${API}/aircraft/${encodeURIComponent(hex)}`, {
        signal: AbortSignal.timeout(8000),
      });
      let data: AircraftInfo | null = null;
      if (res.ok) {
        const json: any = await res.json();
        const a = json?.response?.aircraft;
        if (a) {
          data = {
            typeName: a.manufacturer && a.type ? `${a.manufacturer} ${a.type}` : a.type,
            registration: a.registration,
          };
        }
      }
      cache.aircraft[hex] = { data, at: Date.now() };
      scheduleSave();
    } catch {
      // retry later
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
}

/** Drop cache entries old enough that we'd rather re-fetch than keep them. */
export function pruneEnrichCache(): void {
  const now = Date.now();
  let changed = false;
  for (const [k, e] of Object.entries(cache.routes)) {
    if (now - e.at > EVICT_MS) {
      delete cache.routes[k];
      changed = true;
    }
  }
  for (const [k, e] of Object.entries(cache.aircraft)) {
    if (now - e.at > EVICT_MS) {
      delete cache.aircraft[k];
      changed = true;
    }
  }
  if (changed) scheduleSave();
}
