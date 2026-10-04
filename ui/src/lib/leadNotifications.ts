import logger from "@/lib/logger";

/**
 * Email notifications for leads captured on the public landing page, sent
 * through Resend's HTTP API (no SDK needed).
 *
 * Env:
 *   RESEND_API_KEY      Resend API key (required; without it nothing is sent)
 *   LEADS_NOTIFY_EMAIL  comma-separated recipients (default below)
 *   LEADS_EMAIL_FROM    sender. Resend's shared "onboarding@resend.dev" only
 *                       delivers to the Resend account's own address; verify a
 *                       domain in Resend to send from e.g. leads@callsawt.com.
 */

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const DEFAULT_NOTIFY_EMAIL = "ward.elias16@gmail.com";
const DEFAULT_FROM = "Sawt AI <onboarding@resend.dev>";

export interface LeadEmail {
  subject: string;
  /** Label/value rows shown in the email, in order. */
  fields: [label: string, value: string][];
  /** The lead's own address, so "Reply" in the inbox goes straight to them. */
  replyTo?: string;
}

export function isLeadEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderLeadEmail({ subject, fields }: LeadEmail): { html: string; text: string } {
  const rows = [...fields, ["Received", new Date().toUTCString()] as [string, string]];
  const text = [subject, "", ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f">
<h2 style="margin:0 0 16px;font-size:18px">${escapeHtml(subject)}</h2>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">
${rows
  .map(
    ([label, value]) =>
      `<tr><td style="color:#6e6e73;padding-right:16px">${escapeHtml(label)}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`,
  )
  .join("\n")}
</table>
</div>`;
  return { html, text };
}

/** Sends the lead to the notification inbox. Resolves false (and logs) on any failure. */
export async function sendLeadEmail(email: LeadEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("[leads] RESEND_API_KEY is not set; lead email not sent");
    return false;
  }

  const to = (process.env.LEADS_NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL)
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const { html, text } = renderLeadEmail(email);

  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.LEADS_EMAIL_FROM || DEFAULT_FROM,
        to,
        subject: email.subject,
        html,
        text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      logger.error(`[leads] Resend rejected lead email (${response.status}): ${await response.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error("[leads] Failed to reach Resend:", error);
    return false;
  }
}
