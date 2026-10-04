import type { Metadata, Viewport } from "next";

import { SEO_DESCRIPTION, SEO_TITLE, SITE_URL } from "@/components/landing/content";
import { LandingPage } from "@/components/landing/LandingPage";
import { getServerAccessToken, getServerAuthProvider, getServerUser } from "@/lib/auth/server";
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: SEO_TITLE },
  description: SEO_DESCRIPTION,
  keywords: [
    "AI voice agent",
    "AI calling software",
    "AI sales calls",
    "speed to lead",
    "lead qualification",
    "AI appointment setter",
    "AI receptionist",
    "Meta lead ads calling",
    "outbound AI calls",
    "Arabic voice AI",
    "Hebrew voice AI",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Sawt AI",
    title: SEO_TITLE,
    description: SEO_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_TITLE,
    description: SEO_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#faf8ff",
  colorScheme: "light",
};

// The landing page is the front door for every visitor. Signed-in users get an
// "Open dashboard" CTA that goes through /after-sign-in, which picks the right
// in-app destination (workflow list, create flow, superadmin, ...).
export default async function Home() {
  const authProvider = await getServerAuthProvider();
  const isLocal = authProvider === 'local';

  let signedIn = false;
  try {
    signedIn = isLocal ? !!(await getServerAccessToken()) : !!(await getServerUser());
  } catch (error) {
    // Auth backend hiccups shouldn't take down the public landing page.
    logger.error('[HomePage] Failed to resolve session, rendering signed-out landing:', error);
  }

  return (
    <LandingPage
      loginHref={isLocal ? "/auth/login" : "/handler/sign-in"}
      signupHref={isLocal ? "/auth/signup" : "/handler/sign-up"}
      dashboardHref={signedIn ? "/after-sign-in" : undefined}
      // Mirrors the env check in app/api/demo-call/route.ts.
      liveCallEnabled={Boolean(process.env.DEMO_CALL_AGENT_UUID && process.env.DEMO_CALL_API_KEY)}
    />
  );
}
