"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

import { SawtLogo } from "@/components/SawtLogo";

import { NAV_LINKS } from "./content";
import styles from "./landing.module.css";

interface LandingNavProps {
  primaryHref: string;
  primaryLabel: string;
  /** Shown as a secondary "Sign in" link for signed-out visitors. */
  loginHref?: string;
}

export function LandingNav({ primaryHref, primaryLabel, loginHref }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header className={clsx(styles.navbar, (scrolled || menuOpen) && styles.scrolled)}>
      <nav aria-label="Main" className={styles.navContainer}>
        <a href="#top" className={styles.logoLink} aria-label="Sawt AI — back to top">
          <SawtLogo className={styles.logo} ariaLabel="Sawt AI" />
        </a>

        <div
          id="landing-menu"
          className={clsx(styles.navLinks, menuOpen && styles.open)}
          onClick={() => setMenuOpen(false)}
        >
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
          {loginHref && (
            <a href={loginHref} className={styles.navSignIn}>
              Sign in
            </a>
          )}
        </div>

        <div className={styles.navActions}>
          <a href={primaryHref} className={clsx(styles.btnPrimary, styles.navCta)}>
            {primaryLabel}
          </a>
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="landing-menu"
            className={clsx(styles.mobileMenuBtn, menuOpen && styles.open)}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>
    </header>
  );
}
