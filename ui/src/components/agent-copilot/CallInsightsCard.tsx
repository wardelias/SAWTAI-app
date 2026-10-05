'use client';

import { formatDistanceToNow } from 'date-fns';
import {
    AlertCircle,
    CheckCircle2,
    KeyRound,
    Lightbulb,
    Loader2,
    Quote,
    RefreshCw,
    Sparkles,
    Wand2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    type CallInsightIssue,
    type CallInsightsReport,
    fetchCallInsights,
    runCallInsights,
} from '@/lib/agentCopilot';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

import { useCopilotStatus } from './AgentCopilotChat';

const SEVERITY_STYLES: Record<CallInsightIssue['severity'], { label: string; badge: string; bar: string }> = {
    high: { label: 'High', badge: 'bg-red-500/15 text-red-400 border-red-500/30', bar: 'bg-red-500' },
    medium: { label: 'Medium', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30', bar: 'bg-amber-500' },
    low: { label: 'Low', badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30', bar: 'bg-slate-400' },
};

function IssueCard({ report, issue, index }: { report: CallInsightsReport; issue: CallInsightIssue; index: number }) {
    const style = SEVERITY_STYLES[issue.severity];
    const agentByCall = new Map(report.calls.map((c) => [c.call_id, c.agent_id]));
    return (
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card">
            <div className={cn('absolute inset-y-0 left-0 w-1', style.bar)} />
            <div className="space-y-3 p-4 pl-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="font-semibold leading-snug">{issue.title}</h4>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', style.badge)}>
                        {style.label} impact
                    </span>
                </div>
                <p className="text-sm text-muted-foreground">{issue.what_happened}</p>
                {issue.evidence ? (
                    <p className="flex gap-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
                        <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                        {issue.evidence}
                    </p>
                ) : null}
                <div className="flex gap-2.5 rounded-lg bg-violet-500/10 px-3 py-2.5 text-sm">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                    <div>
                        <span className="font-medium text-violet-300">
                            {issue.needs_change ? 'Suggested fix: ' : 'Suggestion: '}
                        </span>
                        {issue.suggestion}
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {issue.call_ids.length > 0 ? <span>Seen in</span> : null}
                        {issue.call_ids.map((callId) => {
                            const agentId = agentByCall.get(callId);
                            return agentId != null ? (
                                <Link
                                    key={callId}
                                    href={`/workflow/${agentId}/run/${callId}`}
                                    className="rounded-md border border-border/70 px-1.5 py-0.5 font-medium text-foreground hover:border-violet-500/50"
                                >
                                    Call #{callId}
                                </Link>
                            ) : null;
                        })}
                    </div>
                    {issue.needs_change ? (
                        <div className="flex flex-wrap gap-2">
                            {issue.agents.map((agent) => (
                                <Button
                                    key={agent.id}
                                    asChild
                                    size="sm"
                                    className="h-8 gap-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
                                >
                                    <Link href={`/workflow/${agent.id}?insight=${report.id}-${index}`}>
                                        <Wand2 className="h-3.5 w-3.5" />
                                        {issue.agents.length > 1 ? `Fix in ${agent.name}` : 'Fix with AI'}
                                    </Link>
                                </Button>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function Analyzing() {
    return (
        <div className="space-y-4 py-2" aria-live="polite">
            <div className="flex items-center gap-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                <span>Reading your last 10 calls and looking for problems… this can take up to a minute.</span>
            </div>
            {[0, 1].map((i) => (
                <div key={i} className="space-y-2 rounded-xl border border-border/60 p-4">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-full animate-pulse rounded bg-muted" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
            ))}
        </div>
    );
}

/** Overview card: AI analysis of the organization's last 10 calls. */
export function CallInsightsCard() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const status = useCopilotStatus();
    const [report, setReport] = useState<CallInsightsReport | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasFetched = useRef(false);

    useEffect(() => {
        if (authLoading || !user || !status?.enabled || hasFetched.current) return;
        hasFetched.current = true;
        (async () => {
            try {
                setReport(await fetchCallInsights(await getAccessToken()));
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load call insights');
            } finally {
                setLoaded(true);
            }
        })();
    }, [authLoading, user, status, getAccessToken]);

    async function analyze() {
        setRunning(true);
        setError(null);
        try {
            setReport(await runCallInsights(await getAccessToken()));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The analysis failed. Please try again.');
        } finally {
            setRunning(false);
        }
    }

    // Hidden when the organization has switched the assistant off.
    if (status !== null && !status.enabled) return null;

    const canRun = Boolean(status?.configured) && !running;
    const highCount = report?.issues.filter((i) => i.severity === 'high').length ?? 0;

    return (
        <Card className="overflow-hidden border-violet-500/30">
            <CardHeader className="flex flex-col gap-3 space-y-0 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-transparent sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-md shadow-violet-500/25">
                        <Sparkles className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            Call Insights
                            {report && report.issues.length > 0 ? (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                    {report.issues.length} issue{report.issues.length === 1 ? '' : 's'}
                                    {highCount ? ` · ${highCount} high` : ''}
                                </span>
                            ) : null}
                        </CardTitle>
                        <CardDescription>
                            AI review of your last 10 calls: what callers struggled with, and how to fix it.
                        </CardDescription>
                    </div>
                </div>
                {status?.configured ? (
                    <Button
                        onClick={() => void analyze()}
                        disabled={!canRun}
                        variant={report ? 'outline' : 'default'}
                        className={cn('gap-2 shrink-0', !report && 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90')}
                    >
                        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : report ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                        {running ? 'Analyzing…' : report ? 'Re-analyze' : 'Analyze last 10 calls'}
                    </Button>
                ) : null}
            </CardHeader>
            <CardContent className="pt-5">
                {status === null || (!loaded && status.configured) ? (
                    <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
                ) : !status.configured ? (
                    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <span className="flex items-center gap-2 text-muted-foreground">
                            <KeyRound className="h-4 w-4" />
                            Add an Anthropic API key to let AI review your calls.
                        </span>
                        <Button asChild size="sm" variant="outline">
                            <Link href="/settings#ai-assistant">Open AI Assistant settings</Link>
                        </Button>
                    </div>
                ) : running ? (
                    <Analyzing />
                ) : (
                    <div className="space-y-4">
                        {error ? (
                            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        ) : null}
                        {!report ? (
                            <p className="text-sm text-muted-foreground">
                                No analysis yet. Run one to see what callers struggle with and get suggested fixes for your agents.
                            </p>
                        ) : (
                            <>
                                <div className="space-y-1.5">
                                    <p className="text-sm leading-relaxed">{report.summary}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {report.calls_analyzed} call{report.calls_analyzed === 1 ? '' : 's'} analyzed · updated{' '}
                                        {formatDistanceToNow(new Date(report.generated_at), { addSuffix: true })}
                                    </p>
                                </div>

                                {report.calls_analyzed > 0 && report.issues.length === 0 ? (
                                    <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-400">
                                        <CheckCircle2 className="h-4 w-4" />
                                        No problems found in these calls.
                                    </div>
                                ) : null}

                                {report.issues.length > 0 ? (
                                    <div className="grid gap-3 lg:grid-cols-2">
                                        {report.issues.map((issue, index) => (
                                            <IssueCard key={`${report.id}-${index}`} report={report} issue={issue} index={index} />
                                        ))}
                                    </div>
                                ) : null}

                                {report.working_well.length > 0 ? (
                                    <div className="space-y-1.5">
                                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Working well</p>
                                        <ul className="space-y-1">
                                            {report.working_well.map((note) => (
                                                <li key={note} className="flex items-start gap-2 text-sm">
                                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                                    {note}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
