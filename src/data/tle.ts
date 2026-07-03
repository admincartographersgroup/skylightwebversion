// Fetches satellite TLEs (Two-Line Elements) straight from Celestrak in the
// browser (it allows cross-origin requests) and caches them in localStorage
// so a reload doesn't re-fetch, and the display still has a sky if it loads
// offline. Ported from Skylight's server/src/tle.ts.

import type { Tle } from "../lib/celestial.js";

const URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle";
const CACHE_KEY = "skylight.tles.v1";
const TTL_MS = 24 * 3600_000;

interface CacheShape {
  at: number;
  tles: Tle[];
}

function readCache(): CacheShape | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CacheShape;
  } catch {
    return null;
  }
}

function writeCache(c: CacheShape): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage full or unavailable — the in-memory copy still works this session */
  }
}

function parseTle(text: string): Tle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length);
  const out: Tle[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("1 ") && lines[i + 1]?.startsWith("2 ")) {
      const name = (lines[i - 1] ?? "SAT").replace(/^0 /, "").trim();
      out.push({ name, line1: lines[i], line2: lines[i + 1] });
      i++;
    }
  }
  return out;
}

let memCache: CacheShape | null = null;
let inflight: Promise<Tle[]> | null = null;

/** Get the current TLE set, refreshing from Celestrak if the cache is stale. */
export async function getTles(): Promise<Tle[]> {
  if (!memCache) memCache = readCache();
  const fresh = memCache && Date.now() - memCache.at < TTL_MS;
  if (fresh) return memCache!.tles;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tles = parseTle(await res.text());
      if (tles.length) {
        memCache = { at: Date.now(), tles };
        writeCache(memCache);
      }
    } catch (err) {
      console.error("[tle] refresh failed (using cache):", err instanceof Error ? err.message : err);
    }
    return memCache?.tles ?? [];
  })();
  const result = await inflight;
  inflight = null;
  return result;
}
