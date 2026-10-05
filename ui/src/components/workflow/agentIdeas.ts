import {
    BellRing,
    CalendarCheck,
    ClipboardList,
    Headphones,
    type LucideIcon,
    PhoneIncoming,
    Target,
} from "lucide-react";

export type AgentCallType = "inbound" | "outbound";

export interface AgentIdea {
    useCase: string;
    callType: AgentCallType;
    description: string;
    icon: LucideIcon;
}

/** One-tap starting points for the AI agent builder. */
export const AGENT_IDEAS: AgentIdea[] = [
    {
        useCase: "Lead qualification",
        callType: "outbound",
        description:
            "Call new leads within minutes of sign-up, ask about their budget, timeline and needs, and book a demo with the qualified ones.",
        icon: Target,
    },
    {
        useCase: "Appointment booking",
        callType: "inbound",
        description:
            "Answer incoming calls, find a time that works for the caller, confirm their details and book the appointment.",
        icon: CalendarCheck,
    },
    {
        useCase: "Customer support",
        callType: "inbound",
        description:
            "Answer common questions about orders, delivery and returns, and offer to pass the caller to a human when you can't help.",
        icon: Headphones,
    },
    {
        useCase: "Receptionist",
        callType: "inbound",
        description:
            "Greet callers, find out why they're calling, take a message with their name and number, and tell them when to expect a call back.",
        icon: PhoneIncoming,
    },
    {
        useCase: "Appointment reminders",
        callType: "outbound",
        description:
            "Call customers the day before their appointment, confirm they're still coming, and reschedule if they can't make it.",
        icon: BellRing,
    },
    {
        useCase: "Feedback survey",
        callType: "outbound",
        description:
            "Call recent customers, ask three short questions about their experience, and note anything that needs a follow-up.",
        icon: ClipboardList,
    },
];

/** Link to the AI agent builder, optionally prefilled. */
export function createAgentHref(
    prefill: Partial<Pick<AgentIdea, "useCase" | "callType" | "description">> = {},
): string {
    const params = new URLSearchParams();
    if (prefill.callType) params.set("call_type", prefill.callType);
    if (prefill.useCase) params.set("use_case", prefill.useCase);
    if (prefill.description) params.set("description", prefill.description);
    const query = params.toString();
    return query ? `/workflow/create?${query}` : "/workflow/create";
}
