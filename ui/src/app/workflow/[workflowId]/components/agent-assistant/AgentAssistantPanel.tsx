"use client";

import {
    ArrowUp,
    Check,
    ChevronDown,
    Copy,
    Lightbulb,
    ListChecks,
    MessageCircleQuestion,
    RefreshCw,
    RotateCcw,
    Scissors,
    ShieldAlert,
    Smile,
    Sparkles,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AgentAssistantSuggestion } from "@/client/types.gen";
import type { FlowNode } from "@/components/flow/types";
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import type { AgentAssistantChat } from "./useAgentAssistantChat";

const QUICK_PROMPTS = [
    {
        label: "Review my agent",
        icon: ListChecks,
        prompt: "Review this agent and tell me the three issues most likely to hurt a real call, with a fix for each.",
    },
    {
        label: "Sound more natural",
        icon: Smile,
        prompt: "Rewrite the prompts so the agent sounds warmer and more natural on the phone, keeping the same flow.",
    },
    {
        label: "Shorter replies",
        icon: Scissors,
        prompt: "Make the agent's turns shorter and more conversational so callers can jump in.",
    },
    {
        label: "Handle objections",
        icon: ShieldAlert,
        prompt: "Improve how the agent handles objections like \"not interested\", \"too expensive\" or \"call me later\".",
    },
    {
        label: "Explain the call flow",
        icon: MessageCircleQuestion,
        prompt: "Walk me through what happens on a call with this agent, step by step.",
    },
    {
        label: "What's missing?",
        icon: Lightbulb,
        prompt: "What situations could a caller bring up that this agent isn't prepared for?",
    },
];

interface AgentAssistantPanelProps {
    agentName: string;
    chat: AgentAssistantChat;
    /** Current editor graph, including unsaved edits. */
    getWorkflowDefinition: () => Record<string, unknown>;
    nodes: FlowNode[];
    focusNodeId?: string | null;
    readOnly?: boolean;
    onApplySuggestion: (suggestion: AgentAssistantSuggestion) => boolean;
    onClose?: () => void;
    /** Pre-filled composer text, e.g. "Improve the Greeting step". */
    draft?: string;
    onDraftConsumed?: () => void;
    className?: string;
}

export function AgentAssistantPanel({
    agentName,
    chat,
    getWorkflowDefinition,
    nodes,
    focusNodeId,
    readOnly = false,
    onApplySuggestion,
    onClose,
    draft,
    onDraftConsumed,
    className,
}: AgentAssistantPanelProps) {
    const { messages, pending, error, send, markApplied, reset, takeBackLastUserMessage } = chat;
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const focusNode = focusNodeId ? nodes.find((n) => n.id === focusNodeId) : undefined;

    // Consuming the draft re-runs the effect below, so the focus timer can't be
    // tied to that effect's cleanup; clear it only on unmount.
    const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    }, []);

    useEffect(() => {
        if (!draft) return;
        setInput(draft);
        onDraftConsumed?.();
        // Defer so the sheet's open animation doesn't steal focus back.
        focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 250);
    }, [draft, onDraftConsumed]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [messages.length, pending, error]);

    const submit = (text: string) => {
        if (!text.trim() || pending) return;
        void send(text, { workflowDefinition: getWorkflowDefinition(), focusNodeId });
        setInput("");
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit(input);
        }
    };

    const handleRetry = () => {
        const text = takeBackLastUserMessage();
        if (text) submit(text);
    };

    return (
        <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
            <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ai text-ai-foreground">
                    <Sparkles className="h-[1.1rem] w-[1.1rem]" />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold leading-tight">AI Assistant</h2>
                    <p className="truncate text-xs text-muted-foreground">Knows {agentName}&apos;s prompts and call flow</p>
                </div>
                {messages.length > 0 && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={reset}
                        aria-label="Start a new chat"
                        className="h-9 w-9 text-muted-foreground"
                    >
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                )}
                {onClose && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        aria-label="Close assistant"
                        className="h-9 w-9 text-muted-foreground"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                {messages.length === 0 ? (
                    <div className="flex flex-col gap-5">
                        <div className="rounded-2xl border border-ai/25 bg-ai/[0.06] p-4">
                            <p className="text-sm font-medium">Hi! I can review and improve this agent.</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Ask anything about how it handles calls, or tell me what to change. I&apos;ll suggest
                                new prompts you can apply with one tap.
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {QUICK_PROMPTS.map(({ label, icon: Icon, prompt }) => (
                                <button
                                    key={label}
                                    type="button"
                                    disabled={pending}
                                    onClick={() => submit(prompt)}
                                    className="flex items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left text-xs font-medium transition-colors hover:border-ai/40 hover:bg-ai/[0.05] active:bg-ai/10 disabled:opacity-50"
                                >
                                    <Icon className="h-4 w-4 shrink-0 text-ai" />
                                    <span className="min-w-0">{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <ol className="flex flex-col gap-4">
                        {messages.map((message) =>
                            message.role === "user" ? (
                                <li key={message.id} className="flex justify-end">
                                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
                                        {message.content}
                                    </p>
                                </li>
                            ) : (
                                <li key={message.id} className="flex gap-2.5">
                                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai/15 text-ai">
                                        <Sparkles className="h-3.5 w-3.5" />
                                    </span>
                                    <div className="min-w-0 flex-1 space-y-3">
                                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                                        {message.suggestions.map((suggestion) => (
                                            <SuggestionCard
                                                key={suggestion.node_id}
                                                suggestion={suggestion}
                                                currentPrompt={
                                                    (nodes.find((n) => n.id === suggestion.node_id)?.data.prompt as
                                                        | string
                                                        | undefined) ?? ""
                                                }
                                                applied={message.applied.includes(suggestion.node_id)}
                                                readOnly={readOnly}
                                                onApply={() => {
                                                    if (onApplySuggestion(suggestion)) {
                                                        markApplied(message.id, suggestion.node_id);
                                                    }
                                                }}
                                            />
                                        ))}
                                    </div>
                                </li>
                            ),
                        )}
                        {pending && (
                            <li className="flex gap-2.5" aria-live="polite">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai/15 text-ai">
                                    <Sparkles className="h-3.5 w-3.5" />
                                </span>
                                <span className="ai-typing flex items-center gap-1 pt-2 text-ai" aria-label="Thinking">
                                    <span />
                                    <span />
                                    <span />
                                </span>
                            </li>
                        )}
                    </ol>
                )}
                {error && (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/[0.06] p-3 text-sm">
                        <p className="min-w-0 flex-1 text-destructive">{error}</p>
                        <Button variant="outline" size="sm" onClick={handleRetry} className="h-7 shrink-0">
                            <RefreshCw className="h-3.5 w-3.5" />
                            Retry
                        </Button>
                    </div>
                )}
            </div>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    submit(input);
                }}
                className="border-t border-border/70 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
            >
                {focusNode && (
                    <p className="mb-2 truncate px-1 text-xs text-muted-foreground">
                        Focused on <span className="font-medium text-foreground">{focusNode.data.name || focusNode.type}</span>
                    </p>
                )}
                <div className="flex items-end gap-2 rounded-2xl border border-border/80 bg-card p-1.5 focus-within:border-ai/50 focus-within:ring-[3px] focus-within:ring-ai/20">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        placeholder="Ask or describe a change…"
                        aria-label="Message the AI assistant"
                        className="field-sizing-content max-h-36 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-base leading-snug outline-none placeholder:text-muted-foreground/70 md:text-sm"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || pending}
                        aria-label="Send"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ai text-ai-foreground transition-opacity disabled:opacity-40"
                    >
                        <ArrowUp className="h-4 w-4" />
                    </button>
                </div>
            </form>
        </div>
    );
}

function SuggestionCard({
    suggestion,
    currentPrompt,
    applied,
    readOnly,
    onApply,
}: {
    suggestion: AgentAssistantSuggestion;
    currentPrompt: string;
    applied: boolean;
    readOnly: boolean;
    onApply: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [showCurrent, setShowCurrent] = useState(false);
    const unchanged = currentPrompt.trim() === suggestion.prompt.trim();

    const handleCopy = async () => {
        try {
            await copyTextToClipboard(suggestion.prompt);
            toast.success("Prompt copied");
        } catch {
            toast.error("Couldn't copy the prompt");
        }
    };

    return (
        <div className="overflow-hidden rounded-xl border border-ai/30 bg-card">
            <div className="flex items-start gap-2 px-3 pt-3">
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold tracking-wide text-ai uppercase">Suggested edit</p>
                    <p className="truncate text-sm font-medium">{suggestion.node_name}</p>
                    {suggestion.summary && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{suggestion.summary}</p>
                    )}
                </div>
            </div>

            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 flex w-full items-center gap-1 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-expanded={expanded}
            >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                {expanded ? "Hide new prompt" : "View new prompt"}
            </button>
            {expanded && (
                <div className="mx-3 mt-2 space-y-2">
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-2.5 font-sans text-xs leading-relaxed">
                        {suggestion.prompt}
                    </pre>
                    {currentPrompt && (
                        <>
                            <button
                                type="button"
                                onClick={() => setShowCurrent((v) => !v)}
                                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                            >
                                {showCurrent ? "Hide current prompt" : "Compare with current prompt"}
                            </button>
                            {showCurrent && (
                                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-dashed p-2.5 font-sans text-xs leading-relaxed text-muted-foreground">
                                    {currentPrompt}
                                </pre>
                            )}
                        </>
                    )}
                </div>
            )}

            <div className="mt-3 flex items-center gap-2 border-t border-border/60 px-3 py-2">
                {applied || unchanged ? (
                    <span className="inline-flex h-8 items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-4 w-4" />
                        {applied ? "Applied — save to keep it" : "Already in your prompt"}
                    </span>
                ) : (
                    <Button
                        size="sm"
                        onClick={onApply}
                        disabled={readOnly}
                        className="h-8 bg-ai text-ai-foreground hover:bg-ai/90"
                        title={readOnly ? "Go back to the draft to apply changes" : undefined}
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        Apply
                    </Button>
                )}
                <Button size="sm" variant="ghost" onClick={handleCopy} className="ml-auto h-8 text-muted-foreground">
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                </Button>
            </div>
        </div>
    );
}
