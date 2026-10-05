"use client";

import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Coins, Phone, PhoneOutgoing, RotateCcw, Timer, Voicemail } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { getUsageHistoryApiV1OrganizationsUsageRunsGet } from '@/client/sdk.gen';
import type { UsageHistoryResponse, WorkflowRunUsageResponse } from '@/client/types.gen';
import { CallInsightsCard } from '@/components/agent-copilot/CallInsightsCard';
import { CallTypeCell } from '@/components/CallTypeCell';
import { MediaPreviewButton, MediaPreviewDialog } from '@/components/MediaPreviewDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const RECENT_CALLS_LIMIT = 6;
const NEEDS_ACTION_LIMIT = 4;

type ActionInfo = {
    reason: string;
    cta: string;
    icon: typeof AlertTriangle;
};

// Map a run's disposition to a follow-up action. Returns null when the call
// completed normally and needs no attention.
function getActionInfo(disposition?: string | null): ActionInfo | null {
    if (!disposition) return null;
    const code = disposition.toLowerCase();

    if (code === 'voicemail_detected') {
        return { reason: 'Reached voicemail', cta: 'Call back', icon: Voicemail };
    }
    if (code === 'user_idle_max_duration_exceeded') {
        return { reason: 'Caller went idle', cta: 'Follow up', icon: PhoneOutgoing };
    }
    if (code.includes('error')) {
        return { reason: 'Call ended with an error', cta: 'Retry', icon: RotateCcw };
    }
    if (code === 'unknown') {
        return { reason: 'Unclear outcome', cta: 'Review', icon: AlertTriangle };
    }
    return null;
}

function formatDuration(seconds: number) {
    const safe = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(safe / 60);
    const remaining = safe % 60;
    if (minutes === 0) return `${remaining}s`;
    if (remaining === 0) return `${minutes}m`;
    return `${minutes}m ${remaining}s`;
}

type StatCard = {
    label: string;
    value: string;
    hint?: string;
    icon: typeof Phone;
    tint: string;
};

export default function OverviewPage() {
    const router = useRouter();
    const { isAuthenticated } = useAuth();

    const [usage, setUsage] = useState<UsageHistoryResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const hasFetched = useRef(false);

    const mediaPreview = MediaPreviewDialog();

    useEffect(() => {
        if (!isAuthenticated || hasFetched.current) return;
        hasFetched.current = true;

        (async () => {
            try {
                const response = await getUsageHistoryApiV1OrganizationsUsageRunsGet({
                    query: { page: 1, limit: 50 },
                });
                if (response.data) setUsage(response.data);
            } catch (error) {
                console.error('Failed to fetch overview usage:', error);
            } finally {
                setIsLoading(false);
            }
        })();
    }, [isAuthenticated]);

    const totalCalls = usage?.total_count ?? 0;
    const totalDuration = usage?.total_duration_seconds ?? 0;
    const avgDuration = totalCalls > 0 ? totalDuration / totalCalls : 0;
    const totalTokens = usage?.total_dograh_tokens ?? 0;
    const recentCalls = usage?.runs.slice(0, RECENT_CALLS_LIMIT) ?? [];

    const needsAction = (usage?.runs ?? [])
        .map((run) => ({ run, action: getActionInfo(run.disposition) }))
        .filter((item): item is { run: WorkflowRunUsageResponse; action: ActionInfo } => item.action !== null)
        .slice(0, NEEDS_ACTION_LIMIT);

    const stats: StatCard[] = [
        {
            label: 'Total Calls',
            value: totalCalls.toLocaleString(),
            hint: 'across all agents',
            icon: Phone,
            tint: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        },
        {
            label: 'Talk Time',
            value: formatDuration(totalDuration),
            hint: 'total handled',
            icon: Clock,
            tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        },
        {
            label: 'Avg Call',
            value: formatDuration(avgDuration),
            hint: 'per call',
            icon: Timer,
            tint: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
        },
        {
            label: 'Tokens Used',
            value: totalTokens.toLocaleString(),
            hint: 'SawtAI tokens',
            icon: Coins,
            tint: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        },
    ];

    const handleRowClick = (run: WorkflowRunUsageResponse) => {
        router.push(`/workflow/${run.workflow_id}/run/${run.id}`);
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mx-auto max-w-6xl space-y-8">
                {/* Heading */}
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
                    <p className="text-sm text-muted-foreground">
                        A snapshot of your voice agents&apos; activity.
                    </p>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {stats.map((stat) => {
                        const Icon = stat.icon;
                        return (
                            <Card key={stat.label} className="overflow-hidden">
                                <CardContent className="flex items-center gap-4 p-5">
                                    <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', stat.tint)}>
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0">
                                        {isLoading ? (
                                            <div className="h-7 w-16 animate-pulse rounded bg-muted" />
                                        ) : (
                                            <p className="truncate text-2xl font-semibold leading-tight">{stat.value}</p>
                                        )}
                                        <p className="truncate text-xs text-muted-foreground">
                                            {stat.label}
                                            {stat.hint && <span className="text-muted-foreground/70"> · {stat.hint}</span>}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

                {/* AI analysis of the last 10 calls */}
                <CallInsightsCard />

                {/* Needs you */}
                <Card className="border-amber-500/40 bg-amber-500/[0.03]">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                                Needs You
                                {!isLoading && needsAction.length > 0 && (
                                    <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                        {needsAction.length}
                                    </Badge>
                                )}
                            </CardTitle>
                            <CardDescription>Calls that ended without a clean outcome and may need a follow-up.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="space-y-2">
                                {Array.from({ length: 2 }).map((_, i) => (
                                    <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
                                ))}
                            </div>
                        ) : needsAction.length === 0 ? (
                            <div className="flex items-center gap-3 rounded-lg border border-dashed border-emerald-500/30 bg-emerald-500/[0.04] p-6 text-sm text-muted-foreground">
                                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                                All clear — no calls need your attention right now.
                            </div>
                        ) : (
                            <ul className="space-y-2">
                                {needsAction.map(({ run, action }) => {
                                    const ActionIcon = action.icon;
                                    const phone =
                                        (run.call_type === 'inbound' ? run.caller_number : run.called_number) || null;
                                    return (
                                        <li
                                            key={run.id}
                                            className="group flex cursor-pointer items-center gap-4 rounded-lg border border-amber-500/20 bg-background/60 px-3 py-3 transition-colors hover:bg-accent/50"
                                            onClick={() => handleRowClick(run)}
                                        >
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                                <ActionIcon className="h-5 w-5" />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="truncate font-medium">{action.reason}</p>
                                                    <span className="text-xs text-muted-foreground">#{run.id}</span>
                                                </div>
                                                <p className="truncate text-sm text-muted-foreground">
                                                    {(run.workflow_name || 'Unknown agent') + (phone ? ` · ${phone}` : '')}
                                                </p>
                                            </div>

                                            <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                                                {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                                            </span>

                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="shrink-0 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleRowClick(run);
                                                }}
                                            >
                                                {action.cta}
                                                <ArrowRight className="ml-1 h-3.5 w-3.5" />
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                {/* Recent calls */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                        <div className="space-y-1">
                            <CardTitle>Recent Calls</CardTitle>
                            <CardDescription>The latest agent runs across your organization.</CardDescription>
                        </div>
                        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                            <Link href="/usage">
                                View all
                                <ArrowRight className="ml-1 h-4 w-4" />
                            </Link>
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="space-y-2">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
                                ))}
                            </div>
                        ) : recentCalls.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                                No calls yet. Once your voice agents start running, they&apos;ll show up here.
                            </div>
                        ) : (
                            <ul className="divide-y">
                                {recentCalls.map((run) => {
                                    const phone =
                                        (run.call_type === 'inbound' ? run.caller_number : run.called_number) || null;
                                    return (
                                        <li
                                            key={run.id}
                                            className="group flex cursor-pointer items-center gap-4 px-1 py-3 transition-colors hover:bg-accent/50"
                                            onClick={() => handleRowClick(run)}
                                        >
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-muted/40">
                                                <CallTypeCell mode={run.mode} callType={run.call_type} />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="truncate font-medium">
                                                        {run.workflow_name || 'Unknown agent'}
                                                    </p>
                                                    <span className="text-xs text-muted-foreground">#{run.id}</span>
                                                </div>
                                                <p className="truncate text-sm text-muted-foreground">
                                                    {phone || 'No number'}
                                                </p>
                                            </div>

                                            {run.disposition && (
                                                <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                                                    {run.disposition}
                                                </Badge>
                                            )}

                                            <div className="hidden w-24 shrink-0 text-right md:block">
                                                <p className="text-sm font-medium tabular-nums">
                                                    {formatDuration(run.call_duration_seconds)}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                                                </p>
                                            </div>

                                            <div onClick={(e) => e.stopPropagation()}>
                                                <MediaPreviewButton
                                                    recordingUrl={run.recording_url}
                                                    transcriptUrl={run.transcript_url}
                                                    runId={run.id}
                                                    onOpenPreview={mediaPreview.openPreview}
                                                />
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Create and Manage your Voice Agents</CardTitle>
                            <CardDescription>
                                Build powerful AI Voice Agents with our visual editor
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button asChild>
                                <Link href="/workflow">
                                    Go to Agents
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Configure Services</CardTitle>
                            <CardDescription>
                                Set up your AI services like LLM, TTS, and STT providers
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button asChild variant="outline">
                                <Link href="/model-configurations">
                                    Configure Models
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Resources Section */}
                <Card>
                    <CardHeader>
                        <CardTitle>Resources</CardTitle>
                        <CardDescription>
                            Get help and learn more about SawtAI
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-4">
                            <Button asChild variant="outline">
                                <a
                                    href="https://docs.dograh.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Documentation
                                </a>
                            </Button>
                            <Button asChild variant="outline">
                                <a
                                    href="https://github.com/wardelias/SAWTAI/issues"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Report an Issue
                                </a>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Media preview dialog */}
            {mediaPreview.dialog}
        </div>
    );
}
