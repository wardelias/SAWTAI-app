// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderLeadEmail, sendLeadEmail } from "./leadNotifications";

describe("sendLeadEmail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  it("does nothing without a Resend API key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendLeadEmail({ subject: "Hi", fields: [] })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("emails the default leads inbox with the lead as reply-to", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("LEADS_NOTIFY_EMAIL", "");

    const ok = await sendLeadEmail({
      subject: "New demo request: Dana (Acme)",
      fields: [["Name", "Dana"]],
      replyTo: "dana@acme.com",
    });

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["ward.elias16@gmail.com"]);
    expect(body.reply_to).toBe("dana@acme.com");
    expect(body.subject).toBe("New demo request: Dana (Acme)");
    expect(body.text).toContain("Name: Dana");
  });

  it("supports several recipients from LEADS_NOTIFY_EMAIL", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("LEADS_NOTIFY_EMAIL", "a@x.com, b@x.com");

    await sendLeadEmail({ subject: "Hi", fields: [] });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual(["a@x.com", "b@x.com"]);
  });

  it("reports failure when Resend rejects the email", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));

    expect(await sendLeadEmail({ subject: "Hi", fields: [] })).toBe(false);
  });
});

describe("renderLeadEmail", () => {
  it("escapes lead-supplied values in the HTML body", () => {
    const { html } = renderLeadEmail({ subject: "Lead", fields: [["Name", '<img src=x onerror="x">']] });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;x&quot;&gt;");
  });
});
