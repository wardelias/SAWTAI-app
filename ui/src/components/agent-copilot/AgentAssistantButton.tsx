'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

import { AgentCopilotChat, useCopilotStatus } from './AgentCopilotChat';

/**
 * Agents-list entry point: opens the assistant for creating new agents or
 * editing any existing one by name. Hidden when the organization has
 * turned the assistant off.
 */
export function AgentAssistantButton() {
    const router = useRouter();
    const status = useCopilotStatus();
    const [open, setOpen] = useState(false);

    // Show newly created or renamed agents in the list behind the sheet.
    const handleWorkflowChanged = useCallback(() => {
        router.refresh();
    }, [router]);

    if (!status?.enabled) return null;

    return (
        <>
            <Button
                onClick={() => setOpen(true)}
                className="gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25 hover:opacity-90"
            >
                <Sparkles className="h-4 w-4" />
                AI Assistant
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent side="right" className="w-full max-w-none p-0 sm:max-w-[440px] [&>button]:hidden">
                    <SheetTitle className="sr-only">AI Assistant</SheetTitle>
                    <AgentCopilotChat onWorkflowChanged={handleWorkflowChanged} onClose={() => setOpen(false)} />
                </SheetContent>
            </Sheet>
        </>
    );
}
