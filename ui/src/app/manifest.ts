import type { MetadataRoute } from "next";

// Web app manifest so the dashboard can be installed to a phone's home screen
// and launched full-screen. Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SawtAI",
    short_name: "SawtAI",
    description: "Build, test and run AI voice agents.",
    start_url: "/overview",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0e0d",
    theme_color: "#0f0e0d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
