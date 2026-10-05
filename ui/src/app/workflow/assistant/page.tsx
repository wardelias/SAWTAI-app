'use client';

import { useEffect } from 'react';

import { AgentCopilotChat, useCopilotStatus } from '@/components/agent-copilot/AgentCopilotChat';
import SpinLoader from '@/components/SpinLoader';
import { useAuth } from '@/lib/auth';

export default function AgentAssistantPage() {
    const { user, redirectToLogin, loading: authLoading } = useAuth();
    const enabled = useCopilotStatus();

    useEffect(() => {
        if (!authLoading && !user) {
            redirectToLogin();
        }
    }, [authLoading, user, redirectToLogin]);

    if (authLoading || !user || enabled === null) {
        return <SpinLoader />;
    }

    return (
        <div className="container mx-auto max-w-2xl px-4 py-8">
            <div className="mb-4">
                <h1 className="mb-1 text-2xl font-bold">Build an agent with AI</h1>
                <p className="text-muted-foreground">
                    Describe what your voice agent should do. The assistant asks a few questions, then builds it.
                </p>
            </div>
            {enabled ? (
                <div className="h-[calc(100vh-12rem)] min-h-[480px] overflow-hidden rounded-xl border bg-background">
                    <AgentCopilotChat />
                </div>
            ) : (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                    The AI assistant isn&apos;t set up on this server yet. An administrator needs to set
                    ANTHROPIC_API_KEY for the backend.
                </p>
            )}
        </div>
    );
}
