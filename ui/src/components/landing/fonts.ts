import { IBM_Plex_Mono, Inter } from "next/font/google";

export const inter = Inter({
  subsets: ["latin"],
  variable: "--landing-font-inter",
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--landing-font-mono",
  preload: false,
});

export const landingFontVariables = `${inter.variable} ${plexMono.variable}`;
