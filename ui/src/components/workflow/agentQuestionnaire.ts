import {
    BellRing,
    Briefcase,
    CalendarCheck,
    ClipboardList,
    CreditCard,
    Headphones,
    type LucideIcon,
    Package,
    PhoneIncoming,
    PhoneOutgoing,
    Sparkles,
    Target,
} from "lucide-react";

import type { AgentCallType } from "./agentIdeas";

export interface ChoiceOption {
    value: string;
    label: string;
    hint?: string;
    icon?: LucideIcon;
}

export interface GoalOption extends ChoiceOption {
    callTypes: AgentCallType[];
    /** Things this kind of agent usually needs to find out. */
    collects: string[];
    /** Outcome preselected when the goal is picked. */
    outcome: string;
}

export const DIRECTION_OPTIONS: ChoiceOption[] = [
    { value: "inbound", label: "People call the agent", hint: "Answers your phone line", icon: PhoneIncoming },
    { value: "outbound", label: "The agent calls people", hint: "Reaches out to your contacts", icon: PhoneOutgoing },
];

export const GOAL_OPTIONS: GoalOption[] = [
    {
        value: "Lead qualification",
        label: "Qualify leads",
        hint: "Find out who's ready to buy",
        icon: Target,
        callTypes: ["outbound", "inbound"],
        collects: ["Full name", "Budget", "Timeline", "Needs"],
        outcome: "book",
    },
    {
        value: "Appointment booking",
        label: "Book appointments",
        hint: "Find a time and put it in the calendar",
        icon: CalendarCheck,
        callTypes: ["inbound", "outbound"],
        collects: ["Full name", "Preferred date & time", "Reason for the visit"],
        outcome: "book",
    },
    {
        value: "Customer support",
        label: "Answer support questions",
        hint: "Orders, delivery, returns, FAQs",
        icon: Headphones,
        callTypes: ["inbound"],
        collects: ["Full name", "Order number", "Reason for calling"],
        outcome: "resolve",
    },
    {
        value: "Receptionist",
        label: "Receptionist",
        hint: "Greet, route and take messages",
        icon: PhoneIncoming,
        callTypes: ["inbound"],
        collects: ["Full name", "Reason for calling", "Best callback number"],
        outcome: "message",
    },
    {
        value: "Order status",
        label: "Order & delivery updates",
        hint: "Tell callers where their order is",
        icon: Package,
        callTypes: ["inbound", "outbound"],
        collects: ["Order number", "Full name"],
        outcome: "resolve",
    },
    {
        value: "Appointment reminders",
        label: "Appointment reminders",
        hint: "Confirm, cancel or reschedule",
        icon: BellRing,
        callTypes: ["outbound"],
        collects: ["Attendance confirmation", "New date & time if rescheduling"],
        outcome: "book",
    },
    {
        value: "Lead reactivation",
        label: "Re-engage old leads",
        hint: "Wake up contacts that went quiet",
        icon: Sparkles,
        callTypes: ["outbound"],
        collects: ["Current interest level", "Timeline", "Needs"],
        outcome: "book",
    },
    {
        value: "Payment reminders",
        label: "Payment reminders",
        hint: "Polite nudges about due payments",
        icon: CreditCard,
        callTypes: ["outbound"],
        collects: ["Payment commitment date", "Reason for the delay"],
        outcome: "commit",
    },
    {
        value: "Feedback survey",
        label: "Feedback survey",
        hint: "Short satisfaction questions",
        icon: ClipboardList,
        callTypes: ["outbound"],
        collects: ["Satisfaction score", "What went well", "What to improve"],
        outcome: "end",
    },
    {
        value: "Recruiting screening",
        label: "Screen candidates",
        hint: "First-round interview questions",
        icon: Briefcase,
        callTypes: ["outbound", "inbound"],
        collects: ["Full name", "Years of experience", "Availability", "Salary expectations"],
        outcome: "book",
    },
];

export const OTHER_GOAL = "other";

export const INDUSTRY_OPTIONS = [
    "Real estate",
    "Healthcare & clinics",
    "E-commerce & retail",
    "Automotive",
    "Financial services",
    "Insurance",
    "Education",
    "Hospitality & travel",
    "Home services",
    "SaaS & tech",
];

export const AUDIENCE_OPTIONS = [
    "New leads",
    "Existing customers",
    "Past or inactive customers",
    "Patients",
    "Job candidates",
    "General public",
];

export const LANGUAGE_OPTIONS = [
    "English",
    "Arabic (Levantine)",
    "Arabic (Gulf)",
    "Arabic (Egyptian)",
    "Arabic (Modern Standard)",
    "Hebrew",
    "French",
    "Spanish",
    "Russian",
];

export const VOICE_OPTIONS: ChoiceOption[] = [
    { value: "female", label: "Female voice" },
    { value: "male", label: "Male voice" },
    { value: "any", label: "No preference" },
];

export const TONE_OPTIONS: ChoiceOption[] = [
    { value: "Warm and friendly", label: "Warm & friendly", hint: "Like a helpful neighbour" },
    { value: "Professional and formal", label: "Professional", hint: "Polished and to the point" },
    { value: "Energetic and persuasive", label: "Energetic sales", hint: "Upbeat, confident, drives action" },
    { value: "Calm and reassuring", label: "Calm & reassuring", hint: "Patient, good for sensitive topics" },
];

export const COLLECT_OPTIONS = [
    "Full name",
    "Email",
    "Best callback number",
    "Budget",
    "Timeline",
    "Needs",
    "Location or area",
    "Preferred date & time",
    "Reason for calling",
    "Order number",
    "Decision maker",
    "Current interest level",
];

export const OUTCOME_OPTIONS: ChoiceOption[] = [
    { value: "book", label: "Book a meeting", hint: "Saves it to your Calendar" },
    { value: "transfer", label: "Transfer to a person", hint: "Warm hand-off to your team" },
    { value: "message", label: "Take a message", hint: "Your team calls back" },
    { value: "resolve", label: "Answer and resolve", hint: "No follow-up needed" },
    { value: "commit", label: "Get a commitment", hint: "A date, a yes, a next step" },
    { value: "end", label: "Thank them and end", hint: "Just collect the answers" },
];

const OUTCOME_SENTENCES: Record<string, string> = {
    book: "Book a meeting at a time that suits the caller and confirm the date and time back to them.",
    transfer: "Transfer the caller to a human team member once the details are collected.",
    message: "Take a clear message and tell the caller when to expect a call back.",
    resolve: "Answer the caller's question fully so no follow-up is needed.",
    commit: "Get a clear commitment for the next step, including a specific date.",
    end: "Thank the caller for their time and end the call politely.",
};

export const HANDOFF_OPTIONS = [
    "The caller asks for a human",
    "The caller is upset or angry",
    "The caller isn't interested",
    "It's a wrong number",
    "A question it can't answer",
    "The caller asks to be removed from the list",
];

const HANDOFF_SENTENCES: Record<string, string> = {
    "The caller asks for a human": "If the caller asks for a human, offer to transfer them or arrange a call back.",
    "The caller is upset or angry": "If the caller is upset, stay calm, apologise, and offer a human follow-up.",
    "The caller isn't interested": "If the caller isn't interested, thank them and end the call without pushing.",
    "It's a wrong number": "If it's a wrong number, apologise briefly and end the call.",
    "A question it can't answer": "Never guess: if it doesn't know an answer, say so and offer a call back from the team.",
    "The caller asks to be removed from the list":
        "If the caller asks not to be contacted again, confirm it and end the call.",
};

export const LENGTH_OPTIONS: ChoiceOption[] = [
    { value: "Keep calls short, under 2 minutes", label: "Quick", hint: "Under 2 min" },
    { value: "Aim for 2 to 5 minutes", label: "Standard", hint: "2 to 5 min" },
    { value: "Take the time needed for a detailed conversation", label: "In depth", hint: "As long as needed" },
];

export interface QuestionnaireAnswers {
    callType: AgentCallType | "";
    goal: string;
    goalOther: string;
    goalDetails: string;
    businessName: string;
    industry: string;
    offering: string;
    audience: string[];
    languages: string[];
    matchCallerLanguage: boolean;
    agentName: string;
    voice: string;
    tone: string;
    collect: string[];
    mustAsk: string;
    outcome: string;
    handoff: string[];
    neverDo: string;
    knowledge: string;
    length: string;
}

export const EMPTY_ANSWERS: QuestionnaireAnswers = {
    callType: "",
    goal: "",
    goalOther: "",
    goalDetails: "",
    businessName: "",
    industry: "",
    offering: "",
    audience: [],
    languages: [],
    matchCallerLanguage: true,
    agentName: "",
    voice: "any",
    tone: "",
    collect: [],
    mustAsk: "",
    outcome: "",
    handoff: [],
    neverDo: "",
    knowledge: "",
    length: "",
};

/** Seeds answers from the builder links (?call_type=&use_case=&description=). */
export function answersFromPrefill(prefill: {
    callType?: string | null;
    useCase?: string | null;
    description?: string | null;
}): QuestionnaireAnswers {
    const answers: QuestionnaireAnswers = { ...EMPTY_ANSWERS };
    if (prefill.callType === "inbound" || prefill.callType === "outbound") answers.callType = prefill.callType;
    const useCase = prefill.useCase?.trim();
    if (useCase) {
        const goal = findGoal(useCase);
        if (goal) {
            answers.goal = goal.value;
            answers.collect = [...goal.collects];
            answers.outcome = goal.outcome;
        } else {
            answers.goal = OTHER_GOAL;
            answers.goalOther = useCase;
        }
    }
    if (prefill.description?.trim()) answers.goalDetails = prefill.description.trim();
    return answers;
}

export function findGoal(value: string): GoalOption | undefined {
    const key = value.trim().toLowerCase();
    return GOAL_OPTIONS.find((g) => g.value.toLowerCase() === key || g.label.toLowerCase() === key);
}

/** Goals that fit the chosen call direction, best matches first. */
export function goalsFor(callType: AgentCallType | ""): GoalOption[] {
    if (!callType) return GOAL_OPTIONS;
    return GOAL_OPTIONS.filter((g) => g.callTypes.includes(callType));
}

export function resolveUseCase(answers: QuestionnaireAnswers): string {
    return answers.goal === OTHER_GOAL ? answers.goalOther.trim() : answers.goal;
}

function joinList(items: string[]): string {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Turns the answers into the brief the AI uses to write the agent's prompts
 * and call flow. Empty answers are left out rather than guessed.
 */
export function buildAgentBrief(answers: QuestionnaireAnswers): string {
    const lines: string[] = [];
    const business = answers.businessName.trim();
    const useCase = resolveUseCase(answers);
    const direction =
        answers.callType === "outbound"
            ? "places outbound calls"
            : answers.callType === "inbound"
              ? "answers inbound calls"
              : "handles calls";

    const who = [business && `for ${business}`, answers.industry && `(${answers.industry})`].filter(Boolean).join(" ");
    lines.push(`Build a voice agent that ${direction}${who ? ` ${who}` : ""}${useCase ? ` to handle ${useCase.toLowerCase()}` : ""}.`);
    if (answers.offering.trim()) lines.push(`What the business offers: ${answers.offering.trim()}`);
    if (answers.goalDetails.trim()) lines.push(`What the agent should do: ${answers.goalDetails.trim()}`);
    if (answers.audience.length) lines.push(`It talks to: ${joinList(answers.audience).toLowerCase()}.`);

    const persona: string[] = [];
    if (answers.agentName.trim()) persona.push(`introduce itself as ${answers.agentName.trim()}`);
    if (answers.voice === "female" || answers.voice === "male") persona.push(`use a ${answers.voice} voice`);
    if (answers.tone) persona.push(`sound ${answers.tone.toLowerCase()}`);
    if (persona.length) lines.push(`Persona: ${joinList(persona)}.`);

    if (answers.languages.length) {
        const languages = `Speak ${joinList(answers.languages)}`;
        lines.push(
            answers.matchCallerLanguage && answers.languages.length > 1
                ? `${languages}, switching to whichever of these the caller uses.`
                : `${languages}.`,
        );
    }

    if (answers.collect.length) lines.push(`Collect: ${joinList(answers.collect).toLowerCase()}.`);
    if (answers.mustAsk.trim()) lines.push(`Questions it must ask: ${answers.mustAsk.trim()}`);
    if (answers.outcome) lines.push(`Goal of a successful call: ${OUTCOME_SENTENCES[answers.outcome] ?? answers.outcome}`);
    for (const rule of answers.handoff) lines.push(HANDOFF_SENTENCES[rule] ?? rule);
    if (answers.neverDo.trim()) lines.push(`Never: ${answers.neverDo.trim()}`);
    if (answers.knowledge.trim()) lines.push(`Facts it should know: ${answers.knowledge.trim()}`);
    if (answers.length) lines.push(`${answers.length}.`);

    return lines.join("\n");
}
