import { describe, expect, it } from "vitest";

import { AGENT_IDEAS, createAgentHref } from "./agentIdeas";

describe("createAgentHref", () => {
    it("links to the plain builder when nothing is prefilled", () => {
        expect(createAgentHref()).toBe("/workflow/create");
        expect(createAgentHref({ description: "" })).toBe("/workflow/create");
    });

    it("encodes every prefilled field as a query param", () => {
        const href = createAgentHref({
            callType: "outbound",
            useCase: "Lead qualification",
            description: "Call leads & book demos?",
        });
        const url = new URL(href, "https://app.test");

        expect(url.pathname).toBe("/workflow/create");
        expect(url.searchParams.get("call_type")).toBe("outbound");
        expect(url.searchParams.get("use_case")).toBe("Lead qualification");
        expect(url.searchParams.get("description")).toBe("Call leads & book demos?");
    });

    it("ignores extra idea fields such as the icon", () => {
        const href = createAgentHref(AGENT_IDEAS[0]);

        expect(new URL(href, "https://app.test").searchParams.has("icon")).toBe(false);
    });
});
