// Airport lookup by ICAO/IATA code, backed by the OurAirports public-domain
// dataset (airports.csv + runways.csv), fetched straight from the browser
// (the dataset host allows cross-origin requests). Ported from Skylight's
// server/src/airports.ts. The two CSVs are a few MB each, so they're cached
// with the browser's Cache Storage API (not localStorage, which is far too
// small) for a month; a resolved airport lookup is also cached by code so
// repeat imports are instant.

import type { Airport, Runway } from "../lib/airport.js";

const BASE = "https://davidmegginson.github.io/ourairports-data";
const MAX_AGE_MS = 30 * 24 * 3600_000;
const CACHE_NAME = "skylight-ourairports-v1";
const FETCHED_AT_KEY = (name: string) => `skylight.ourairports.${name}.at`;
const RESOLVED_KEY = "skylight.airport.";

async function cachedCsv(name: string): Promise<string> {
  const freshAt = Number(localStorage.getItem(FETCHED_AT_KEY(name)) ?? 0);
  const fresh = Date.now() - freshAt < MAX_AGE_MS;

  if ("caches" in window) {
    const cache = await caches.open(CACHE_NAME);
    if (fresh) {
      const hit = await cache.match(name);
      if (hit) return hit.text();
    }
    try {
      const res = await fetch(`${BASE}/${name}`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await cache.put(name, res.clone());
      localStorage.setItem(FETCHED_AT_KEY(name), String(Date.now()));
      return res.text();
    } catch (e) {
      const stale = await cache.match(name);
      if (stale) return stale.text();
      throw new Error("airport database download failed — check your internet connection", { cause: e });
    }
  }

  // No Cache Storage (very old browser): fetch every time.
  const res = await fetch(`${BASE}/${name}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** One CSV line -> fields, honoring quotes ("a,b" stays one field). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Resolve an airport (with runway geometry) by ICAO ident ("KSFO", "EDDF")
 * or IATA code ("SFO"). Throws with a human-readable message on miss.
 */
export async function lookupAirport(code: string): Promise<Airport> {
  const q = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(q)) {
    throw new Error("enter an ICAO (KSFO) or IATA (SFO) airport code");
  }

  const cached = sessionStorage.getItem(RESOLVED_KEY + q);
  if (cached) return JSON.parse(cached) as Airport;

  const airportsCsv = await cachedCsv("airports.csv");
  const lines = airportsCsv.split("\n");
  const h = parseCsvLine(lines[0]);
  const cIdent = h.indexOf("ident");
  const cName = h.indexOf("name");
  const cLat = h.indexOf("latitude_deg");
  const cLon = h.indexOf("longitude_deg");
  const cIcao = h.indexOf("icao_code");
  const cIata = h.indexOf("iata_code");

  let row: string[] | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].includes(q)) continue; // cheap prefilter, ~80k rows
    const r = parseCsvLine(lines[i]);
    if (r[cIdent] === q) {
      row = r;
      break; // exact ident match always wins
    }
    if (!row && ((cIcao >= 0 && r[cIcao] === q) || (cIata >= 0 && r[cIata] === q))) {
      row = r;
    }
  }
  if (!row) throw new Error(`no airport found for "${q}"`);

  const ident = row[cIdent];
  const lat = parseFloat(row[cLat]);
  const lon = parseFloat(row[cLon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`${ident} has no coordinates in OurAirports`);
  }

  const runwaysCsv = await cachedCsv("runways.csv");
  const rl = runwaysCsv.split("\n");
  const rh = parseCsvLine(rl[0]);
  const col = (name: string) => rh.indexOf(name);
  const cAp = col("airport_ident");
  const cClosed = col("closed");
  const cWidth = col("width_ft");
  const cLeId = col("le_ident");
  const cLeLat = col("le_latitude_deg");
  const cLeLon = col("le_longitude_deg");
  const cHeId = col("he_ident");
  const cHeLat = col("he_latitude_deg");
  const cHeLon = col("he_longitude_deg");

  const runways: Runway[] = [];
  for (let i = 1; i < rl.length; i++) {
    if (!rl[i].includes(ident)) continue;
    const r = parseCsvLine(rl[i]);
    if (r[cAp] !== ident || r[cClosed] === "1") continue;
    const le: [number, number] = [parseFloat(r[cLeLat]), parseFloat(r[cLeLon])];
    const he: [number, number] = [parseFloat(r[cHeLat]), parseFloat(r[cHeLon])];
    if (!le.every(Number.isFinite) || !he.every(Number.isFinite)) continue;
    runways.push({
      leIdent: r[cLeId] || "?",
      heIdent: r[cHeId] || "?",
      le,
      he,
      widthFt: parseFloat(r[cWidth]) || 100,
    });
  }
  if (!runways.length) {
    throw new Error(
      `OurAirports has no runway endpoint coordinates for ${ident} — ` +
        "smaller airfields often lack them",
    );
  }

  const iata = cIata >= 0 ? row[cIata] : "";
  const airport: Airport = { icao: ident, name: iata || ident, fullName: row[cName], lat, lon, runways };
  try {
    sessionStorage.setItem(RESOLVED_KEY + q, JSON.stringify(airport));
  } catch {
    /* storage full — not fatal, just re-parses next time */
  }
  return airport;
}
