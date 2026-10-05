'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { AgentCopilotChat, useCopilotStatus } from '@/components/agent-copilot/AgentCopilotChat';
import SpinLoader from '@/components/SpinLoader';
import { useAuth } from '@/lib/auth';

export default function AgentAssistantPage() {
    const { user, redirectToLogin, loading: authLoading } = useAuth();
    const status = useCopilotStatus();

    useEffect(() => {
        if (!authLoading && !user) {
            redirectToLogin();
        }
    }, [authLoading, user, redirectToLogin]);

    if (authLoading || !user || status === null) {
        return <SpinLoader />;
    }

    return (
        <div className="container mx-auto max-w-3xl px-4 py-8">
            <div className="mb-5">
                <h1 className="mb-1 bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-3xl font-bold text-transparent">
                    Build an agent with AI
                </h1>
                <p className="text-muted-foreground">
                    Describe what your voice agent should do. The assistant asks a few questions, then builds it.
                </p>
            </div>
            {status.enabled ? (
                <div className="h-[calc(100vh-13rem)] min-h-[520px] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xl shadow-violet-500/5">
                    <AgentCopilotChat />
                </div>
            ) : (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                    The AI Assistant is turned off for your organization. Turn it on in{' '}
                    <Link href="/settings#ai-assistant" className="font-medium text-primary underline">
                        Settings → AI Assistant
                    </Link>
                    .
                </p>
            )}
        </div>
    );
}
