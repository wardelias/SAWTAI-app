import { NextRequest, NextResponse } from "next/server";

import { getServerBackendUrl } from "@/lib/apiClient";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Call me" button on the public landing page.
 *
 * Places an outbound call from a Sawt agent through the backend's public agent
 * trigger (POST /api/v1/public/agent/{uuid}). The org API key stays on the
 * server; the browser only ever sends a phone number.
 *
 * Env:
 *   DEMO_CALL_AGENT_UUID        trigger UUID of the demo agent (required)
 *   DEMO_CALL_API_KEY           org API key that owns the trigger (required)
 *   DEMO_CALL_ALLOWED_PREFIXES  comma-separated E.164 prefixes we will dial
 *                               (default "+972"), so the form can't be used to
 *                               run up international call charges.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS_PER_IP = 3;
const NUMBER_COOLDOWN_MS = 2 * 60 * 1000;

// Best-effort, per-instance throttling. The backend's own concurrency and
// quota limits are the hard stop; this just blunts casual abuse of a public form.
const callsByIp = new Map<string, number[]>();
const lastCallByNumber = new Map<string, number>();

/** Normalize to E.164, treating a leading 0 as an Israeli national number. */
function normalizePhone(raw: string): string | null {
  let phone = raw.replace(/[\s\-().]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  else if (phone.startsWith("0")) phone = `+972${phone.slice(1)}`;
  else if (!phone.startsWith("+")) phone = `+${phone}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function allowedPrefixes(): string[] {
  return (process.env.DEMO_CALL_ALLOWED_PREFIXES || "+972")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function pruneOldEntries(now: number) {
  for (const [ip, times] of callsByIp) {
    const recent = times.filter((t) => now - t < WINDOW_MS);
    if (recent.length) callsByIp.set(ip, recent);
    else callsByIp.delete(ip);
  }
  for (const [number, time] of lastCallByNumber) {
    if (now - time >= NUMBER_COOLDOWN_MS) lastCallByNumber.delete(number);
  }
}

export async function POST(request: NextRequest) {
  const agentUuid = process.env.DEMO_CALL_AGENT_UUID;
  const apiKey = process.env.DEMO_CALL_API_KEY;
  if (!agentUuid || !apiKey) {
    return NextResponse.json({ error: "Live demo calls are not configured" }, { status: 503 });
  }

  let body: { phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
  if (!phone || !allowedPrefixes().some((prefix) => phone.startsWith(prefix))) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const now = Date.now();
  pruneOldEntries(now);
  const ip = clientIp(request);
  const ipCalls = callsByIp.get(ip) ?? [];
  if (ipCalls.length >= MAX_CALLS_PER_IP || lastCallByNumber.has(phone)) {
    return NextResponse.json({ error: "Too many demo calls, try again later" }, { status: 429 });
  }
  callsByIp.set(ip, [...ipCalls, now]);
  lastCallByNumber.set(phone, now);

  const backendUrl = getServerBackendUrl().replace(/\/$/, "");
  try {
    const response = await fetch(`${backendUrl}/api/v1/public/agent/${encodeURIComponent(agentUuid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        phone_number: phone,
        initial_context: { source: "landing_live_demo" },
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      logger.error(`[demo-call] Backend rejected demo call (${response.status}): ${await response.text()}`);
      return NextResponse.json({ error: "Could not start the call" }, { status: 502 });
    }
    return NextResponse.json({ status: "started" });
  } catch (error) {
    logger.error("[demo-call] Failed to reach backend:", error);
    return NextResponse.json({ error: "Could not start the call" }, { status: 502 });
  }
}
