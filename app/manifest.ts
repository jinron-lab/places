import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Explore — Your personal place journal",
    short_name: "Explore",
    description:
      "Keep a personal record of the places you visited and the memories attached to them.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ddf4f2",
    theme_color: "#2f8f87",
    orientation: "any",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
