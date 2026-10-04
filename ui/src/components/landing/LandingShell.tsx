"use client";

import clsx from "clsx";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { DemoBookingModal } from "./DemoBookingModal";
import { landingFontVariables } from "./fonts";
import styles from "./landing.module.css";

/** Height of the fixed navbar, so in-page anchors don't land underneath it. */
const NAV_OFFSET = 80;

const BLOBS = [styles.blob1, styles.blob2, styles.blob3, styles.blob4, styles.blob5, styles.blob6, styles.blob7];

const PAGE_BACKGROUND = "#faf8ff";

/**
 * Client wrapper around the server-rendered landing sections. It owns the
 * page-wide behaviour so the sections themselves can stay static:
 * - smooth-scrolls "#section" links (offset for the fixed nav),
 * - opens the book-a-demo form for any element with `data-book-demo`
 *   (without JS those are plain links to the #book section),
 * - fades `.fadeUp` blocks in as they scroll into view.
 */
export function LandingShell({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const closeDemo = useCallback(() => setDemoOpen(false), []);

  // Content is server-rendered fully visible (crawlers, no-JS). Once JS runs,
  // blocks already on screen stay put and the rest fade up on scroll.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.visible = "";
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" },
    );
    root.querySelectorAll<HTMLElement>(`.${CSS.escape(styles.fadeUp)}`).forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.shown = "";
      else observer.observe(el);
    });
    root.dataset.reveal = "";
    return () => observer.disconnect();
  }, []);

  // Match the overscroll / safe-area background to the page (the app shell is dark).
  useEffect(() => {
    const { body, documentElement: html } = document;
    const previous = [html.style.backgroundColor, body.style.backgroundColor];
    html.style.backgroundColor = PAGE_BACKGROUND;
    body.style.backgroundColor = PAGE_BACKGROUND;
    return () => {
      html.style.backgroundColor = previous[0];
      body.style.backgroundColor = previous[1];
    };
  }, []);

  useEffect(() => {
    if (!demoOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [demoOpen]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>("a, button");
    if (!element) return;

    if (element.hasAttribute("data-book-demo")) {
      event.preventDefault();
      setDemoOpen(true);
      return;
    }

    const href = element.getAttribute("href");
    if (!href?.startsWith("#") || href.length < 2) return;
    const target = document.getElementById(href.slice(1));
    if (!target) return;

    event.preventDefault();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - NAV_OFFSET),
      behavior: reduceMotion ? "auto" : "smooth",
    });
    window.history.pushState(null, "", href);
  };

  return (
    <div ref={rootRef} className={clsx(styles.landing, landingFontVariables)} onClick={handleClick}>
      <div className={styles.floatingBlobs} aria-hidden>
        {BLOBS.map((blob) => (
          <div key={blob} className={clsx(styles.blob, blob)} />
        ))}
      </div>
      {children}
      {demoOpen && <DemoBookingModal onClose={closeDemo} />}
    </div>
  );
}
