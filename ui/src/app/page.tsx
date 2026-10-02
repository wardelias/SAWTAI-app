import { LandingPage } from "@/components/landing/LandingPage";
import { getServerAccessToken, getServerAuthProvider, getServerUser } from "@/lib/auth/server";
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

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
    />
  );
}
