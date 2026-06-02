"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const LETTER_TRANSFORMS = [
  "translate(64,223) scale(0.255,-0.255)",
  "translate(168,223) scale(0.255,-0.255)",
  "translate(520,223) scale(0.255,-0.255)",
];

const LETTER_PATHS = [
  "M44.5 81.5Q36 94.5 36.75 109.25Q37.5 124 53.5 134.5Q64 142 77.25 141.0Q90.5 140 102 128Q129.5 95 165.75 75.5Q202 56 253.5 56Q277.5 56.5 301.75 63.75Q326 71 342.5 88.25Q359 105.5 359 134.5Q359 162.5 342.0 179.25Q325 196 297.75 206.5Q270.5 217 239 225Q206 234 174.0 245.25Q142 256.5 116.5 274.0Q91 291.5 75.5 318.0Q60 344.5 60 383Q60 427.5 84.5 460.5Q109 493.5 150.25 511.75Q191.5 530 241 530Q268.5 530 299.0 523.25Q329.5 516.5 358.5 501.0Q387.5 485.5 409.5 459Q419 448.5 419.75 433.75Q420.5 419 406.5 407Q396 399 382.5 399.75Q369 400.5 360 409.5Q338.5 435 307.0 448.5Q275.5 462 237.5 462Q213.5 462 190.5 454.75Q167.5 447.5 152.0 431.0Q136.5 414.5 136.5 385.5Q137.5 358.5 154.75 341.75Q172 325 201.0 314.25Q230 303.5 265 294Q296.5 286 326.25 275.25Q356 264.5 379.75 247.5Q403.5 230.5 417.75 204.25Q432 178 432 138Q432 91.5 405.75 58.25Q379.5 25 337.25 7.5Q295 -10 246 -10Q190.5 -10 137.0 10.75Q83.5 31.5 44.5 81.5Z",
  "M499.5 522Q517 522 528.25 510.5Q539.5 499 539.5 481.5V40.5Q539.5 23.5 528.0 11.75Q516.5 0 499.5 0Q482 0 470.75 11.75Q459.5 23.5 459.5 40.5V136L478.5 138Q478.5 115.5 463.5 89.75Q448.5 64 422.5 41.5Q396.5 19 361.25 4.5Q326 -10 285 -10Q217 -10 162.75 25.25Q108.5 60.5 77.25 121.75Q46 183 46 261Q46 340 77.5 400.5Q109 461 162.75 495.5Q216.5 530 283 530Q326 530 363.0 515.75Q400 501.5 427.5 477.5Q455 453.5 470.25 424.5Q485.5 395.5 485.5 366.5L459.5 372.5V481.5Q459.5 498.5 470.75 510.25Q482 522 499.5 522ZM293.5 64Q343.5 64 382.0 89.75Q420.5 115.5 442.25 160.25Q464 205 464 261Q464 316 442.25 360.25Q420.5 404.5 382.0 430.25Q343.5 456 293.5 456Q244.5 456 206.0 430.75Q167.5 405.5 145.5 361.5Q123.5 317.5 123.5 261Q123.5 205 145.25 160.25Q167 115.5 205.5 89.75Q244 64 293.5 64Z",
  "M54 514H288.5Q304.5 514 315.25 503.0Q326 492 326 476.5Q326 461 315.25 450.5Q304.5 440 288.5 440H54Q38.5 440 27.5 451.0Q16.5 462 16.5 477.5Q16.5 493 27.5 503.5Q38.5 514 54 514ZM158.5 650Q176 650 187.0 638.25Q198 626.5 198 609.5V126.5Q198 103 205.0 90.75Q212 78.5 223.25 74.25Q234.5 70 246 70Q255.5 70 263.0 73.25Q270.5 76.5 280.5 76.5Q291 76.5 299.25 67.25Q307.5 58 307.5 43Q307.5 24.5 286.5 12.25Q265.5 0 239.5 0Q226 0 205.5 2.0Q185 4 165.0 15.0Q145 26 131.5 51.25Q118 76.5 118 123V609.5Q118 626.5 129.75 638.25Q141.5 650 158.5 650Z",
];

const BARS: Array<{ x: number; y: number; h: number }> = [
  { x: 341.8, y: 224, h: 45 },
  { x: 353.8, y: 264, h: 6 },
  { x: 365.8, y: 88, h: 183 },
  { x: 378.8, y: 88, h: 141 },
  { x: 390.8, y: 88, h: 255 },
  { x: 402.8, y: 336, h: 6 },
  { x: 415.8, y: 128, h: 215 },
  { x: 427.8, y: 129, h: 102 },
  { x: 439.8, y: 129, h: 182 },
  { x: 452.8, y: 64, h: 247 },
  { x: 464.8, y: 58, h: 253 },
  { x: 476.8, y: 57, h: 206 },
  { x: 489.8, y: 256, h: 7 },
  { x: 501.8, y: 224, h: 39 },
];

interface SawtLogoProps {
  className?: string;
  animated?: boolean;
  ariaLabel?: string;
}

export function SawtLogo({
  className,
  animated = true,
  ariaLabel = "sawt",
}: SawtLogoProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!animated) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const runCycle = (restMs: number) => {
      if (cancelled) return;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        setIsAnimating(true);
        timeoutId = setTimeout(() => {
          if (cancelled) return;
          setIsAnimating(false);
          runCycle(2000);
        }, 500);
      }, restMs);
    };

    runCycle(1000);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [animated]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 666 375"
      role="img"
      aria-label={ariaLabel}
      className={cn(
        "sawt-logo",
        isAnimating && "sawt-logo--animating",
        className,
      )}
    >
      <g fill="currentColor">
        {LETTER_TRANSFORMS.map((transform, i) => (
          <g key={i} transform={transform}>
            <path d={LETTER_PATHS[i]} />
          </g>
        ))}
        {BARS.map((bar, i) => (
          <rect
            key={i}
            className="sawt-logo__bar"
            style={{ ["--sawt-i" as string]: i } as React.CSSProperties}
            x={bar.x}
            y={bar.y}
            width={8.5}
            height={bar.h}
            rx={2}
          />
        ))}
      </g>
    </svg>
  );
}
