import type { MetadataRoute } from "next";

import { SITE_URL } from "@/components/landing/content";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The signed-in app and its APIs have nothing to index.
      disallow: ["/api/", "/after-sign-in", "/handler/", "/impersonate", "/superadmin"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
