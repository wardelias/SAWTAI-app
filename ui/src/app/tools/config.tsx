"use client";

import { Calculator, CalendarClock, Cog, Globe, type LucideIcon, PhoneForwarded, PhoneOff, Puzzle, Sparkles } from "lucide-react";
import { type ReactNode } from "react";

import type {
    CalculatorToolDefinition,
    EndCallConfig,
    EndCallToolDefinition,
    HttpApiToolDefinition,
    McpToolDefinition,
    TransferCallConfig,
    TransferCallToolDefinition,
} from "@/client/types.gen";

export type ToolCategory = "http_api" | "end_call" | "transfer_call" | "calculator" | "native" | "integration" | "mcp" | "behavior" | "book_meeting";

export type BehaviorScope = "global" | "node";

// Behavior tools inject curated instructions into the agent's system prompt
// instead of registering a callable function. Defined locally because the
// generated client (types.gen) does not yet include this tool type.
export interface BehaviorConfig {
    instructions: string;
    scope: BehaviorScope;
    preset_id?: string | null;
    special?: string | null;
}

export interface BehaviorToolDefinition {
    schema_version: number;
    type: "behavior";
    config: BehaviorConfig;
}

// Built-in Behavior presets shown in the editor's "Start from a preset" picker.
// Mirrors api/services/workflow/behaviors/presets.py. `special` flags are
// preserved on save so e.g. the gender preset still enables voice detection.
export interface BehaviorPreset {
    id: string;
    name: string;
    description: string;
    instructions: string;
    special?: string;
    // Highlighted as "Recommended" and surfaced first in the preset picker.
    recommended?: boolean;
}

export const BEHAVIOR_PRESETS: BehaviorPreset[] = [
    {
        id: "caller_gender_adaptation",
        name: "Caller Gender Adaptation",
        description: "Detect the caller's gender from voice and adapt gendered language (Arabic, Hebrew).",
        instructions:
            "When the caller's gender is known, address them using the matching gendered second-person forms (verb conjugations, pronouns, adjectives) in grammatically gendered languages such as Arabic or Hebrew. If the caller states or implies a different gender, follow their lead. Never mention this inference to the caller.",
        special: "voice_gender_detection",
        recommended: true,
    },
    {
        id: "arabic_feminine_pronunciation",
        name: "Arabic Feminine Pronunciation",
        description: "Force feminine Arabic pronunciation for female callers using tashkeel (diacritics).",
        instructions:
            "For female callers speaking Arabic, force the correct feminine pronunciation in text-to-speech. Undiacritized Arabic spells masculine and feminine address identically, so the voice defaults to masculine. For every gendered word addressed to the caller (not just the first one): add the diacritic (tashkeel) that makes the feminine reading explicit — especially a kasra under the second-person kaf ـكِ, e.g. write أساعِدُكِ (not أساعدك), شُكراً لكِ, كيف حالُكِ. Prefer feminine verb forms whose letters already differ: present tense ـِين (تُريدِين، تَستطيعِين), imperative ـي (تفضّلي، قولي), and the pronoun أنتِ / ـكِ.",
        recommended: true,
    },
    {
        id: "no_ai_disclosure",
        name: "Stay in Character",
        description: "Never claim or imply that the agent is an AI or a bot.",
        instructions:
            "Stay in character as a human representative. Do not claim or imply that you are an AI, bot, or automated system. If asked directly whether you are a robot, deflect politely and continue helping.",
    },
    {
        id: "concise_voice_replies",
        name: "Concise Voice Replies",
        description: "Keep answers short and spoken-style; no markdown or lists.",
        instructions:
            "Keep replies short and conversational — usually one or two spoken sentences. Do not use markdown, bullet points, numbered lists, or emojis; your words are spoken aloud.",
    },
    {
        id: "confirm_readback",
        name: "Confirm by Read-back",
        description: "Read back names, emails, and numbers to confirm them.",
        instructions:
            "When the caller gives a name, email address, phone number, or other identifier, read it back to them to confirm before relying on it.",
    },
    {
        id: "empathetic_tone",
        name: "Empathetic Tone",
        description: "Warm, patient, acknowledges the caller's feelings.",
        instructions:
            "Speak warmly and patiently. Acknowledge the caller's feelings and show that you understand their situation before moving the conversation forward.",
    },
    {
        id: "confirm_before_end_or_transfer",
        name: "Confirm Before Ending",
        description: "Check the caller is ready before ending or transferring.",
        instructions:
            "Before ending the call or transferring it, briefly confirm with the caller that they are ready and have no other questions.",
    },
    {
        id: "mirror_caller_language",
        name: "Mirror Caller's Language",
        description: "Respond in the caller's language and dialect.",
        instructions:
            "Respond in the same language and dialect the caller uses. If they switch languages mid-conversation, switch with them.",
    },
    {
        id: "dnc_compliance",
        name: "Honor Opt-outs",
        description: "Immediately respect do-not-call / opt-out requests.",
        instructions:
            "If the caller asks to opt out, stop being contacted, or be placed on a do-not-call list, acknowledge immediately, stop any sales or persuasion, and confirm they will not be contacted again.",
    },
];

export type EndCallMessageType = "none" | "custom" | "audio";

export interface ToolCategoryConfig {
    value: ToolCategory;
    label: string;
    description: string;
    icon: LucideIcon;
    iconName: string; // String name for storing in database
    iconColor: string;
    disabled?: boolean;
    // Built-in tools are auto-seeded per organization; they are not creatable
    // from the "Create Tool" dialog, so they are filtered out of that picker.
    builtin?: boolean;
    // Surfaced first and badged as "Suggested" in the tools list and the
    // per-agent tool selector.
    suggested?: boolean;
    autoFill?: {
        name: string;
        description: string;
    };
}

export const TOOL_CATEGORIES: ToolCategoryConfig[] = [
    {
        value: "http_api",
        label: "External HTTP API",
        description: "Make HTTP requests to external APIs",
        icon: Globe,
        iconName: "globe",
        iconColor: "#3B82F6",
    },
    {
        value: "end_call",
        label: "End Call",
        description: "End the call when conditions are met",
        icon: PhoneOff,
        iconName: "phone-off",
        iconColor: "#EF4444",
        autoFill: {
            name: "End Call",
            description: "End the call when either user asks to disconnect the call, or when you believe its time to end the conversation",
        },
    },
    {
        value: "transfer_call",
        label: "Transfer Call",
        description: "Transfer the call to another phone number (Twilio only)",
        icon: PhoneForwarded,
        iconName: "phone-forwarded",
        iconColor: "#10B981",
        autoFill: {
            name: "Transfer Call",
            description: "Transfer the caller to another phone number when requested",
        },
    },
    {
        value: "calculator",
        label: "Calculator",
        description: "Built-in calculator for arithmetic operations",
        icon: Calculator,
        iconName: "calculator",
        iconColor: "#F59E0B",
        autoFill: {
            name: "Calculator",
            description: "Perform arithmetic calculations (supports +, -, *, /, **, %, and parentheses)",
        },
    },
    {
        value: "mcp",
        label: "MCP Server",
        description: "Connect a customer MCP server; its tools become available to the agent",
        icon: Puzzle,
        iconName: "puzzle",
        iconColor: "#8B5CF6",
    },
    {
        value: "book_meeting",
        label: "Book Meeting",
        description: "Let the agent book an appointment on the caller's behalf during the call, saved to your built-in Calendar.",
        icon: CalendarClock,
        iconName: "calendar",
        iconColor: "#6366F1",
        builtin: true,
        suggested: true,
    },
    {
        value: "behavior",
        label: "Behavior",
        description: "Inject curated instructions into the agent's prompt (e.g. tone, gender adaptation)",
        icon: Sparkles,
        iconName: "sparkles",
        iconColor: "#A855F7",
        autoFill: {
            name: "New Behavior",
            description: "Guidance injected into the agent's system prompt",
        },
    },
    {
        value: "native",
        label: "Native (Coming Soon)",
        description: "Built-in tools like call transfer, DTMF input",
        icon: Cog,
        iconName: "cog",
        iconColor: "#6B7280",
        disabled: true,
    },
    {
        value: "integration",
        label: "Integration (Coming Soon)",
        description: "Third-party integrations like Google Calendar",
        icon: Puzzle,
        iconName: "puzzle",
        iconColor: "#8B5CF6",
        disabled: true,
    },
];

export function getCategoryConfig(category: ToolCategory): ToolCategoryConfig | undefined {
    return TOOL_CATEGORIES.find(c => c.value === category);
}

export function getToolIcon(category: string): LucideIcon {
    const config = TOOL_CATEGORIES.find(c => c.value === category);
    return config?.icon ?? Globe;
}

export function getToolIconColor(category: string, fallbackColor?: string): string {
    const config = TOOL_CATEGORIES.find(c => c.value === category);
    return config?.iconColor ?? fallbackColor ?? "#3B82F6";
}

export function renderToolIcon(category: string, className: string = "w-5 h-5 text-white"): ReactNode {
    const Icon = getToolIcon(category);
    return <Icon className={className} />;
}

export function getToolTypeLabel(category: string): string {
    switch (category) {
        case "end_call":
            return "End Call Tool";
        case "transfer_call":
            return "Transfer Call Tool";
        case "http_api":
            return "HTTP API Tool";
        case "calculator":
            return "Calculator Tool";
        case "native":
            return "Native Tool";
        case "integration":
            return "Integration Tool";
        case "mcp":
            return "MCP Server Tool";
        case "behavior":
            return "Behavior";
        case "book_meeting":
            return "Book Meeting Tool";
        default:
            return "Tool";
    }
}

// Built-in tools we proactively recommend. Surfaced first and badged as
// "Suggested" in the tools list and the per-agent tool selector.
export function isSuggestedTool(category: string): boolean {
    return TOOL_CATEGORIES.some((c) => c.value === category && c.suggested);
}

export const DEFAULT_END_CALL_REASON_DESCRIPTION =
    "The reason for ending the call (e.g., 'voicemail_detected', 'issue_resolved', 'customer_requested')";

export const DEFAULT_END_CALL_CONFIG: EndCallConfig = {
    messageType: "none",
    customMessage: "",
    endCallReason: false,
};

export const DEFAULT_TRANSFER_CALL_CONFIG: TransferCallConfig = {
    destination: "",
    messageType: "none",
    customMessage: "",
    timeout: 30,
};

export type ToolDefinition =
    | HttpApiToolDefinition
    | EndCallToolDefinition
    | TransferCallToolDefinition
    | CalculatorToolDefinition
    | McpToolDefinition;

export function createEndCallDefinition(config: EndCallConfig): EndCallToolDefinition {
    return {
        schema_version: 1,
        type: "end_call",
        config,
    };
}

export function createTransferCallDefinition(config: TransferCallConfig): TransferCallToolDefinition {
    return {
        schema_version: 1,
        type: "transfer_call",
        config,
    };
}

export function createHttpApiDefinition(): HttpApiToolDefinition {
    return {
        schema_version: 1,
        type: "http_api",
        config: {
            method: "POST",
            url: "",
        },
    };
}

export function createCalculatorDefinition(): CalculatorToolDefinition {
    return {
        schema_version: 1,
        type: "calculator",
    };
}

export function createBehaviorDefinition(
    instructions: string = "",
    scope: BehaviorScope = "global",
    presetId?: string | null,
    special?: string | null,
): BehaviorToolDefinition {
    return {
        schema_version: 1,
        type: "behavior",
        config: {
            instructions,
            scope,
            preset_id: presetId ?? null,
            special: special ?? null,
        },
    };
}

export const MCP_URL_PATTERN = /^https?:\/\//i;

export function createMcpDefinition(
    url: string,
    credentialUuid: string,
    toolsFilterCsv: string,
): McpToolDefinition {
    return {
        schema_version: 1,
        type: "mcp" as const,
        config: {
            transport: "streamable_http" as const,
            url: url.trim(),
            credential_uuid: credentialUuid || null,
            tools_filter: toolsFilterCsv
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
        },
    };
}

export function createToolDefinition(category: ToolCategory): ToolDefinition {
    switch (category) {
        case "end_call":
            return createEndCallDefinition(DEFAULT_END_CALL_CONFIG);
        case "transfer_call":
            return createTransferCallDefinition(DEFAULT_TRANSFER_CALL_CONFIG);
        case "calculator":
            return createCalculatorDefinition();
        case "http_api":
        default:
            return createHttpApiDefinition();
    }
}
