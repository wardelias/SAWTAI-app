'use client';

import {
    AlertCircle,
    ArrowRight,
    ArrowUp,
    Building2,
    CalendarClock,
    Check,
    Loader2,
    MailPlus,
    PhoneForwarded,
    Plus,
    Smile,
    Sparkles,
    Square,
    TrendingUp,
    X,
} from 'lucide-react';
import Link from 'next/link';
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
    type CopilotEvent,
    fetchCopilotConversation,
    fetchCopilotStatus,
    streamCopilotChat,
} from '@/lib/agentCopilot';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

import { applyCopilotEvent, type AssistantPart, type ChatMessage, toolLabel } from './transcript';

export interface WorkflowChange {
    workflowId: number;
    workflowName?: string;
    created: boolean;
}

interface AgentCopilotChatProps {
    /** The agent open in the editor, sent as context with every message. */
    workflowId?: number;
    /** Shown in the header when the chat is scoped to one agent. */
    agentName?: string;
    /** Resume this conversation instead of the last one used in this scope. */
    initialConversationId?: string | null;
    /** When set, sending is disabled and this explains why. */
    blockedReason?: string | null;
    onWorkflowChanged?: (change: WorkflowChange) => void;
    onClose?: () => void;
    className?: string;
}

interface Suggestion {
    icon: ReactNode;
    text: string;
}

const EDITOR_SUGGESTIONS: Suggestion[] = [
    { icon: <Smile className="h-4 w-4" />, text: 'Make the greeting warmer and shorter' },
    { icon: <MailPlus className="h-4 w-4" />, text: "Ask for the caller's email before ending the call" },
    { icon: <PhoneForwarded className="h-4 w-4" />, text: 'Transfer to a human if the caller asks for one' },
];

const BUILDER_SUGGESTIONS: Suggestion[] = [
    { icon: <Building2 className="h-4 w-4" />, text: 'Build a receptionist for my dental clinic' },
    { icon: <TrendingUp className="h-4 w-4" />, text: 'Create an outbound agent that qualifies sales leads' },
    { icon: <CalendarClock className="h-4 w-4" />, text: 'Build an appointment reminder agent' },
];

// The last conversation per scope (one agent, or the agents-wide builder),
// so reopening the assistant resumes where the user left off. The
// transcript itself is loaded from the server.
const scopeKey = (workflowId?: number) =>
    `agentCopilot:conversation:${workflowId != null ? `workflow:${workflowId}` : 'builder'}`;

function readStoredConversation(workflowId?: number): string | null {
    try {
        return localStorage.getItem(scopeKey(workflowId));
    } catch {
        return null;
    }
}

function storeConversation(workflowId: number | undefined, conversationId: string | null) {
    try {
        if (conversationId) localStorage.setItem(scopeKey(workflowId), conversationId);
        else localStorage.removeItem(scopeKey(workflowId));
    } catch {
        // Convenience only; the chat works without it.
    }
}

function toChatMessages(raw: unknown[]): ChatMessage[] {
    return raw.map((message) => {
        const m = message as { role: string; text?: string; parts?: AssistantPart[] };
        return m.role === 'user'
            ? { role: 'user', text: m.text ?? '' }
            : { role: 'assistant', pending: false, parts: m.parts ?? [], stepSnapshot: [] };
    });
}

// ─── Rendering ────────────────────────────────────────────────────────────

function renderInline(text: string): ReactNode[] {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((chunk, i) => {
        if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4) {
            return <strong key={i} className="font-semibold">{chunk.slice(2, -2)}</strong>;
        }
        if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
            return (
                <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                    {chunk.slice(1, -1)}
                </code>
            );
        }
        return <Fragment key={i}>{chunk}</Fragment>;
    });
}

const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/;

/** Light markdown: paragraphs, headings, bullet/numbered lists, bold, code. */
function FormattedText({ text }: { text: string }) {
    const blocks = text.trim().split(/\n{2,}/);
    return (
        <div className="space-y-2.5 leading-relaxed">
            {blocks.map((block, i) => {
                const lines = block.split('\n');
                if (lines.every((line) => LIST_ITEM.test(line))) {
                    const ordered = /^\s*\d/.test(lines[0]);
                    const ListTag = ordered ? 'ol' : 'ul';
                    return (
                        <ListTag key={i} className={cn('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc', 'marker:text-muted-foreground')}>
                            {lines.map((line, j) => (
                                <li key={j}>{renderInline(line.replace(LIST_ITEM, ''))}</li>
                            ))}
                        </ListTag>
                    );
                }
                const heading = block.match(/^#{1,4}\s+(.*)$/);
                if (heading && lines.length === 1) {
                    return <p key={i} className="font-semibold">{renderInline(heading[1])}</p>;
                }
                return (
                    <p key={i} className="whitespace-pre-wrap">
                        {renderInline(block)}
                    </p>
                );
            })}
        </div>
    );
}

function ToolStep({ part }: { part: Extract<AssistantPart, { kind: 'tool' }> }) {
    const saved = part.status === 'ok' && part.name === 'save_workflow';
    return (
        <div className="flex items-center gap-2 text-xs">
            <span
                className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center rounded-full',
                    part.status === 'running' && 'text-violet-400',
                    part.status === 'ok' && 'bg-emerald-500/15 text-emerald-500',
                    part.status === 'error' && 'bg-amber-500/15 text-amber-500',
                )}
            >
                {part.status === 'running' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                ) : part.status === 'ok' ? (
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                ) : (
                    <X className="h-2.5 w-2.5" strokeWidth={3} />
                )}
            </span>
            <span className={cn(part.status === 'running' ? 'text-foreground' : 'text-muted-foreground')}>
                {saved ? 'Saved a draft' : toolLabel(part.name)}
                {part.status === 'error' ? ' — retrying' : ''}
            </span>
        </div>
    );
}

type Group =
    | { kind: 'activity'; items: AssistantPart[] }
    | { kind: 'text'; text: string }
    | { kind: 'error'; text: string };

/** Fold consecutive tool steps and progress notes into one activity card. */
function groupParts(parts: AssistantPart[]): Group[] {
    const groups: Group[] = [];
    for (const part of parts) {
        if (part.kind === 'tool' || part.kind === 'progress') {
            const last = groups[groups.length - 1];
            if (last?.kind === 'activity') last.items.push(part);
            else groups.push({ kind: 'activity', items: [part] });
        } else {
            groups.push(part.kind === 'text' ? { kind: 'text', text: part.text } : { kind: 'error', text: part.text });
        }
    }
    return groups;
}

function CreatedAgentCard({
    workflowId,
    workflowName,
    conversationId,
}: {
    workflowId: number;
    workflowName?: string;
    conversationId: string | null;
}) {
    return (
        <Link
            href={`/workflow/${workflowId}${conversationId ? `?copilot=${conversationId}` : ''}`}
            className="group flex items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 px-3.5 py-3 transition hover:border-violet-500/60"
        >
            <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-violet-400">New agent ready</div>
                <div className="truncate font-medium">{workflowName ?? `Agent #${workflowId}`}</div>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-violet-300 transition-all group-hover:gap-2">
                Open <ArrowRight className="h-4 w-4" />
            </span>
        </Link>
    );
}

function AssistantMessage({
    parts,
    pending,
    currentWorkflowId,
    conversationId,
}: {
    parts: AssistantPart[];
    pending: boolean;
    currentWorkflowId?: number;
    conversationId: string | null;
}) {
    const created = parts.filter(
        (p): p is Extract<AssistantPart, { kind: 'tool' }> =>
            p.kind === 'tool' && p.status === 'ok' && p.workflowId != null && p.workflowId !== currentWorkflowId,
    );
    return (
        <div className="flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-sm shadow-violet-500/30">
                <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
                {groupParts(parts).map((group, i) => {
                    if (group.kind === 'text') return <FormattedText key={i} text={group.text} />;
                    if (group.kind === 'error') {
                        return (
                            <div key={i} className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{group.text}</span>
                            </div>
                        );
                    }
                    return (
                        <div key={i} className="space-y-1.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                            {group.items.map((item, j) =>
                                item.kind === 'tool' ? (
                                    <ToolStep key={j} part={item} />
                                ) : item.kind === 'progress' ? (
                                    <p key={j} className="text-xs italic leading-relaxed text-muted-foreground">
                                        {item.text.trim()}
                                    </p>
                                ) : null,
                            )}
                        </div>
                    );
                })}
                {created.map((part) => (
                    <CreatedAgentCard
                        key={part.id}
                        workflowId={part.workflowId as number}
                        workflowName={part.workflowName}
                        conversationId={conversationId}
                    />
                ))}
                {pending && (parts.length === 0 || parts[parts.length - 1].kind === 'text') ? (
                    <div className="flex h-5 items-center gap-1" aria-label="Assistant is thinking">
                        {[0, 150, 300].map((delay) => (
                            <span
                                key={delay}
                                className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
                                style={{ animationDelay: `${delay}ms` }}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

// ─── Status hook ──────────────────────────────────────────────────────────

/** Whether the assistant is configured on this deployment (null while loading). */
export function useCopilotStatus() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const hasFetched = useRef(false);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        (async () => {
            try {
                const status = await fetchCopilotStatus(await getAccessToken());
                setEnabled(status.enabled);
            } catch {
                setEnabled(false);
            }
        })();
    }, [authLoading, user, getAccessToken]);

    return enabled;
}

// ─── Chat ─────────────────────────────────────────────────────────────────

export function AgentCopilotChat({
    workflowId,
    agentName,
    initialConversationId = null,
    blockedReason = null,
    onWorkflowChanged,
    onClose,
    className,
}: AgentCopilotChatProps) {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [restoring, setRestoring] = useState(true);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const onWorkflowChangedRef = useRef(onWorkflowChanged);
    onWorkflowChangedRef.current = onWorkflowChanged;
    const hasRestored = useRef(false);

    // Resume the conversation for this scope from the server.
    useEffect(() => {
        if (authLoading || !user || hasRestored.current) return;
        hasRestored.current = true;
        const id = initialConversationId ?? readStoredConversation(workflowId);
        if (!id) {
            setRestoring(false);
            return;
        }
        (async () => {
            try {
                const conversation = await fetchCopilotConversation(await getAccessToken(), id);
                if (conversation) {
                    setConversationId(conversation.conversation_id);
                    setMessages(toChatMessages(conversation.messages));
                    storeConversation(workflowId, conversation.conversation_id);
                } else {
                    storeConversation(workflowId, null);
                }
            } catch {
                // Start fresh if the history can't be loaded.
            } finally {
                setRestoring(false);
            }
        })();
    }, [authLoading, user, getAccessToken, initialConversationId, workflowId]);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    const updateAssistant = useCallback((event: CopilotEvent) => {
        setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            const next = applyCopilotEvent(last, event);
            return [...prev.slice(0, -1), { ...last, ...next, pending: event.type !== 'done' && last.pending }];
        });
    }, []);

    const send = useCallback(
        async (text: string) => {
            const message = text.trim();
            if (!message || sending || blockedReason) return;
            setDraft('');
            setSending(true);
            setMessages((prev) => [
                ...prev,
                { role: 'user', text: message },
                { role: 'assistant', pending: true, parts: [], stepSnapshot: [] },
            ]);

            const controller = new AbortController();
            abortRef.current = controller;
            try {
                await streamCopilotChat({
                    token: await getAccessToken(),
                    message,
                    conversationId,
                    workflowId,
                    signal: controller.signal,
                    onEvent: (event) => {
                        if (event.type === 'conversation') {
                            setConversationId(event.conversation_id);
                            storeConversation(workflowId, event.conversation_id);
                            return;
                        }
                        if (event.type === 'tool_end' && event.ok && event.workflow_id != null) {
                            onWorkflowChangedRef.current?.({
                                workflowId: event.workflow_id,
                                workflowName: event.workflow_name,
                                created: event.name === 'create_workflow',
                            });
                        }
                        updateAssistant(event);
                    },
                });
            } catch (err) {
                updateAssistant({
                    type: 'error',
                    message: controller.signal.aborted
                        ? 'Stopped.'
                        : err instanceof Error
                            ? err.message
                            : 'Something went wrong. Please try again.',
                });
            } finally {
                updateAssistant({ type: 'done' });
                abortRef.current = null;
                setSending(false);
                inputRef.current?.focus();
            }
        },
        [blockedReason, conversationId, getAccessToken, sending, updateAssistant, workflowId],
    );

    const startNewChat = () => {
        abortRef.current?.abort();
        setConversationId(null);
        setMessages([]);
        storeConversation(workflowId, null);
        inputRef.current?.focus();
    };

    const editing = workflowId != null;
    const suggestions = editing ? EDITOR_SUGGESTIONS : BUILDER_SUGGESTIONS;
    const inputDisabled = sending || Boolean(blockedReason);

    return (
        <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-transparent px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-md shadow-violet-500/25">
                        <Sparkles className="h-4 w-4 text-white" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold leading-tight">AI Assistant</div>
                        <div className="truncate text-xs text-muted-foreground">
                            {editing ? (agentName ? `Editing ${agentName}` : 'Editing this agent') : 'Create and edit your agents'}
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {messages.length > 0 ? (
                        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={startNewChat} disabled={sending}>
                            <Plus className="h-3.5 w-3.5" />
                            New chat
                        </Button>
                    ) : null}
                    {onClose ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close assistant">
                            <X className="h-4 w-4" />
                        </Button>
                    ) : null}
                </div>
            </div>

            {/* Conversation */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 text-sm">
                {restoring ? (
                    <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex min-h-full flex-col justify-center gap-6 py-4">
                        <div className="space-y-3 text-center">
                            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/30">
                                <Sparkles className="h-6 w-6 text-white" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-base font-semibold">
                                    {editing ? 'What should this agent do differently?' : 'What should your agent do?'}
                                </h3>
                                <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                                    {editing
                                        ? 'Describe the change. I save it as a draft, so your live agent keeps working until you publish.'
                                        : "Describe the calls it handles. I'll ask a few questions, then build it for you."}
                                </p>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            {suggestions.map((suggestion) => (
                                <button
                                    key={suggestion.text}
                                    type="button"
                                    onClick={() => void send(suggestion.text)}
                                    disabled={inputDisabled}
                                    className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3.5 py-3 text-left text-sm transition hover:border-violet-500/50 hover:bg-violet-500/5 disabled:pointer-events-none disabled:opacity-50"
                                >
                                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-400 transition group-hover:bg-violet-500/20">
                                        {suggestion.icon}
                                    </span>
                                    <span className="flex-1">{suggestion.text}</span>
                                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {messages.map((msg, i) =>
                            msg.role === 'user' ? (
                                <div key={i} className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-200">
                                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-violet-600 to-fuchsia-600 px-3.5 py-2 text-white shadow-sm">
                                        {msg.text}
                                    </div>
                                </div>
                            ) : (
                                <AssistantMessage
                                    key={i}
                                    parts={msg.parts}
                                    pending={msg.pending}
                                    currentWorkflowId={workflowId}
                                    conversationId={conversationId}
                                />
                            ),
                        )}
                    </div>
                )}
            </div>

            {/* Composer */}
            <div className="border-t border-border/70 p-3">
                {blockedReason ? (
                    <div className="mb-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {blockedReason}
                    </div>
                ) : null}
                <div className="rounded-2xl border border-border bg-card shadow-sm transition focus-within:border-violet-500/60 focus-within:ring-2 focus-within:ring-violet-500/20">
                    <textarea
                        ref={inputRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={editing ? 'Describe a change…' : 'Describe the agent you want…'}
                        rows={1}
                        disabled={inputDisabled}
                        aria-label="Message the AI assistant"
                        className="block max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                void send(draft);
                            }
                        }}
                    />
                    <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
                        <span className="pl-1 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
                        {sending ? (
                            <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                onClick={() => abortRef.current?.abort()}
                                className="h-8 w-8 rounded-full"
                                aria-label="Stop"
                            >
                                <Square className="h-3 w-3 fill-current" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="icon"
                                onClick={() => void send(draft)}
                                disabled={!draft.trim() || Boolean(blockedReason)}
                                className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm hover:opacity-90 disabled:from-muted disabled:to-muted disabled:text-muted-foreground"
                                aria-label="Send"
                            >
                                <ArrowUp className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
