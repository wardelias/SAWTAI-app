"use client";

import * as LucideIcons from "lucide-react";
import { ChevronRight, Circle, type LucideIcon, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { useNodeSpecs } from "@/components/flow/renderer";
import type { FlowEdge, FlowNode } from "@/components/flow/types";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { orderNodesByFlow } from "../../utils/orderNodesByFlow";

function resolveIcon(name: string | undefined): LucideIcon {
    const icons = LucideIcons as unknown as Record<string, LucideIcon>;
    return (name && icons[name]) || Circle;
}

const TYPE_TINT: Record<string, string> = {
    startCall: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    agentNode: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
    endCall: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
    globalNode: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
};

interface AgentStepsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    nodes: FlowNode[];
    edges: FlowEdge[];
    onEditNode: (node: FlowNode) => void;
    onAskAI: (node: FlowNode) => void;
}

/** Phone-friendly list view of the agent's steps; the canvas is hard to work with on a small screen. */
export function AgentStepsSheet({
    open,
    onOpenChange,
    nodes,
    edges,
    onEditNode,
    onAskAI,
}: AgentStepsSheetProps) {
    const { bySpecName } = useNodeSpecs();
    const ordered = useMemo(() => orderNodesByFlow(nodes, edges), [nodes, edges]);
    const outgoing = useMemo(() => {
        const counts = new Map<string, number>();
        for (const edge of edges) counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
        return counts;
    }, [edges]);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="h-[85dvh] gap-0 p-0"
            >
                <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
                <SheetHeader className="px-5 pt-3 pb-3 text-left">
                    <SheetTitle>Agent steps</SheetTitle>
                    <SheetDescription>
                        {ordered.length} {ordered.length === 1 ? "step" : "steps"} in call order. Tap one to edit it.
                    </SheetDescription>
                </SheetHeader>
                <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-6">
                    {ordered.map((node, index) => {
                        const spec = bySpecName.get(node.type);
                        const Icon = resolveIcon(spec?.icon);
                        const prompt = typeof node.data.prompt === "string" ? node.data.prompt.trim() : "";
                        const transitions = outgoing.get(node.id) ?? 0;
                        return (
                            <li
                                key={node.id}
                                className={cn(
                                    "flex items-stretch overflow-hidden rounded-2xl border bg-card",
                                    node.data.invalid ? "border-destructive/50" : "border-border/60",
                                )}
                            >
                                <button
                                    type="button"
                                    onClick={() => onEditNode(node)}
                                    className="flex min-w-0 flex-1 items-start gap-3 p-3 text-left active:bg-accent/60"
                                >
                                    <span
                                        className={cn(
                                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                                            TYPE_TINT[node.type] ?? "bg-muted text-muted-foreground",
                                        )}
                                    >
                                        <Icon className="h-[1.1rem] w-[1.1rem]" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                            <span className="text-[11px] tabular-nums text-muted-foreground">
                                                {index + 1}
                                            </span>
                                            <span className="truncate text-sm font-semibold">
                                                {node.data.name || spec?.display_name || node.type}
                                            </span>
                                        </span>
                                        <span className="mt-0.5 block text-xs text-muted-foreground">
                                            {spec?.display_name ?? node.type}
                                            {transitions > 0 &&
                                                ` · ${transitions} ${transitions === 1 ? "path" : "paths"} out`}
                                        </span>
                                        {prompt && (
                                            <span className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-foreground/75">
                                                {prompt}
                                            </span>
                                        )}
                                        {node.data.invalid && node.data.validationMessage && (
                                            <span className="mt-1.5 block text-xs text-destructive">
                                                {node.data.validationMessage}
                                            </span>
                                        )}
                                    </span>
                                    <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" />
                                </button>
                                {prompt && (
                                    <button
                                        type="button"
                                        onClick={() => onAskAI(node)}
                                        aria-label={`Ask AI about ${node.data.name || "this step"}`}
                                        className="flex w-12 shrink-0 items-center justify-center border-l border-border/60 bg-ai/[0.06] text-ai active:bg-ai/15"
                                    >
                                        <Sparkles className="h-4 w-4" />
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </SheetContent>
        </Sheet>
    );
}
