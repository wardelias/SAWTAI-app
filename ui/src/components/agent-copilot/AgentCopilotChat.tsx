'use client';

import { AlertCircle, Check, Loader2, Sparkles, Square, X } from 'lucide-react';
import Link from 'next/link';
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { type CopilotEvent, fetchCopilotStatus, streamCopilotChat } from '@/lib/agentCopilot';
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
    /** Resume a conversation (e.g. one started on the standalone page). */
    initialConversationId?: string | null;
    /** When set, sending is disabled and this explains why. */
    blockedReason?: string | null;
    onWorkflowChanged?: (change: WorkflowChange) => void;
    onClose?: () => void;
    className?: string;
}

const EDITOR_SUGGESTIONS = [
    'Make the greeting warmer and shorter',
    "Ask for the caller's email before ending the call",
    'Transfer to a human if the caller asks for one',
];

const BUILDER_SUGGESTIONS = [
    'Build a receptionist for my dental clinic',
    'Create an outbound agent that qualifies sales leads',
    'Build an appointment reminder agent',
];

const transcriptKey = (conversationId: string) => `agentCopilot:transcript:${conversationId}`;

function loadTranscript(conversationId: string): ChatMessage[] {
    try {
        const raw = sessionStorage.getItem(transcriptKey(conversationId));
        return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    } catch {
        return [];
    }
}

function saveTranscript(conversationId: string, messages: ChatMessage[]) {
    try {
        sessionStorage.setItem(transcriptKey(conversationId), JSON.stringify(messages));
    } catch {
        // Display-only convenience; the server keeps the real history.
    }
}

/** Minimal formatting for assistant text: paragraphs, bullet lists, **bold**. */
function renderInline(text: string): ReactNode[] {
    return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
        chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4 ? (
            <strong key={i}>{chunk.slice(2, -2)}</strong>
        ) : (
            <Fragment key={i}>{chunk.replace(/`([^`]+)`/g, '$1')}</Fragment>
        ),
    );
}

function FormattedText({ text }: { text: string }) {
    const blocks = text.trim().split(/\n{2,}/);
    return (
        <div className="space-y-2">
            {blocks.map((block, i) => {
                const lines = block.split('\n');
                if (lines.every((line) => /^\s*([-*]|\d+\.)\s+/.test(line))) {
                    return (
                        <ul key={i} className="list-disc space-y-1 pl-5">
                            {lines.map((line, j) => (
                                <li key={j}>{renderInline(line.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>
                            ))}
                        </ul>
                    );
                }
                return (
                    <p key={i} className="whitespace-pre-wrap">
                        {renderInline(block.replace(/^#+\s+/gm, ''))}
                    </p>
                );
            })}
        </div>
    );
}

function AssistantPartView({
    part,
    currentWorkflowId,
    conversationId,
}: {
    part: AssistantPart;
    currentWorkflowId?: number;
    conversationId: string | null;
}) {
    switch (part.kind) {
        case 'text':
            return <FormattedText text={part.text} />;
        case 'progress':
            return <p className="text-xs italic text-muted-foreground">{part.text}</p>;
        case 'error':
            return (
                <p className="flex items-start gap-1.5 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {part.text}
                </p>
            );
        case 'tool': {
            const createdElsewhere =
                part.status === 'ok' && part.workflowId != null && part.workflowId !== currentWorkflowId;
            return (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {part.status === 'running' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : part.status === 'ok' ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                        <X className="h-3 w-3 text-amber-600" />
                    )}
                    <span>{toolLabel(part.name)}</span>
                    {createdElsewhere ? (
                        <Link
                            href={`/workflow/${part.workflowId}${conversationId ? `?copilot=${conversationId}` : ''}`}
                            className="font-medium text-primary underline"
                        >
                            Open {part.workflowName ?? 'agent'}
                        </Link>
                    ) : null}
                </div>
            );
        }
    }
}

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

export function AgentCopilotChat({
    workflowId,
    initialConversationId = null,
    blockedReason = null,
    onWorkflowChanged,
    onClose,
    className,
}: AgentCopilotChatProps) {
    const { getAccessToken } = useAuth();
    const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
    const [messages, setMessages] = useState<ChatMessage[]>(() =>
        initialConversationId ? loadTranscript(initialConversationId) : [],
    );
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const onWorkflowChangedRef = useRef(onWorkflowChanged);
    onWorkflowChangedRef.current = onWorkflowChanged;

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [messages]);

    useEffect(() => {
        if (conversationId && !sending) saveTranscript(conversationId, messages);
    }, [conversationId, messages, sending]);

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
                if (!controller.signal.aborted) {
                    updateAssistant({
                        type: 'error',
                        message: err instanceof Error ? err.message : 'Something went wrong.',
                    });
                }
            } finally {
                updateAssistant({ type: 'done' });
                abortRef.current = null;
                setSending(false);
            }
        },
        [blockedReason, conversationId, getAccessToken, sending, updateAssistant, workflowId],
    );

    const startNewChat = () => {
        abortRef.current?.abort();
        setConversationId(null);
        setMessages([]);
    };

    const suggestions = workflowId != null ? EDITOR_SUGGESTIONS : BUILDER_SUGGESTIONS;

    return (
        <div className={cn('flex h-full min-h-0 flex-col', className)}>
            <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <div>
                        <div className="text-sm font-semibold">AI assistant</div>
                        <div className="text-xs text-muted-foreground">
                            {workflowId != null ? 'Describe changes to this agent' : 'Describe the agent you want'}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {messages.length > 0 ? (
                        <Button variant="ghost" size="sm" onClick={startNewChat} disabled={sending}>
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

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
                {messages.length === 0 ? (
                    <div className="space-y-3">
                        <p className="text-muted-foreground">
                            {workflowId != null
                                ? 'Tell me what to change. I save edits as a draft, so your live agent keeps working until you publish.'
                                : "Tell me what your agent should do. I'll ask a few questions, then build it for you."}
                        </p>
                        <div className="flex flex-col gap-2">
                            {suggestions.map((suggestion) => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => void send(suggestion)}
                                    disabled={sending || Boolean(blockedReason)}
                                    className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((msg, i) =>
                        msg.role === 'user' ? (
                            <div key={i} className="ml-8 whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-primary-foreground">
                                {msg.text}
                            </div>
                        ) : (
                            <div key={i} className="mr-4 space-y-2">
                                {msg.parts.map((part, j) => (
                                    <AssistantPartView
                                        key={j}
                                        part={part}
                                        currentWorkflowId={workflowId}
                                        conversationId={conversationId}
                                    />
                                ))}
                                {msg.pending && msg.parts.length === 0 ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                ) : null}
                            </div>
                        ),
                    )
                )}
            </div>

            <div className="border-t p-3">
                {blockedReason ? <p className="mb-2 text-xs text-amber-700">{blockedReason}</p> : null}
                <div className="relative">
                    <Textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={workflowId != null ? 'e.g. Ask for the caller’s budget' : 'e.g. A receptionist that books appointments'}
                        rows={2}
                        className="resize-none pr-16 text-sm"
                        disabled={sending || Boolean(blockedReason)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                void send(draft);
                            }
                        }}
                    />
                    {sending ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => abortRef.current?.abort()}
                            className="absolute bottom-1.5 right-1.5 h-8"
                            aria-label="Stop"
                        >
                            <Square className="h-3.5 w-3.5" />
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => void send(draft)}
                            disabled={!draft.trim() || Boolean(blockedReason)}
                            className="absolute bottom-1.5 right-1.5 h-8"
                        >
                            Send
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
