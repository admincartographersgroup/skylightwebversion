import { useEffect, useRef, useState } from "react";
import { Renderer } from "./display/renderer.js";
import { AircraftSource, type SourceStatus } from "./data/aircraftSource.js";
import { useConfig, hasSetLocation, markLocationSet } from "./data/configStore.js";
import { useAmbientMode, kioskRequested } from "./lib/useAmbientMode.js";
import { SettingsDrawer } from "./ui/SettingsDrawer.js";
import { LocationOnboarding } from "./ui/LocationOnboarding.js";

export function App() {
  const { config, patch, reset } = useConfig();
  const ambient = useAmbientMode();
  const isKiosk = kioskRequested();

  const [showOnboarding, setShowOnboarding] = useState(() => !hasSetLocation());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [status, setStatus] = useState<SourceStatus | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  // Keep the latest config in a ref so the RAF loop and the poller always
  // read fresh values without re-subscribing.
  const configRef = useRef(config);
  configRef.current = config;

  // Create the renderer once.
  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new Renderer(canvasRef.current, () => configRef.current);
    rendererRef.current = r;
    r.start();
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      r.stop();
      rendererRef.current = null;
    };
  }, []);

  // Create the aircraft source once. Runs continuously (even during
  // onboarding) so there's something to look at while you decide on a
  // location — same as the default-SFO behavior of the original app.
  useEffect(() => {
    const src = new AircraftSource({
      getConfig: () => configRef.current,
      onSnapshot: (_now, aircraft) => rendererRef.current?.update(aircraft),
      onStatus: (s) => {
        setStatus(s);
        rendererRef.current?.setSourceOk(s.ok);
      },
    });
    src.start();
    return () => src.stop();
  }, []);

  // Keyboard shortcuts: s = settings drawer, f = ambient fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "s" || e.key === "S") setDrawerOpen((o) => !o);
      if (e.key === "f" || e.key === "F") ambient.toggle();
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ambient]);

  // Reveal the OS cursor while the drawer is open (it's hidden globally for
  // the projector) and hide it again once closed.
  useEffect(() => {
    document.body.classList.toggle("show-cursor", drawerOpen);
  }, [drawerOpen]);

  return (
    <>
      {showOnboarding && (
        <LocationOnboarding
          onResolved={(lat, lon, name) => {
            patch({ centerLat: lat, centerLon: lon, locationName: name });
            markLocationSet();
            setShowOnboarding(false);
          }}
        />
      )}

      <div className="display-root">
        <canvas ref={canvasRef} className="display-canvas" />
        {config.showHud && (
          <div className="hud">
            <div className={`hud-dot ${status?.ok ? "ok" : "bad"}`} />
            <span>
              {status?.ok ? `${status.count} ac` : (status?.message ?? "connecting…")} · rot{" "}
              {config.rotationDeg}° · mirror {config.mirrorX ? "X" : "–"}
              {config.mirrorY ? "Y" : ""} · r {config.radiusMiles}mi · {config.projectionMode} ·{" "}
              {config.theme}
            </span>
          </div>
        )}
      </div>

      {!isKiosk && (
        <>
          <button
            type="button"
            className={`ambient-toggle ${ambient.active ? "on" : ""}`}
            onClick={() => ambient.toggle()}
            title={
              ambient.active
                ? "Exit ambient mode (fullscreen + keep awake) — press f"
                : "Ambient mode: fullscreen + keep screen awake — press f"
            }
            aria-label="Toggle ambient fullscreen mode"
          >
            {ambient.active ? "◱ exit ambient" : "◳ ambient"}
            {ambient.active && !ambient.wakeLocked && <span className="ambient-warn"> · no wake-lock</span>}
          </button>
          <button
            type="button"
            className="settings-toggle"
            onClick={() => setDrawerOpen((o) => !o)}
            title="Settings — press s"
            aria-label="Toggle settings drawer"
          >
            ⚙ settings
          </button>
        </>
      )}

      <SettingsDrawer
        config={config}
        patch={patch}
        reset={reset}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        status={status}
      />
    </>
  );
}
