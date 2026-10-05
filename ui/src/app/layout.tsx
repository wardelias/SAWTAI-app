import "./globals.css";

import { GoogleTagManager } from "@next/third-parties/google";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Suspense } from "react";

import ChatwootWidget from "@/components/ChatwootWidget";
import AppLayout from "@/components/layout/AppLayout";
import MetaPixel from "@/components/MetaPixel";
import PostHogIdentify from "@/components/PostHogIdentify";
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";
import SpinLoader from "@/components/SpinLoader";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { AppConfigProvider } from "@/context/AppConfigContext";
import { OnboardingProvider } from "@/context/OnboardingContext";
import { OrgConfigProvider } from "@/context/OrgConfigContext";
import { TelephonyConfigWarningsProvider } from "@/context/TelephonyConfigWarningsContext";
import { AuthProvider } from "@/lib/auth";
import { LANDING_REQUEST_HEADER, SITE_URL } from "@/lib/site";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "SawtAI",
  description: "Open Source Voice Assistant Workflow Builder",
  applicationName: "SawtAI",
  // Installed to a phone's home screen, the app opens full-screen like a native app.
  appleWebApp: {
    capable: true,
    title: "SawtAI",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: {
    telephone: false,
  },
};

// viewport-fit=cover lets the mobile shell paint under the notch / home
// indicator; components pad themselves with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f0e0d",
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID?.trim();
  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  // Full-page loads of the public landing page skip the app providers: the
  // auth provider renders only a spinner until a client-side fetch resolves,
  // which would leave the landing page with no server-rendered HTML. Its
  // links into the app are plain <a> tags, so the app always boots with them.
  const isLandingPage = (await headers()).get(LANDING_REQUEST_HEADER) === "1";

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Inline script to prevent flash of light theme - runs before React hydrates.
            Dark is the locked default: only an explicit stored 'light' opts out. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'light') {
                    document.documentElement.classList.remove('dark');
                  } else {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        // Light page behind the (light) landing page while it streams in.
        style={isLandingPage ? { backgroundColor: "#faf8ff" } : undefined}
        suppressHydrationWarning>
        {gtmId ? <GoogleTagManager gtmId={gtmId} /> : null}
        {metaPixelId ? <MetaPixel pixelId={metaPixelId} /> : null}
        {isLandingPage ? (
          <SentryErrorBoundary>
            {children}
            <ChatwootWidget />
          </SentryErrorBoundary>
        ) : (
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
            <SentryErrorBoundary>
              <AuthProvider>
                <AppConfigProvider>
                  <Suspense fallback={<SpinLoader />}>
                    <OrgConfigProvider>
                      <TelephonyConfigWarningsProvider>
                        <OnboardingProvider>
                          <PostHogIdentify />
                          <AppLayout>
                            {children}
                          </AppLayout>
                          <Toaster />
                          <ChatwootWidget />
                        </OnboardingProvider>
                      </TelephonyConfigWarningsProvider>
                    </OrgConfigProvider>
                  </Suspense>
                </AppConfigProvider>
              </AuthProvider>
            </SentryErrorBoundary>
          </ThemeProvider>
        )}
      </body>
    </html>
  );
}
