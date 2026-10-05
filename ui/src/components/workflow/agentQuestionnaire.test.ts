import { describe, expect, it } from "vitest";

import {
    answersFromPrefill,
    buildAgentBrief,
    EMPTY_ANSWERS,
    goalsFor,
    OTHER_GOAL,
    resolveUseCase,
} from "./agentQuestionnaire";

describe("answersFromPrefill", () => {
    it("maps a known use case to its goal and suggested details", () => {
        const answers = answersFromPrefill({
            callType: "outbound",
            useCase: "lead qualification",
            description: "Call new leads",
        });

        expect(answers.callType).toBe("outbound");
        expect(answers.goal).toBe("Lead qualification");
        expect(answers.collect).toEqual(["Full name", "Budget", "Timeline", "Needs"]);
        expect(answers.outcome).toBe("book");
        expect(answers.goalDetails).toBe("Call new leads");
    });

    it("keeps an unknown use case as a custom goal and ignores a bad call type", () => {
        const answers = answersFromPrefill({ callType: "sideways", useCase: "Warranty claims" });

        expect(answers.callType).toBe("");
        expect(answers.goal).toBe(OTHER_GOAL);
        expect(resolveUseCase(answers)).toBe("Warranty claims");
    });
});

describe("goalsFor", () => {
    it("only offers goals that fit the call direction", () => {
        const inbound = goalsFor("inbound").map((g) => g.value);

        expect(inbound).toContain("Receptionist");
        expect(inbound).not.toContain("Payment reminders");
    });
});

describe("buildAgentBrief", () => {
    it("writes every answer into the brief", () => {
        const brief = buildAgentBrief({
            ...EMPTY_ANSWERS,
            callType: "outbound",
            goal: "Lead qualification",
            businessName: "Haddad Real Estate",
            industry: "Real estate",
            offering: "Apartments in Haifa",
            goalDetails: "Book viewings with serious buyers.",
            audience: ["New leads"],
            languages: ["Arabic (Levantine)", "Hebrew"],
            matchCallerLanguage: true,
            agentName: "Mariam",
            voice: "female",
            tone: "Warm and friendly",
            collect: ["Budget", "Timeline"],
            mustAsk: "Buy or rent?",
            outcome: "book",
            handoff: ["The caller asks for a human"],
            neverDo: "Promise discounts",
            knowledge: "Open Sun–Thu 9–18",
            length: "Aim for 2 to 5 minutes",
        });

        expect(brief.split("\n")).toEqual([
            "Build a voice agent that places outbound calls for Haddad Real Estate (Real estate) to handle lead qualification.",
            "What the business offers: Apartments in Haifa",
            "What the agent should do: Book viewings with serious buyers.",
            "It talks to: new leads.",
            "Persona: introduce itself as Mariam, use a female voice and sound warm and friendly.",
            "Speak Arabic (Levantine) and Hebrew, switching to whichever of these the caller uses.",
            "Collect: budget and timeline.",
            "Questions it must ask: Buy or rent?",
            "Goal of a successful call: Book a meeting at a time that suits the caller and confirm the date and time back to them.",
            "If the caller asks for a human, offer to transfer them or arrange a call back.",
            "Never: Promise discounts",
            "Facts it should know: Open Sun–Thu 9–18",
            "Aim for 2 to 5 minutes.",
        ]);
    });

    it("leaves out unanswered questions instead of guessing", () => {
        const brief = buildAgentBrief({
            ...EMPTY_ANSWERS,
            callType: "inbound",
            goal: OTHER_GOAL,
            goalOther: "Warranty claims",
            languages: ["English"],
        });

        expect(brief).toBe("Build a voice agent that answers inbound calls to handle warranty claims.\nSpeak English.");
    });
});
