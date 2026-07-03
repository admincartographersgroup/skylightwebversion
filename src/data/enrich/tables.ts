// Static, instant enrichment from bundled tables, ported unchanged from
// server/src/enrich/tables.ts. adsbdb (../routes.ts) layers on top for
// anything these miss.

// Plain JSON imports (no import-attribute syntax) — Vite bundles these
// directly, unlike the Node ESM loader the original server code targeted.
import airlines from "./airlines.json";
import types from "./types.json";

const AIRLINES = airlines as Record<string, string>;
const TYPES = types as Record<string, string>;

/** Map an ICAO type code (e.g. "B738") to a human name. */
export function lookupType(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return TYPES[code.toUpperCase()];
}

/**
 * Map a callsign to an airline name via its 3-letter ICAO prefix.
 * Only airline-style callsigns resolve; GA tail numbers (e.g. "N123AB") won't.
 */
export function lookupAirline(callsign: string | undefined): string | undefined {
  if (!callsign) return undefined;
  const cs = callsign.trim().toUpperCase();
  if (cs.length < 4) return undefined;
  const prefix = cs.slice(0, 3);
  // Airline callsigns are LLLdddd: 3 letters then a digit.
  if (!/^[A-Z]{3}$/.test(prefix) || !/\d/.test(cs[3])) return undefined;
  return AIRLINES[prefix];
}
