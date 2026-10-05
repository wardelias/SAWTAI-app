/**
 * Client for the agent copilot chat (`/api/v1/agent-copilot`).
 *
 * The chat endpoint streams Server-Sent Events, which the generated SDK can't
 * consume, so this file reads the stream with `fetch` directly. It resolves
 * the backend URL from the generated client's config, the same way the
 * WebRTC hook does.
 */

import { client } from '@/client/client.gen';
import { resolveBrowserBackendUrl } from '@/lib/apiClient';
import { detailFromError } from '@/lib/apiError';

export type CopilotEvent =
    | { type: 'conversation'; conversation_id: string }
    | { type: 'step_start' }
    | { type: 'step_retry' }
    | { type: 'text'; text: string }
    | { type: 'progress'; text: string }
    | { type: 'tool_start'; id: string; name: string }
    | {
          type: 'tool_end';
          id: string;
          name: string;
          ok: boolean;
          workflow_id?: number;
          workflow_name?: string;
          version_number?: number;
          error_code?: string;
      }
    | { type: 'error'; message: string }
    | { type: 'done' };

export interface CopilotStatus {
    /** The organization hasn't switched the assistant off. */
    enabled: boolean;
    /** An API key is available (the organization's own or the platform's). */
    configured: boolean;
    model: string | null;
}

export interface CopilotSettings {
    enabled: boolean;
    /** Masked; empty when the organization has no key of its own. */
    api_key: string;
    has_own_key: boolean;
    platform_key_available: boolean;
    model: string;
    effort: string;
    daily_message_limit: number | null;
    /** The limit in force right now (0 = unlimited). */
    effective_daily_message_limit: number;
    supported_models: string[];
    effort_levels: string[];
}

export interface CopilotSettingsUpdate {
    enabled: boolean;
    /** Send the masked value back to keep the stored key, "" to remove it. */
    api_key: string;
    model: string;
    effort: string;
    daily_message_limit: number | null;
}

function apiBaseUrl(): string {
    return `${client.getConfig().baseUrl || resolveBrowserBackendUrl()}/api/v1/agent-copilot`;
}

async function errorDetail(res: Response): Promise<string> {
    const body = await res.json().catch(() => null);
    return detailFromError(body, `Request failed (${res.status})`);
}

export async function fetchCopilotStatus(token: string): Promise<CopilotStatus> {
    const res = await fetch(`${apiBaseUrl()}/status`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    return (await res.json()) as CopilotStatus;
}

export async function fetchCopilotSettings(token: string): Promise<CopilotSettings> {
    const res = await fetch(`${apiBaseUrl()}/settings`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    return (await res.json()) as CopilotSettings;
}

/** Save settings; a new API key is verified with Anthropic first (throws on rejection). */
export async function saveCopilotSettings(
    token: string,
    update: CopilotSettingsUpdate,
): Promise<CopilotSettings> {
    const res = await fetch(`${apiBaseUrl()}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    return (await res.json()) as CopilotSettings;
}

/** A stored conversation as the chat displays it (see ChatMessage). */
export interface CopilotConversation {
    conversation_id: string;
    messages: unknown[];
}

/** Load a conversation's transcript; null when it no longer exists. */
export async function fetchCopilotConversation(
    token: string,
    conversationId: string,
): Promise<CopilotConversation | null> {
    const res = await fetch(`${apiBaseUrl()}/conversations/${encodeURIComponent(conversationId)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorDetail(res));
    return (await res.json()) as CopilotConversation;
}

/** Split an SSE buffer into complete `data:` payloads plus the unparsed rest. */
export function parseSseChunk(buffer: string): { events: CopilotEvent[]; rest: string } {
    const frames = buffer.split('\n\n');
    const rest = frames.pop() ?? '';
    const events: CopilotEvent[] = [];
    for (const frame of frames) {
        for (const line of frame.split('\n')) {
            if (line.startsWith('data: ')) {
                events.push(JSON.parse(line.slice('data: '.length)) as CopilotEvent);
            }
        }
    }
    return { events, rest };
}

/**
 * Send one message and invoke `onEvent` for each streamed event. Resolves when
 * the stream ends; throws on HTTP errors (e.g. 409 while a reply is running).
 */
export async function streamCopilotChat(options: {
    token: string;
    message: string;
    conversationId?: string | null;
    workflowId?: number;
    signal?: AbortSignal;
    onEvent: (event: CopilotEvent) => void;
}): Promise<void> {
    const res = await fetch(`${apiBaseUrl()}/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.token}`,
        },
        body: JSON.stringify({
            message: options.message,
            conversation_id: options.conversationId ?? null,
            workflow_id: options.workflowId ?? null,
        }),
        signal: options.signal,
    });
    if (!res.ok || !res.body) throw new Error(await errorDetail(res));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseChunk(buffer);
        buffer = rest;
        events.forEach(options.onEvent);
    }
}

// ─── Call insights (Overview) ─────────────────────────────────────────────

export interface CallInsightIssue {
    title: string;
    severity: 'high' | 'medium' | 'low';
    what_happened: string;
    evidence: string;
    suggestion: string;
    needs_change: boolean;
    call_ids: number[];
    agents: { id: number; name: string }[];
}

export interface CallInsightsReport {
    id: string;
    generated_at: string;
    model: string | null;
    summary: string;
    issues: CallInsightIssue[];
    working_well: string[];
    calls_analyzed: number;
    call_ids: number[];
    calls: { call_id: number; agent_id: number; agent: string; outcome: string | null; started_at: string | null }[];
    period: { from: string; to: string } | null;
}

/** The latest stored analysis, or null if none has been run. */
export async function fetchCallInsights(token: string): Promise<CallInsightsReport | null> {
    const res = await fetch(`${apiBaseUrl()}/insights`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    return ((await res.json()) as { report: CallInsightsReport | null }).report;
}

/** Analyze the last 10 calls now (takes up to a minute). */
export async function runCallInsights(token: string): Promise<CallInsightsReport> {
    const res = await fetch(`${apiBaseUrl()}/insights`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    return ((await res.json()) as { report: CallInsightsReport }).report;
}

/**
 * The assistant request for fixing one issue from a stored report. Built
 * from the server's copy of the report (never from URL text), so a link
 * can only point at an issue the organization's own analysis produced.
 */
export function insightFixPrompt(issue: CallInsightIssue): string {
    const calls = issue.call_ids.map((id) => `#${id}`).join(', ');
    return [
        'Fix this issue found in my recent calls:',
        '',
        `Issue: ${issue.title} — ${issue.what_happened}`,
        issue.evidence ? `Evidence: ${issue.evidence}` : '',
        `Suggested change: ${issue.suggestion}`,
        calls ? `Calls: ${calls}` : '',
        '',
        'Read those calls first, then apply the change to this agent as a draft and tell me what you changed.',
    ]
        .filter((line, i, all) => line !== '' || (all[i - 1] ?? '') !== '')
        .join('\n');
}

// ─── Agent builder interview (Create Voice Agent) ─────────────────────────

export interface BuilderOption {
    label: string;
    hint: string;
}

export interface BuilderQuestion {
    section: string;
    question: string;
    helper: string;
    kind: 'single' | 'multi' | 'text';
    options: BuilderOption[];
    allow_custom: boolean;
    placeholder: string;
}

export interface BuilderStep {
    done: boolean;
    /** The next question; null once the interview is done. */
    question: BuilderQuestion | null;
    /** Estimated questions left after this one. */
    remaining: number;
    /** The agent brief, once done. */
    brief: string;
}

export interface BuilderAnswer {
    question: string;
    /** Empty when the question was skipped. */
    answer: string;
}

/** Most AI-written questions in one interview (matches the server's cap). */
export const BUILDER_MAX_QUESTIONS = 10;

/** Ask the AI for the next interview question, or (when done) the agent brief. */
export async function fetchNextBuilderQuestion(
    token: string,
    body: {
        call_type: 'inbound' | 'outbound';
        use_case: string;
        description: string;
        answers: BuilderAnswer[];
        finish?: boolean;
    },
    signal?: AbortSignal,
): Promise<BuilderStep> {
    const res = await fetch(`${apiBaseUrl()}/builder/next-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    return (await res.json()) as BuilderStep;
}
