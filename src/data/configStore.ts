// Local, per-browser settings store. Replaces Skylight's server-persisted,
// WebSocket-synced Config with a React hook backed by localStorage — every
// visitor's browser keeps its own settings, no server required.

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CONFIG, mergeConfig, type Config } from "../lib/config.js";

const STORAGE_KEY = "skylight.config.v1";
const HAS_LOCATION_KEY = "skylight.hasLocation.v1";

function load(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeConfig(DEFAULT_CONFIG, JSON.parse(raw) as Partial<Config>);
  } catch {
    /* corrupt or unavailable storage — fall back to defaults */
  }
  return DEFAULT_CONFIG;
}

function save(cfg: Config): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage full or unavailable — settings just won't persist across reloads */
  }
}

/** Has this browser ever set a real location (vs. the SFO default)? Drives
 *  the first-run "where are you?" prompt. */
export function hasSetLocation(): boolean {
  return localStorage.getItem(HAS_LOCATION_KEY) === "1";
}

export function markLocationSet(): void {
  try {
    localStorage.setItem(HAS_LOCATION_KEY, "1");
  } catch {
    /* noop */
  }
}

export function useConfig(): {
  config: Config;
  patch: (p: Partial<Config>) => void;
  reset: () => void;
} {
  const [config, setConfig] = useState<Config>(load);

  useEffect(() => save(config), [config]);

  const patch = useCallback((p: Partial<Config>) => {
    setConfig((prev) => mergeConfig(prev, p));
  }, []);

  const reset = useCallback(() => setConfig(DEFAULT_CONFIG), []);

  return { config, patch, reset };
}
