"use client";

import { ArrowRight, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";

import { AGENT_IDEAS, createAgentHref } from "@/components/workflow/agentIdeas";
import { cn } from "@/lib/utils";

/** Phone hero that puts AI agent creation one tap away. */
export function AIBuilderHero({ className }: { className?: string }) {
    return (
        <section className={cn("overflow-hidden rounded-3xl border border-ai/30 bg-ai/[0.07] md:hidden", className)}>
            <div className="p-4">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ai text-ai-foreground">
                        <Wand2 className="h-4 w-4" />
                    </span>
                    <span className="text-[11px] font-semibold tracking-wide text-ai uppercase">AI Agent Builder</span>
                </div>
                <h2 className="mt-3 text-lg leading-snug font-semibold">Describe a call. AI builds the agent.</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    It writes the prompts and call flow; you test it in the browser in seconds.
                </p>
                <Link
                    href={createAgentHref()}
                    className="mt-4 flex items-center gap-3 rounded-2xl border border-border/70 bg-background px-3.5 py-3 text-sm text-muted-foreground shadow-sm active:bg-accent"
                >
                    <Sparkles className="h-4 w-4 shrink-0 text-ai" />
                    <span className="min-w-0 flex-1 truncate">What should your agent do?</span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ai text-ai-foreground">
                        <ArrowRight className="h-4 w-4" />
                    </span>
                </Link>
            </div>
            <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-4">
                {AGENT_IDEAS.map((idea) => {
                    const Icon = idea.icon;
                    return (
                        <Link
                            key={idea.useCase}
                            href={createAgentHref(idea)}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-medium active:bg-accent"
                        >
                            <Icon className="h-3.5 w-3.5 text-ai" />
                            {idea.useCase}
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
