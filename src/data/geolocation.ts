// Browser geolocation helpers, ported unchanged from web/src/lib/geolocation.ts,
// plus a thin Promise wrapper around navigator.geolocation for this app's
// first-run "where are you?" flow.

export const GEO_UNSUPPORTED_MESSAGE = "Geolocation not supported on this device";
export const GEO_INSECURE_CONTEXT_MESSAGE =
  "Browsers block geolocation on plain HTTP - type a city, airport code, or lat,lon instead";

export type GeoAvailabilityReason = "unsupported" | "insecure-context";

export type GeoAvailability =
  | { ok: true }
  | { ok: false; reason: GeoAvailabilityReason; message: string };

export interface GeoAvailabilityInput {
  hasGeolocation: boolean;
  isSecureContext: boolean;
  hostname: string;
}

const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function geoAvailability({
  hasGeolocation,
  isSecureContext,
  hostname,
}: GeoAvailabilityInput): GeoAvailability {
  if (!isSecureContext && !isLocalHostname(hostname)) {
    return { ok: false, reason: "insecure-context", message: GEO_INSECURE_CONTEXT_MESSAGE };
  }
  if (!hasGeolocation) {
    return { ok: false, reason: "unsupported", message: GEO_UNSUPPORTED_MESSAGE };
  }
  return { ok: true };
}

export function geoErrorMessage(code: number, insecure: boolean): string {
  if (code === PERMISSION_DENIED && insecure) {
    return GEO_INSECURE_CONTEXT_MESSAGE;
  }
  if (code === PERMISSION_DENIED) {
    return "Location permission denied";
  }
  if (code === TIMEOUT) {
    return "Location request timed out";
  }
  return "Location unavailable";
}

export function browserGeoAvailability(): GeoAvailability {
  return geoAvailability({
    hasGeolocation: typeof navigator !== "undefined" && "geolocation" in navigator,
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    hostname: typeof window !== "undefined" ? window.location.hostname : "",
  });
}

/** Resolve the browser's current position, or reject with a human-readable message. */
export function getCurrentPosition(): Promise<{ lat: number; lon: number }> {
  const avail = browserGeoAvailability();
  if (!avail.ok) return Promise.reject(new Error(avail.message));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(geoErrorMessage(err.code, !window.isSecureContext))),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300_000 },
    );
  });
}
