# Skylight — Web Edition

A rebuild of [Skylight](../README.md) with **no Raspberry Pi, no radio, and no
server**. It's a single static website: open it in Chrome, allow location
access, and it shows the aircraft currently over you — sun, moon, stars, and
satellites too — ready to project on your ceiling.

Every visitor's browser talks **directly** to the free public data sources
(adsbdb for routes, Nominatim for place search, Celestrak for satellites,
OurAirports for runways). The one exception is live aircraft positions: the
free community feeds don't allow browsers to read them directly, so the app
asks a tiny stateless relay (a free Cloudflare Worker, see
[Flight-data proxy](#flight-data-proxy-required)). The same URL works for you
on your Chromebook *and* as a public site anyone can open to see their own
local sky.

## What's different from the original Pi build

- **No `server/`, no `tracker/`, no PTZ camera, no radio/dump1090.** Those
  needed a Pi and dedicated hardware; this build only needs a browser.
- **Settings live in the page itself**, not a separate phone control panel —
  press **S** or tap the corner tab to open the settings drawer. Everything
  is saved to that browser's local storage only.
- **Location is per-visitor.** The first time anyone opens the site, it asks
  "where are you?" (share location, or type a city/airport/coordinates).
  Change it any time from the drawer.

## Quick start — run it locally

You'll need [Node.js](https://nodejs.org) (v20 or newer) installed on the
computer you're using to set this up — **not** the Chromebook. The
Chromebook only ever opens a plain web page; it never needs Node or any
install.

```bash
cd "Skylight Web-based Online"
npm install
npm run dev
```

Open the printed `http://localhost:5173/` URL, allow location access (or
type one in), and you should see live traffic. Press **S** for settings,
**F** for fullscreen "ambient" mode (also holds the screen awake).

## Flight-data proxy (required)

Live aircraft come from the free **adsb.lol** and **adsb.fi** community feeds.
Browsers can't read those directly (they don't send CORS headers), and
airplanes.live — what the first version used — now blocks unregistered
projects. So [`worker/flight-proxy.js`](worker/flight-proxy.js) is a ~100-line
Cloudflare Worker that fetches the feed, falls back between the two, caches for
3 seconds, and adds the CORS header. It stores nothing and has no accounts.

**Deploy it (about 5 minutes, free):**

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Workers & Pages → Create → Create Worker.** Name it (e.g. `skylight-feed`) → **Deploy**.
3. Click **Edit code**, delete the sample, paste in the entire contents of
   `worker/flight-proxy.js`, and **Deploy**.
4. Copy the Worker's URL (`https://skylight-feed.<you>.workers.dev`).
5. In the app: **Settings → Data feed → Feed URL**, paste it. Planes should
   appear within a few seconds. To make it the default for every visitor, set
   `DEFAULT_FEED_URL` in [`src/data/aircraftSource.ts`](src/data/aircraftSource.ts) and push.

To use it from another domain, add that origin to `ALLOWED_ORIGINS` at the top
of the Worker. **Free-tier limit:** 100,000 requests/day, and each open display
polls every 4 s (~21,600/day), so the free plan covers roughly 4 displays
running all day. A public site with many viewers needs the $5/month Workers
plan (10 million requests/month).

## Publish it as a real website (GitHub Pages)

This turns it into a URL like `https://<you>.github.io/<repo>/` that works
from any device, including the Chromebook, with no install step at all.

1. **Create a GitHub repository.** On [github.com](https://github.com/new),
   create a new repo (any name, e.g. `skylight-web`). Keep it **Public** —
   GitHub Pages is free for public repos.
2. **Push this folder to it.** From inside `Skylight Web-based Online/`:
   ```bash
   git init
   git add -A
   git commit -m "Skylight web edition"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. **Turn on Pages.** In the repo on GitHub: **Settings → Pages → Build and
   deployment → Source → GitHub Actions**. That's it — the workflow in
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) is already
   set up to build and deploy on every push to `main`.
4. **Watch it deploy.** The **Actions** tab shows the build running (takes
   about a minute). When it's green, your site is live at the URL shown
   under **Settings → Pages**.

From then on, any `git push` to `main` re-deploys automatically.

## Using it on your Chromebook

Two ways — pick whichever feels easier:

### Option A: just open the URL (simplest)

1. Open Chrome, go to your GitHub Pages URL (or `localhost:5173` if it's
   running on a computer on the same Wi-Fi — see "LAN mode" below).
2. Allow location access when Chrome asks.
3. Press **F** (or tap the "◳ ambient" button in the corner) to go
   fullscreen and keep the screen awake.
4. Connect the Chromebook to the projector — most Chromebooks need a
   **USB-C to HDMI adapter**; a few older ones have HDMI built in. Once
   connected, open the **status area (bottom-right) → screen icon → Displays**
   and either **mirror** the built-in display or set the projector as the
   primary display and drag the Chrome window over to it.

### Option B: install it as an app

Chrome can "install" a website as a standalone app with no address bar or
tabs — closer to the "little program" feel:

1. Open the site in Chrome.
2. Click the **install icon** in the address bar (a monitor with a down
   arrow), or the **⋮ menu → Cast, save, and share → Install page as app**.
3. It now opens from your app launcher / shelf like any other app, in its
   own window with no browser chrome.

Either way, nothing is "uploaded" anywhere — it's the same website, just
presented full-screen or as an app shortcut.

### LAN mode (no GitHub Pages, just your Wi-Fi)

If you don't want to publish it publicly, run `npm run dev` on any computer
on your home network (it already binds to your LAN, not just localhost),
then open `http://<that computer's LAN IP>:5173/` from the Chromebook's
Chrome. No GitHub, no public URL — just your Wi-Fi.

> Browsers only allow the "use my location" button over HTTPS (or on
> `localhost` itself) — on plain `http://192.168.x.x:5173` it'll be hidden
> and you'll type a city/airport/coordinates instead. GitHub Pages (HTTPS)
> doesn't have this limitation.

## Settings

Press **S** (or tap the small "⚙ settings" tab in the corner) to open the
drawer: location & radius, calibration (rotation/mirror for the looking-up
flip), filters, visuals & palette, labels, overlays, and the sky layer
(stars/sun/moon/planets/satellites). Everything persists to that browser's
`localStorage` — nothing is sent anywhere except the display's own data
requests.

## Limitations vs. the Pi build

- **No local radio.** This always uses the free community feeds (adsb.lol /
  adsb.fi), so coverage depends on nearby volunteer ADS-B receivers — usually excellent
  near cities/airports, sparser in very remote areas. If you later get an
  RTL-SDR and want direct local decode, use the [original Pi build](../README.md)
  instead (or point that build's `AIRCRAFT_JSON_URL` at your own receiver).
- **No PTZ sky camera / TV dashboard / tracker debug UI** — those needed a
  physical camera on a rotating mount, which is out of scope here.
- **No cross-device sync.** Settings are per-browser (by design — this is
  what makes the "shared public site" model work at all). If you use it on
  both a Chromebook and your phone, you'll set them up separately.

## Being a good citizen of the free APIs

Every open display polls the proxy every 4 s, which relays to adsb.lol /
adsb.fi (cached for 3 s so nearby viewers share one upstream request). Please
don't point automated scripts at these endpoints outside of normal display
use; they're free public services run by volunteers.
