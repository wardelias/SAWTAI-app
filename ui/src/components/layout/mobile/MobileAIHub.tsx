"use client";

import { ArrowUp, Bot, ChevronRight, MessageSquareText, Phone, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { AGENT_IDEAS, createAgentHref } from "@/components/workflow/agentIdeas";
import { useActiveAgents } from "@/hooks/useActiveAgents";
import { cn } from "@/lib/utils";


interface MobileAIHubProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * The phone app's AI launcher: describe a new agent in one sentence, or jump
 * straight into the assistant / tester of an existing agent.
 */
export function MobileAIHub({ open, onOpenChange }: MobileAIHubProps) {
    const router = useRouter();
    const [description, setDescription] = useState("");
    const { agents, loading } = useActiveAgents({ enabled: open });

    const go = (href: string) => {
        onOpenChange(false);
        router.push(href);
    };

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const text = description.trim();
        go(createAgentHref(text ? { description: text } : {}));
        setDescription("");
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                // Don't focus the textarea on open: on a phone that pops the keyboard over the sheet.
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="gap-0 overflow-y-auto border-border/60 p-0 md:hidden"
            >
                <span
                    aria-hidden
                    className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30"
                />
                <SheetHeader className="px-5 pt-3 pb-2">
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ai text-ai-foreground">
                            <Sparkles className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 text-left">
                            <SheetTitle className="text-lg">SawtAI Assistant</SheetTitle>
                            <SheetDescription>Build and improve voice agents with AI.</SheetDescription>
                        </div>
                    </div>
                </SheetHeader>

                <div className="space-y-6 px-5 pt-2 pb-6">
                    <form
                        onSubmit={submit}
                        className="rounded-2xl border border-ai/30 bg-ai/[0.06] p-3"
                    >
                        <label htmlFor="ai-hub-description" className="flex items-center gap-2 text-sm font-medium">
                            <Wand2 className="h-4 w-4 text-ai" />
                            Create an agent with AI
                        </label>
                        <div className="mt-2 flex items-end gap-2">
                            <textarea
                                id="ai-hub-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                placeholder="e.g. Call new leads, qualify their budget and book a demo"
                                className="min-h-[3.25rem] flex-1 resize-none rounded-xl border border-border/70 bg-background px-3 py-2 text-base leading-snug outline-none placeholder:text-muted-foreground/70 focus-visible:border-ai/60 focus-visible:ring-[3px] focus-visible:ring-ai/25"
                            />
                            <button
                                type="submit"
                                aria-label="Create agent"
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ai text-ai-foreground shadow-sm transition-opacity active:opacity-80"
                            >
                                <ArrowUp className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="no-scrollbar -mx-3 mt-3 flex gap-2 overflow-x-auto px-3">
                            {AGENT_IDEAS.map((idea) => {
                                const IdeaIcon = idea.icon;
                                return (
                                    <button
                                        key={idea.useCase}
                                        type="button"
                                        onClick={() => go(createAgentHref(idea))}
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-foreground/90 active:bg-accent"
                                    >
                                        <IdeaIcon className="h-3.5 w-3.5 text-ai" />
                                        {idea.useCase}
                                    </button>
                                );
                            })}
                        </div>
                    </form>

                    <section>
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                Ask AI about an agent
                            </h3>
                            <Link
                                href="/workflow"
                                onClick={() => onOpenChange(false)}
                                className="text-xs font-medium text-muted-foreground"
                            >
                                All agents
                            </Link>
                        </div>

                        {loading ? (
                            <div className="space-y-2">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
                                ))}
                            </div>
                        ) : !agents || agents.length === 0 ? (
                            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                                Your agents will show up here once you create one.
                            </p>
                        ) : (
                            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
                                {agents.slice(0, 6).map((agent) => (
                                    <li key={agent.id} className="flex items-center gap-3 px-3 py-2.5">
                                        <button
                                            type="button"
                                            onClick={() => go(`/workflow/${agent.id}`)}
                                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        >
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                                <Bot className="h-4 w-4 text-muted-foreground" />
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-medium">{agent.name}</span>
                                                <span className="block text-xs text-muted-foreground">
                                                    {agent.total_runs} {agent.total_runs === 1 ? "call" : "calls"}
                                                </span>
                                            </span>
                                        </button>
                                        <HubAction
                                            label="Test"
                                            icon={Phone}
                                            onClick={() => go(`/workflow/${agent.id}?panel=test`)}
                                            iconOnly
                                        />
                                        <HubAction
                                            label="Ask AI"
                                            icon={MessageSquareText}
                                            onClick={() => go(`/workflow/${agent.id}?panel=assistant`)}
                                            ai
                                        />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <button
                        type="button"
                        onClick={() => go("/workflow")}
                        className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-sm font-medium"
                    >
                        Manage all agents
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>
            </SheetContent>
        </Sheet>
    );
}

function HubAction({
    label,
    icon: Icon,
    onClick,
    ai = false,
    iconOnly = false,
}: {
    label: string;
    icon: typeof Phone;
    onClick: () => void;
    ai?: boolean;
    iconOnly?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={iconOnly ? label : undefined}
            className={cn(
                "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium",
                iconOnly ? "w-9" : "px-2.5",
                ai ? "bg-ai/12 text-ai" : "bg-muted text-foreground/80",
            )}
        >
            <Icon className="h-3.5 w-3.5" />
            {!iconOnly && label}
        </button>
    );
}
