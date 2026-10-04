/** Canonical public origin of the marketing site (used for SEO URLs). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://callsawt.com").replace(/\/$/, "");

/**
 * Request header the middleware sets on full-page requests for the public
 * landing page ("/"). The root layout reads it to render the landing page
 * server-side, outside the app's client-only auth providers.
 */
export const LANDING_REQUEST_HEADER = "x-sawt-landing";
