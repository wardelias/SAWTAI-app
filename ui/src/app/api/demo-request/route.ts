import { NextRequest, NextResponse } from "next/server";

import { isLeadEmailConfigured, sendLeadEmail } from "@/lib/leadNotifications";
import logger from "@/lib/logger";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Book a demo" form on the public landing page.
 *
 * Each request is emailed to the leads inbox (see lib/leadNotifications) and
 * forwarded to the CRM webhook. It succeeds if at least one of those delivers.
 *
 * Env:
 *   DEMO_BOOKING_WEBHOOK_URL  CRM webhook that also receives the request
 *                             (default below; set it to an empty string to turn it off)
 */

const DEFAULT_WEBHOOK_URL =
  "https://services.leadconnectorhq.com/hooks/5mx08gT5SXJptjzoBMQ9/webhook-trigger/36aa89fe-2406-45f1-8418-c7fa4c1203c5";

const allowRequest = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\-\s\d]{6,30}$/;

interface DemoRequest {
  name: string;
  email: string;
  phone: string;
  company: string;
}

function parseDemoRequest(body: Record<string, unknown>): DemoRequest | null {
  const text = (key: string, max: number) => {
    const value = body[key];
    return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;
  };
  const name = text("name", 100);
  const email = text("email", 200);
  const phone = text("phone", 30);
  const company = text("company", 120);
  if (!name || !email || !phone || !company) return null;
  if (!EMAIL_RE.test(email) || !PHONE_RE.test(phone)) return null;
  return { name, email, phone, company };
}

async function forwardToWebhook(url: string, lead: DemoRequest): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
      cache: "no-store",
    });
    if (!response.ok) logger.error(`[demo-request] CRM webhook rejected lead (${response.status})`);
    return response.ok;
  } catch (error) {
    logger.error("[demo-request] Failed to reach CRM webhook:", error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Honeypot: the form's hidden "website" field is only ever filled in by bots.
  // Pretend success so they don't retry.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ status: "ok" });
  }

  const lead = parseDemoRequest(body);
  if (!lead) {
    return NextResponse.json({ error: "Please fill in every field with valid details" }, { status: 400 });
  }

  if (!allowRequest(clientIp(request))) {
    return NextResponse.json({ error: "Too many requests, try again later" }, { status: 429 });
  }

  const webhookUrl = process.env.DEMO_BOOKING_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL;
  const deliveries: Promise<boolean>[] = [];
  if (isLeadEmailConfigured()) {
    deliveries.push(
      sendLeadEmail({
        subject: `New demo request: ${lead.name} (${lead.company})`,
        fields: [
          ["Name", lead.name],
          ["Email", lead.email],
          ["Phone", lead.phone],
          ["Company", lead.company],
          ["Source", "callsawt.com — Book a demo"],
        ],
        replyTo: lead.email,
      }),
    );
  }
  if (webhookUrl) deliveries.push(forwardToWebhook(webhookUrl, lead));

  if (deliveries.length === 0) {
    logger.error("[demo-request] No delivery configured (set RESEND_API_KEY and/or DEMO_BOOKING_WEBHOOK_URL)");
    return NextResponse.json({ error: "Demo requests are not configured" }, { status: 503 });
  }

  const results = await Promise.all(deliveries);
  if (!results.some(Boolean)) {
    return NextResponse.json({ error: "Could not submit the request" }, { status: 502 });
  }
  return NextResponse.json({ status: "ok" });
}
