// First-run "where are you?" screen. Every visitor gets this once (per
// browser) so the display centers on THEIR sky, not a default airport.

import { useState } from "react";
import { resolveLocation } from "../data/geocode.js";
import { getCurrentPosition, browserGeoAvailability } from "../data/geolocation.js";

export function LocationOnboarding({
  onResolved,
}: {
  onResolved: (lat: number, lon: number, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const geoAvail = browserGeoAvailability();

  async function useCurrent() {
    setBusy(true);
    setError(null);
    try {
      const pos = await getCurrentPosition();
      onResolved(pos.lat, pos.lon, "My location");
    } catch (e) {
      setError(e instanceof Error ? e.message : "location unavailable");
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const hit = await resolveLocation(query);
      if (!hit) {
        setError(`no match for "${query}"`);
        return;
      }
      onResolved(hit.lat, hit.lon, hit.name);
    } catch {
      setError("search failed — check your connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onboard-root">
      <div className="onboard-card">
        <h1 className="onboard-title">Where are you looking up from?</h1>
        <p className="onboard-sub">
          Skylight shows the aircraft currently overhead your location. Share your
          position, or type a city, airport code, or coordinates — you can change
          this any time from the settings drawer.
        </p>
        {geoAvail.ok ? (
          <button type="button" className="onboard-btn" disabled={busy} onClick={() => void useCurrent()}>
            📍 Use my current location
          </button>
        ) : (
          <p className="onboard-error">{geoAvail.message}</p>
        )}
        <div className="onboard-or">or</div>
        <div className="onboard-search">
          <input
            type="text"
            value={query}
            placeholder="e.g. SFO, San Francisco, or 37.62,-122.38"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
          <button type="button" className="onboard-btn secondary" style={{ width: "auto" }} disabled={busy} onClick={() => void search()}>
            Go
          </button>
        </div>
        {error && <p className="onboard-error">{error}</p>}
      </div>
    </div>
  );
}
