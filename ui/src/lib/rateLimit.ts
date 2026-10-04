/**
 * Best-effort, per-instance sliding-window limiter for public form endpoints.
 * State lives in memory, so it only blunts casual abuse; it is not a quota.
 *
 * Returns a function that records a hit for `key` and reports whether it is
 * still within `max` hits per `windowMs`.
 */
export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }) {
  const hits = new Map<string, number[]>();

  return (key: string): boolean => {
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [k, times] of hits) {
        if (times.every((t) => now - t >= windowMs)) hits.delete(k);
      }
    }
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    hits.set(key, [...recent, now]);
    return true;
  };
}

/** Caller IP as reported by the proxy in front of Next (Vercel, nginx, ...). */
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
