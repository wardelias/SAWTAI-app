// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const LEAD = { name: "Dana Levi", email: "dana@acme.com", phone: "054-123-4567", company: "Acme" };
const WEBHOOK = "https://crm.example.com/hook";

let ipCounter = 0;

function demoRequest(body: unknown, ip = `10.0.0.${++ipCounter}`) {
  return new NextRequest("http://localhost/api/demo-request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/demo-request", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("DEMO_BOOKING_WEBHOOK_URL", WEBHOOK);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  it("emails the lead and forwards it to the CRM webhook", async () => {
    const response = await POST(demoRequest(LEAD));

    expect(response.status).toBe(200);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual(expect.arrayContaining(["https://api.resend.com/emails", WEBHOOK]));

    const email = JSON.parse(fetchMock.mock.calls.find(([url]) => url.includes("resend"))![1].body);
    expect(email.to).toEqual(["ward.elias16@gmail.com"]);
    expect(email.subject).toBe("New demo request: Dana Levi (Acme)");
    expect(email.reply_to).toBe("dana@acme.com");
    expect(email.text).toContain("Phone: 054-123-4567");

    const crm = JSON.parse(fetchMock.mock.calls.find(([url]) => url === WEBHOOK)![1].body);
    expect(crm).toEqual(LEAD);
  });

  it("still succeeds when only one delivery works", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === WEBHOOK ? new Response("down", { status: 500 }) : new Response("{}", { status: 200 }),
    );

    expect((await POST(demoRequest(LEAD))).status).toBe(200);
  });

  it("fails when every delivery fails", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 500 }));

    expect((await POST(demoRequest(LEAD))).status).toBe(502);
  });

  it("returns 503 when nothing is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("DEMO_BOOKING_WEBHOOK_URL", "");

    expect((await POST(demoRequest(LEAD))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid details without delivering", async () => {
    const response = await POST(demoRequest({ ...LEAD, email: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently drops honeypot submissions", async () => {
    const response = await POST(demoRequest({ ...LEAD, website: "http://spam.example" }));

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits repeated requests from one IP", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await POST(demoRequest(LEAD, "192.168.1.1"))).status);

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
