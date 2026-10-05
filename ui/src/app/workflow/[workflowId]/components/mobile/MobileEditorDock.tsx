"use client";

import { ListTree, type LucideIcon, Phone, Plus, Settings2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

interface MobileEditorDockProps {
    readOnly: boolean;
    onAddNode: () => void;
    onShowSteps: () => void;
    onAskAI: () => void;
    onTest: () => void;
    onSettings: () => void;
}

function DockButton({
    label,
    icon: Icon,
    onClick,
    className,
}: {
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium text-muted-foreground active:bg-accent",
                className,
            )}
        >
            <Icon className="h-[1.15rem] w-[1.15rem] text-foreground/85" />
            {label}
        </button>
    );
}

/** Floating action dock for the agent editor on phones. */
export function MobileEditorDock({
    readOnly,
    onAddNode,
    onShowSteps,
    onAskAI,
    onTest,
    onSettings,
}: MobileEditorDockProps) {
    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
            <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl border border-border/70 bg-background/90 p-1.5 shadow-xl shadow-black/20 backdrop-blur-xl">
                {!readOnly && <DockButton label="Add" icon={Plus} onClick={onAddNode} />}
                <DockButton label="Steps" icon={ListTree} onClick={onShowSteps} />
                <button
                    type="button"
                    onClick={onAskAI}
                    className="ai-halo mx-1 flex h-12 items-center gap-2 rounded-xl bg-ai px-4 text-sm font-semibold text-ai-foreground active:opacity-90"
                >
                    <Sparkles className="h-4 w-4" />
                    Ask AI
                </button>
                <DockButton label="Test" icon={Phone} onClick={onTest} />
                <DockButton label="Settings" icon={Settings2} onClick={onSettings} />
            </div>
        </div>
    );
}
