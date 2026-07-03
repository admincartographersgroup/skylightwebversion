// Live aircraft feed, polled directly from the browser against the free
// airplanes.live API (it allows cross-origin requests, so no backend proxy
// is needed). Adapted from Skylight's server/src/datasource.ts: the radio
// (dump1090) path and the radio+API merge are dropped since this build has
// no local ADS-B receiver — every visitor's browser is its own independent
// client of the public API, centered on their own location.

import type { Aircraft } from "../lib/aircraft.js";
import type { Config } from "../lib/config.js";
import { llToMeters, metersToMiles, rangeMeters } from "../lib/geo.js";
import { lookupAirline, lookupType } from "./enrich/tables.js";
import { enrichSync, pruneEnrichCache } from "./enrich/routes.js";

/** Raw readsb-style aircraft record (subset we use) — airplanes.live's shape. */
interface RawAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  squawk?: string;
  category?: string;
  r?: string;
  t?: string;
  seen?: number;
  rssi?: number;
}

const API_URL_TEMPLATE = "https://api.airplanes.live/v2/point/{lat}/{lon}/{r}";
const NM_PER_MILE = 0.868976;
/** How often to poll. Every browser tab polls independently, so this stays
 *  gentle on the shared free API — still feels live. */
const POLL_MS = 3000;
/** Hold off after an HTTP 429 — hammering through a rate limit just extends it. */
const RATE_LIMIT_BACKOFF_MS = 15_000;

function normalize(raw: RawAircraft, ts: number): Aircraft | null {
  if (!raw.hex) return null;
  const onGround = raw.alt_baro === "ground";
  return {
    hex: raw.hex,
    flight: raw.flight?.trim() || undefined,
    lat: raw.lat,
    lon: raw.lon,
    altBaro: onGround ? null : (raw.alt_baro as number | undefined) ?? null,
    altGeom: raw.alt_geom ?? null,
    gs: raw.gs,
    track: raw.track,
    baroRate: raw.baro_rate ?? null,
    squawk: raw.squawk,
    category: raw.category,
    onGround,
    registration: raw.r,
    typeCode: raw.t,
    seen: raw.seen,
    rssi: raw.rssi,
    ts,
  };
}

function describeFetchError(e: unknown): string {
  if (e instanceof DOMException && e.name === "TimeoutError") return "timeout after 5s";
  if (e instanceof Error) {
    if (e.name === "AbortError") return "timeout after 5s";
    if (e.message === "Failed to fetch") return "network error (offline or blocked)";
    return e.message || "fetch failed";
  }
  return "fetch failed";
}

export interface SourceStatus {
  ok: boolean;
  count: number;
  lastOk: number | null;
  message?: string;
}

interface StickyEnrichment {
  typeName?: string;
  airline?: string;
  origin?: string;
  destination?: string;
  registration?: string;
  originName?: string;
  destName?: string;
  originLat?: number;
  originLon?: number;
  destLat?: number;
  destLon?: number;
  lastSeen: number;
}

export interface AircraftSourceOptions {
  getConfig: () => Config;
  onSnapshot: (now: number, aircraft: Aircraft[]) => void;
  onStatus: (status: SourceStatus) => void;
}

export class AircraftSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: SourceStatus = { ok: false, count: 0, lastOk: null };
  private sticky = new Map<string, StickyEnrichment>();
  private lastError: string | null = null;
  private apiBackoffUntil = 0;

  constructor(private o: AircraftSourceOptions) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    setInterval(() => pruneEnrichCache(), 3600_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private buildUrl(): string {
    const c = this.o.getConfig();
    const r = Math.min(250, Math.ceil(c.radiusMiles * NM_PER_MILE) + 1);
    return API_URL_TEMPLATE.replace("{lat}", String(c.centerLat))
      .replace("{lon}", String(c.centerLon))
      .replace("{r}", String(r));
  }

  private withinRadius(list: Aircraft[]): Aircraft[] {
    const c = this.o.getConfig();
    const maxMi = c.radiusMiles * 1.08;
    return list.filter((ac) => {
      if (ac.lat == null || ac.lon == null) return true;
      const mi = metersToMiles(rangeMeters(llToMeters(ac.lat, ac.lon, c.centerLat, c.centerLon)));
      return mi <= maxMi;
    });
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    if (now < this.apiBackoffUntil) {
      const waitS = Math.ceil((this.apiBackoffUntil - now) / 1000);
      this.status = { ...this.status, ok: false, message: `API rate limited — retrying in ${waitS}s` };
      this.o.onStatus(this.status);
      return;
    }

    const url = this.buildUrl();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        if (res.status === 429) this.apiBackoffUntil = now + RATE_LIMIT_BACKOFF_MS;
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const rawList: RawAircraft[] = json.aircraft ?? json.ac ?? [];
      const list: Aircraft[] = [];
      for (const raw of rawList) {
        const ac = normalize(raw, now);
        if (ac) list.push(ac);
      }
      const trimmed = this.withinRadius(list);
      for (const ac of trimmed) this.enrich(ac, now);
      this.pruneSticky(now);

      this.status = { ok: true, count: trimmed.length, lastOk: now };
      this.o.onSnapshot(now, trimmed);
      this.o.onStatus(this.status);
    } catch (e) {
      const reason = describeFetchError(e);
      this.lastError = `source fetch failed: ${reason}`;
      this.status = { ...this.status, ok: false, message: this.lastError };
      this.o.onStatus(this.status);
    }
  }

  private enrich(ac: Aircraft, now: number): void {
    ac.typeName = lookupType(ac.typeCode);
    ac.airline = lookupAirline(ac.flight);

    const e = enrichSync(ac.hex, ac.flight, now);
    if (e.route) {
      ac.airline = ac.airline ?? e.route.airline;
      ac.origin = e.route.origin ?? ac.origin;
      ac.destination = e.route.destination ?? ac.destination;
      ac.originName = e.route.originName ?? ac.originName;
      ac.destName = e.route.destName ?? ac.destName;
      ac.originLat = e.route.originLat ?? ac.originLat;
      ac.originLon = e.route.originLon ?? ac.originLon;
      ac.destLat = e.route.destLat ?? ac.destLat;
      ac.destLon = e.route.destLon ?? ac.destLon;
    }
    if (e.aircraft) {
      ac.typeName = ac.typeName ?? e.aircraft.typeName;
      ac.registration = ac.registration ?? e.aircraft.registration;
    }

    // Sticky merge: once we've resolved something for this hex, never drop it
    // back to undefined on a later snapshot (prevents label flicker).
    const prev = this.sticky.get(ac.hex);
    ac.typeName = ac.typeName ?? prev?.typeName;
    ac.airline = ac.airline ?? prev?.airline;
    ac.origin = ac.origin ?? prev?.origin;
    ac.destination = ac.destination ?? prev?.destination;
    ac.registration = ac.registration ?? prev?.registration;
    ac.originName = ac.originName ?? prev?.originName;
    ac.destName = ac.destName ?? prev?.destName;
    ac.originLat = ac.originLat ?? prev?.originLat;
    ac.originLon = ac.originLon ?? prev?.originLon;
    ac.destLat = ac.destLat ?? prev?.destLat;
    ac.destLon = ac.destLon ?? prev?.destLon;
    this.sticky.set(ac.hex, {
      typeName: ac.typeName,
      airline: ac.airline,
      origin: ac.origin,
      destination: ac.destination,
      registration: ac.registration,
      originName: ac.originName,
      destName: ac.destName,
      originLat: ac.originLat,
      originLon: ac.originLon,
      destLat: ac.destLat,
      destLon: ac.destLon,
      lastSeen: now,
    });
  }

  private pruneSticky(now: number): void {
    for (const [hex, s] of this.sticky) {
      if (now - s.lastSeen > 600_000) this.sticky.delete(hex);
    }
  }
}
