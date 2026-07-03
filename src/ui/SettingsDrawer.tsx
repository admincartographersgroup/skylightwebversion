// The on-screen settings drawer — everything the phone control panel used to
// do, now built into the display page itself (no second device, no server).
// Toggle with the corner tab or the "s" key; settings persist to this
// browser's localStorage only.

import { useState } from "react";
import type { Config, LocationProfile } from "../lib/config.js";
import { formatLatLon } from "../lib/geo.js";
import { resolveLocation } from "../data/geocode.js";
import { getCurrentPosition, browserGeoAvailability } from "../data/geolocation.js";
import { lookupAirport } from "../data/airports.js";
import { markLocationSet } from "../data/configStore.js";
import type { SourceStatus } from "../data/aircraftSource.js";
import { Section, Row, Toggle, Slider, TextInput, Segmented, ColorRow } from "./controls.js";

export function SettingsDrawer({
  config,
  patch,
  reset,
  open,
  onClose,
  status,
}: {
  config: Config;
  patch: (p: Partial<Config>) => void;
  reset: () => void;
  open: boolean;
  onClose: () => void;
  status: SourceStatus | null;
}) {
  const [locQuery, setLocQuery] = useState("");
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [airportQuery, setAirportQuery] = useState("");
  const [airportBusy, setAirportBusy] = useState(false);
  const [airportError, setAirportError] = useState<string | null>(null);

  const geoAvail = browserGeoAvailability();

  async function searchLocation(q: string) {
    if (!q.trim()) return;
    setLocBusy(true);
    setLocError(null);
    try {
      const hit = await resolveLocation(q);
      if (!hit) {
        setLocError(`no match for "${q}"`);
        return;
      }
      patch({ centerLat: hit.lat, centerLon: hit.lon, locationName: hit.name });
      markLocationSet();
      setLocQuery("");
    } catch {
      setLocError("location search failed — check your connection");
    } finally {
      setLocBusy(false);
    }
  }

  async function useCurrentLocation() {
    setLocBusy(true);
    setLocError(null);
    try {
      const pos = await getCurrentPosition();
      patch({ centerLat: pos.lat, centerLon: pos.lon, locationName: "My location" });
      markLocationSet();
    } catch (e) {
      setLocError(e instanceof Error ? e.message : "location unavailable");
    } finally {
      setLocBusy(false);
    }
  }

  function saveCurrentProfile() {
    const profile: LocationProfile = {
      id: `${Date.now()}`,
      name: config.locationName,
      lat: config.centerLat,
      lon: config.centerLon,
      radiusMiles: config.radiusMiles,
    };
    patch({ locationProfiles: [...config.locationProfiles, profile] });
  }

  function jumpToProfile(p: LocationProfile) {
    patch({ centerLat: p.lat, centerLon: p.lon, radiusMiles: p.radiusMiles, locationName: p.name });
  }

  function deleteProfile(id: string) {
    patch({ locationProfiles: config.locationProfiles.filter((p) => p.id !== id) });
  }

  async function importAirport(code: string) {
    if (!code.trim()) return;
    setAirportBusy(true);
    setAirportError(null);
    try {
      const airport = await lookupAirport(code);
      patch({ airport, showAirport: true });
      setAirportQuery("");
    } catch (e) {
      setAirportError(e instanceof Error ? e.message : "import failed");
    } finally {
      setAirportBusy(false);
    }
  }

  return (
    <div className={`drawer-root ${open ? "open" : ""}`}>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer-panel">
        <div className="drawer-topbar">
          <div className="drawer-brand">Skylight</div>
          <div className="drawer-stat">
            {status?.ok ? `${status.count} aircraft` : (status?.message ?? "connecting…")}
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="drawer-main">
          <Section title="Location">
            <div className="loc-bar">
              <TextInput
                value={locQuery}
                onCommit={(v) => {
                  setLocQuery(v);
                  if (v) void searchLocation(v);
                }}
                placeholder="City, airport code, or lat,lon"
                ariaLabel="Search location"
              />
              <button type="button" className="loc-btn" disabled={locBusy} onClick={() => void searchLocation(locQuery)}>
                Search
              </button>
            </div>
            {geoAvail.ok && (
              <div className="loc-bar">
                <button type="button" className="loc-btn" style={{ flex: 1 }} disabled={locBusy} onClick={() => void useCurrentLocation()}>
                  📍 Use my current location
                </button>
              </div>
            )}
            {locError && <div className="loc-error">{locError}</div>}
            <div className="loc-current">
              {config.locationName} · {formatLatLon(config.centerLat, config.centerLon)}
            </div>
            <Row label="Radius" hint="How far out to show">
              <Slider value={config.radiusMiles} min={0.5} max={30} step={0.5} unit="mi" onChange={(v) => patch({ radiusMiles: v })} />
            </Row>
            <div className="chips">
              <button type="button" className="chip" onClick={saveCurrentProfile}>
                + Save current
              </button>
              {config.locationProfiles.map((p) => (
                <span key={p.id} className="profile-chip">
                  <button type="button" className="profile-name" onClick={() => jumpToProfile(p)}>
                    {p.name}
                  </button>
                  <button type="button" className="profile-del" onClick={() => deleteProfile(p.id)} aria-label={`Delete ${p.name}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </Section>

          <Section title="Airport">
            <Row label="Show runways">
              <Toggle value={config.showAirport} onChange={(v) => patch({ showAirport: v })} />
            </Row>
            <div className="loc-bar">
              <TextInput
                value={airportQuery}
                onCommit={(v) => {
                  setAirportQuery(v);
                  if (v) void importAirport(v);
                }}
                placeholder={`ICAO/IATA — currently ${config.airport.name}`}
                ariaLabel="Import airport"
              />
              <button type="button" className="loc-btn" disabled={airportBusy} onClick={() => void importAirport(airportQuery)}>
                Import
              </button>
            </div>
            {airportError && <div className="loc-error">{airportError}</div>}
          </Section>

          <Section title="Calibration">
            <Row label="Projection" hint="Sky = realistic look-up geometry">
              <Segmented
                value={config.projectionMode}
                options={[{ value: "map", label: "Map" }, { value: "sky", label: "Sky" }]}
                onChange={(v) => patch({ projectionMode: v })}
              />
            </Row>
            <Row label="Rotation">
              <Slider value={config.rotationDeg} min={0} max={359} unit="°" onChange={(v) => patch({ rotationDeg: v })} />
            </Row>
            <Row label="Mirror horizontal" hint="For the looking-up flip">
              <Toggle value={config.mirrorX} onChange={(v) => patch({ mirrorX: v })} />
            </Row>
            <Row label="Mirror vertical">
              <Toggle value={config.mirrorY} onChange={(v) => patch({ mirrorY: v })} />
            </Row>
            <Row label="Label rotation" hint="Keep text upright from where you lie">
              <Slider value={config.labelRotationDeg} min={0} max={359} unit="°" onChange={(v) => patch({ labelRotationDeg: v })} />
            </Row>
          </Section>

          <Section title="Filters">
            <Row label="Min altitude">
              <Slider value={config.minAltitudeFt} min={0} max={5000} step={100} unit="ft" onChange={(v) => patch({ minAltitudeFt: v })} />
            </Row>
            <Row label="Max altitude">
              <Slider value={config.maxAltitudeFt} min={1000} max={60000} step={1000} unit="ft" onChange={(v) => patch({ maxAltitudeFt: v })} />
            </Row>
            <Row label="Hide on-ground">
              <Toggle value={config.hideOnGround} onChange={(v) => patch({ hideOnGround: v })} />
            </Row>
          </Section>

          <Section title="Visuals">
            <Row label="Theme">
              <Segmented
                value={config.theme}
                options={[
                  { value: "ambient", label: "Ambient" },
                  { value: "telemetry", label: "Telemetry" },
                  { value: "focus", label: "Focus" },
                ]}
                onChange={(v) => patch({ theme: v })}
              />
            </Row>
            <Row label="Brightness">
              <Slider value={config.brightness} min={0.1} max={1} step={0.05} onChange={(v) => patch({ brightness: v })} />
            </Row>
            <Row label="Glyph size">
              <Slider value={config.glyphSizePx} min={10} max={40} unit="px" onChange={(v) => patch({ glyphSizePx: v })} />
            </Row>
            <Row label="Color by altitude">
              <Toggle value={config.altitudeColor} onChange={(v) => patch({ altitudeColor: v })} />
            </Row>
            <Row label="Trail length">
              <Slider value={config.trailSeconds} min={0} max={120} step={5} unit="s" onChange={(v) => patch({ trailSeconds: v })} />
            </Row>
            <Row label="Max FPS" hint="0 = uncapped">
              <Slider value={config.maxFps} min={0} max={60} step={5} onChange={(v) => patch({ maxFps: v })} />
            </Row>
          </Section>

          <Section title="Labels">
            <Row label="Density">
              <Segmented
                value={config.labelDensity}
                options={[
                  { value: "all", label: "All" },
                  { value: "nearestN", label: "Nearest N" },
                  { value: "nearestOnly", label: "Nearest 1" },
                ]}
                onChange={(v) => patch({ labelDensity: v })}
              />
            </Row>
            {config.labelDensity === "nearestN" && (
              <Row label="N" indent>
                <Slider value={config.nearestN} min={1} max={15} onChange={(v) => patch({ nearestN: v })} />
              </Row>
            )}
            <Row label="Name">
              <Toggle value={config.showFields.name} onChange={(v) => patch({ showFields: { ...config.showFields, name: v } })} />
            </Row>
            <Row label="Name style" indent>
              <Segmented
                value={config.nameDisplay}
                options={[{ value: "flight", label: "Flight #" }, { value: "airline", label: "Airline" }]}
                onChange={(v) => patch({ nameDisplay: v })}
              />
            </Row>
            <Row label="Aircraft type">
              <Toggle value={config.showFields.type} onChange={(v) => patch({ showFields: { ...config.showFields, type: v } })} />
            </Row>
            <Row label="Altitude">
              <Toggle value={config.showFields.altitude} onChange={(v) => patch({ showFields: { ...config.showFields, altitude: v } })} />
            </Row>
            <Row label="Speed">
              <Toggle value={config.showFields.speed} onChange={(v) => patch({ showFields: { ...config.showFields, speed: v } })} />
            </Row>
            <Row label="Speed unit" indent>
              <Segmented
                value={config.speedUnit}
                options={[{ value: "kt", label: "kt" }, { value: "mph", label: "mph" }, { value: "kmh", label: "km/h" }]}
                onChange={(v) => patch({ speedUnit: v })}
              />
            </Row>
            <Row label="Destination">
              <Toggle value={config.showFields.destination} onChange={(v) => patch({ showFields: { ...config.showFields, destination: v } })} />
            </Row>
            <Row label="Place names" indent hint="vs. IATA codes">
              <Segmented
                value={config.locationDisplay}
                options={[{ value: "name", label: "Names" }, { value: "iata", label: "Codes" }]}
                onChange={(v) => patch({ locationDisplay: v })}
              />
            </Row>
            <Row label="Registration">
              <Toggle value={config.showFields.registration} onChange={(v) => patch({ showFields: { ...config.showFields, registration: v } })} />
            </Row>
          </Section>

          <Section title="Window to elsewhere">
            <Row label="Destination arc" hint="Faint line toward where it's headed">
              <Toggle value={config.showDestArc} onChange={(v) => patch({ showDestArc: v })} />
            </Row>
            <Row label="Route detail" hint="Local time + miles to go">
              <Toggle value={config.showRouteDetail} onChange={(v) => patch({ showRouteDetail: v })} />
            </Row>
          </Section>

          <Section title="Overlays">
            <Row label="Range rings">
              <Toggle value={config.rangeRings} onChange={(v) => patch({ rangeRings: v })} />
            </Row>
            <Row label="Compass">
              <Toggle value={config.compass} onChange={(v) => patch({ compass: v })} />
            </Row>
            <Row label="Highlight emergencies" hint="Squawk 7500/7600/7700">
              <Toggle value={config.highlightEmergency} onChange={(v) => patch({ highlightEmergency: v })} />
            </Row>
            <Row label="Debug HUD">
              <Toggle value={config.showHud} onChange={(v) => patch({ showHud: v })} />
            </Row>
            <Row label="Credit text" hint="Cameron Paczek's original Skylight project">
              <Toggle value={config.showCredit} onChange={(v) => patch({ showCredit: v })} />
            </Row>
          </Section>

          <Section title="Sky layer">
            <Row label="Stars">
              <Toggle value={config.showStars} onChange={(v) => patch({ showStars: v })} />
            </Row>
            <Row label="Star brightness limit" indent hint="Higher = more stars">
              <Slider value={config.starMagLimit} min={0} max={6} step={0.1} onChange={(v) => patch({ starMagLimit: v })} />
            </Row>
            <Row label="Sun">
              <Toggle value={config.showSun} onChange={(v) => patch({ showSun: v })} />
            </Row>
            <Row label="Moon">
              <Toggle value={config.showMoon} onChange={(v) => patch({ showMoon: v })} />
            </Row>
            <Row label="Planets">
              <Toggle value={config.showPlanets} onChange={(v) => patch({ showPlanets: v })} />
            </Row>
            <Row label="Satellites" hint="Includes the ISS">
              <Toggle value={config.showSatellites} onChange={(v) => patch({ showSatellites: v })} />
            </Row>
            <Row label="Satellite names" indent>
              <Toggle value={config.satelliteLabels} onChange={(v) => patch({ satelliteLabels: v })} />
            </Row>
            <Row label="Sky time offset" hint="Scrub the sky clock, minutes">
              <Slider value={config.skyTimeOffsetMin} min={-720} max={720} step={5} unit="m" onChange={(v) => patch({ skyTimeOffsetMin: v })} />
            </Row>
          </Section>

          <Section title="Palette">
            <div className="palette">
              <ColorRow label="Background" value={config.palette.bg} onChange={(v) => patch({ palette: { ...config.palette, bg: v } })} />
              <ColorRow label="Glyph" value={config.palette.glyph} onChange={(v) => patch({ palette: { ...config.palette, glyph: v } })} />
              <ColorRow label="Trail" value={config.palette.trail} onChange={(v) => patch({ palette: { ...config.palette, trail: v } })} />
              <ColorRow label="Accent" value={config.palette.accent} onChange={(v) => patch({ palette: { ...config.palette, accent: v } })} />
              <ColorRow label="Warning" value={config.palette.warn} onChange={(v) => patch({ palette: { ...config.palette, warn: v } })} />
              <ColorRow label="Grid" value={config.palette.grid} onChange={(v) => patch({ palette: { ...config.palette, grid: v } })} />
              <ColorRow label="Text" value={config.palette.text} onChange={(v) => patch({ palette: { ...config.palette, text: v } })} />
            </div>
          </Section>

          <button
            type="button"
            className="reset"
            onClick={() => {
              if (confirm("Reset all settings to defaults? This keeps your location.")) {
                const { centerLat, centerLon, locationName } = config;
                reset();
                patch({ centerLat, centerLon, locationName });
              }
            }}
          >
            Reset to defaults
          </button>

          <p className="drawer-footer-note">
            Settings are saved in this browser only. Press <strong>S</strong> or tap the corner tab to
            toggle this drawer; press <strong>F</strong> for fullscreen ambient mode.
          </p>
        </div>
      </div>
    </div>
  );
}
