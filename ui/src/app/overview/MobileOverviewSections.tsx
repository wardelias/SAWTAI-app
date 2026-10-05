"use client";

import {
    ArrowRight,
    AudioLines,
    Bot,
    Brain,
    FileText,
    Megaphone,
    MessageSquareText,
    Phone,
    Plus,
    Users,
} from "lucide-react";
import Link from "next/link";

import { createAgentHref } from "@/components/workflow/agentIdeas";
import { useIsMobile } from "@/hooks/use-mobile";
import { useActiveAgents } from "@/hooks/useActiveAgents";
import { type LocalUser, useAuth } from "@/lib/auth";

function greetingForHour(hour: number) {
    if (hour < 5) return "Good evening";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

/** Phone header for the overview: a greeting instead of the desktop "Overview" title. */
export function MobileGreeting() {
    const { user } = useAuth();
    const email =
        (user as LocalUser | undefined)?.email ||
        (user as { primaryEmail?: string } | undefined)?.primaryEmail ||
        "";
    const fullName = user?.displayName || (user as LocalUser | undefined)?.name || "";
    const firstName = fullName.trim().split(/\s+/)[0] || email.split("@")[0] || "";

    return (
        <div className="md:hidden">
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                {greetingForHour(new Date().getHours())}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
                {firstName ? `Hi, ${firstName}` : "Welcome back"}
            </h1>
        </div>
    );
}

/** Horizontally scrolling agent cards with quick Edit / Test / Ask AI actions. */
export function AgentStrip() {
    // Only phones render the strip, so only phones pay for the request.
    const isMobile = useIsMobile();
    const { agents, loading } = useActiveAgents({ enabled: isMobile });

    return (
        <section className="md:hidden">
            <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-base font-semibold">Your agents</h2>
                <Link href="/workflow" className="flex items-center gap-1 text-sm text-muted-foreground">
                    See all
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
            </div>
            <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
                {loading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="h-36 w-64 shrink-0 animate-pulse rounded-2xl bg-muted" />
                    ))
                ) : (
                    <>
                        {(agents ?? []).slice(0, 8).map((agent) => (
                            <div
                                key={agent.id}
                                className="card-weave flex w-64 shrink-0 snap-start flex-col rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm"
                            >
                                <Link href={`/workflow/${agent.id}`} className="flex items-start gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                                        <Bot className="h-5 w-5 text-muted-foreground" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium">{agent.name}</span>
                                        <span className="block text-xs text-muted-foreground">
                                            {agent.total_runs.toLocaleString()} {agent.total_runs === 1 ? "call" : "calls"}
                                        </span>
                                    </span>
                                </Link>
                                <div className="mt-4 grid grid-cols-2 gap-2">
                                    <Link
                                        href={`/workflow/${agent.id}?panel=test`}
                                        className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-muted text-xs font-medium active:bg-accent"
                                    >
                                        <Phone className="h-3.5 w-3.5" />
                                        Test
                                    </Link>
                                    <Link
                                        href={`/workflow/${agent.id}?panel=assistant`}
                                        className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-ai/12 text-xs font-medium text-ai active:bg-ai/20"
                                    >
                                        <MessageSquareText className="h-3.5 w-3.5" />
                                        Ask AI
                                    </Link>
                                </div>
                            </div>
                        ))}
                        <Link
                            href={createAgentHref()}
                            className="flex w-40 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ai/40 p-3.5 text-center text-sm font-medium text-ai active:bg-ai/10"
                        >
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ai/12">
                                <Plus className="h-5 w-5" />
                            </span>
                            New agent with AI
                        </Link>
                    </>
                )}
            </div>
        </section>
    );
}

const SHORTCUTS = [
    { label: "Agents", href: "/workflow", icon: Bot },
    { label: "Campaigns", href: "/campaigns", icon: Megaphone },
    { label: "Leads", href: "/leads", icon: Users },
    { label: "Models", href: "/model-configurations", icon: Brain },
    { label: "Telephony", href: "/telephony-configurations", icon: Phone },
    { label: "Recordings", href: "/recordings", icon: AudioLines },
];

/** Phone replacement for the desktop "quick actions" and "resources" cards. */
export function MobileShortcuts() {
    return (
        <section className="md:hidden">
            <h2 className="mb-2.5 text-base font-semibold">Shortcuts</h2>
            <div className="grid grid-cols-3 gap-2.5">
                {SHORTCUTS.map(({ label, href, icon: Icon }) => (
                    <Link
                        key={href}
                        href={href}
                        className="card-weave flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card px-2 py-3.5 text-xs font-medium shadow-sm active:bg-accent"
                    >
                        <Icon className="h-5 w-5 text-muted-foreground" />
                        {label}
                    </Link>
                ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
                <a
                    href="https://docs.dograh.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl border border-border/60 py-2.5 text-xs font-medium text-muted-foreground"
                >
                    <FileText className="h-3.5 w-3.5" />
                    Documentation
                </a>
                <a
                    href="https://github.com/wardelias/SAWTAI/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl border border-border/60 py-2.5 text-xs font-medium text-muted-foreground"
                >
                    Report an issue
                </a>
            </div>
        </section>
    );
}
