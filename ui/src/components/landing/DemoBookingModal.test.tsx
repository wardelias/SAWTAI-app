import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoBookingModal } from "./DemoBookingModal";

vi.mock("@/lib/metaPixel", () => ({ trackMetaLead: vi.fn() }));
// Vitest can't run the app's Tailwind PostCSS pipeline; class names don't matter here.
vi.mock("./landing.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

describe("DemoBookingModal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits the request to the server route, not a third-party URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<DemoBookingModal onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dana Levi" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "dana@acme.com" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "054-123-4567" } });
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Request my demo" }));

    await screen.findByText(/you're on the list/i);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/demo-request");
    expect(JSON.parse(init.body)).toEqual({
      name: "Dana Levi",
      email: "dana@acme.com",
      phone: "054-123-4567",
      company: "Acme",
      website: "",
    });
  });

  it("shows an error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<DemoBookingModal onClose={() => {}} />);

    for (const [label, value] of [
      ["Name", "Dana"],
      ["Work email", "dana@acme.com"],
      ["Phone number", "0541234567"],
      ["Company name", "Acme"],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Request my demo" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/something went wrong/i));
  });
});
