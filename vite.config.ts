import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Relative base so the built site works from any subpath — e.g. a GitHub
  // Pages project site at https://<user>.github.io/<repo>/ — without editing
  // this file per-repo.
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Skylight",
        short_name: "Skylight",
        description: "Live aircraft overhead, projected on your ceiling.",
        theme_color: "#000000",
        background_color: "#000000",
        display: "fullscreen",
        orientation: "any",
        start_url: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell only — never cache live flight/sky data requests.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
