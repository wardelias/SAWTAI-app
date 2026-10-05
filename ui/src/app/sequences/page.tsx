"use client";

import { Pause, Play, Plus, Repeat } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import BackgroundServicesBanner from '@/components/BackgroundServicesBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MobileList, MobileListIcon, MobileListItem } from '@/components/ui/mobile-list';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import {
    listSequences,
    listWorkflowSummaries,
    type Sequence,
    updateSequence,
    type WorkflowSummary,
} from '@/lib/sequencesApi';

import SequenceEditorDialog from './SequenceEditorDialog';
import { formatHour, summarizeSteps } from './sequenceFormat';

export default function SequencesPage() {
    const { user, getAccessToken, redirectToLogin, loading: authLoading } = useAuth();
    const router = useRouter();

    const [sequences, setSequences] = useState<Sequence[]>([]);
    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [createOpen, setCreateOpen] = useState(false);
    const [toggling, setToggling] = useState<number | null>(null);
    const hasFetched = useRef(false);

    useEffect(() => {
        if (!authLoading && !user) redirectToLogin();
    }, [authLoading, user, redirectToLogin]);

    const fetchAll = async () => {
        try {
            const token = await getAccessToken();
            const [seqRes, wfRes] = await Promise.all([
                listSequences(token),
                listWorkflowSummaries(token),
            ]);
            if (seqRes.error) {
                toast.error(detailFromError(seqRes.error, 'Failed to load sequences'));
            } else {
                setSequences(seqRes.data?.sequences ?? []);
            }
            if (!wfRes.error) setWorkflows(wfRes.data ?? []);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user]);

    const toggleStatus = async (seq: Sequence) => {
        const status = seq.status === 'active' ? 'paused' : 'active';
        setToggling(seq.id);
        try {
            const token = await getAccessToken();
            const res = await updateSequence(token, seq.id, { status });
            if (res.error || !res.data) {
                toast.error(detailFromError(res.error, 'Could not update the sequence'));
                return;
            }
            setSequences((prev) => prev.map((s) => (s.id === seq.id ? res.data! : s)));
            toast.success(status === 'active' ? 'Sequence resumed' : 'Sequence paused');
        } finally {
            setToggling(null);
        }
    };

    return (
        <div className="container mx-auto p-6 space-y-6 max-md:space-y-5 max-md:px-4 max-md:py-5">
            <div className="flex flex-wrap justify-between items-start gap-4 max-md:flex-col max-md:flex-nowrap max-md:items-stretch">
                <div>
                    <h1 className="text-3xl font-bold mb-2 max-md:text-2xl">Sequences</h1>
                    <p className="text-muted-foreground max-w-2xl max-md:text-sm">
                        Automatic follow-up for each lead: call (or text) them on a schedule you set,
                        and stop as soon as they talk to your agent. Use a campaign instead to call a
                        whole list once.
                    </p>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    New sequence
                </Button>
            </div>

            <BackgroundServicesBanner />

            {isLoading ? (
                <div className="animate-pulse space-y-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-12 bg-muted rounded"></div>
                    ))}
                </div>
            ) : sequences.length === 0 ? (
                <Card>
                    <CardContent className="py-12">
                        <div className="mx-auto max-w-xl text-center space-y-4">
                            <Repeat className="mx-auto h-10 w-10 text-muted-foreground" />
                            <h2 className="text-xl font-semibold">Create your first sequence</h2>
                            <ol className="text-left text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                                <li>Set the steps, e.g. call now, call again in 2 days, then text after 5 days.</li>
                                <li>Add leads from your Leads list (DNC and opted-out leads are skipped).</li>
                                <li>Each lead moves through the steps on its own and leaves the sequence
                                    the moment they talk to your agent.</li>
                            </ol>
                            <Button onClick={() => setCreateOpen(true)}>
                                <Plus className="h-4 w-4 mr-2" />
                                New sequence
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Your sequences</CardTitle>
                        <CardDescription>Open a sequence to add leads and follow their progress</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <MobileList>
                            {sequences.map((seq) => {
                                const c = seq.enrollment_counts ?? {};
                                return (
                                    <MobileListItem
                                        key={seq.id}
                                        href={`/sequences/${seq.id}`}
                                        leading={<MobileListIcon><Repeat /></MobileListIcon>}
                                        title={seq.name}
                                        subtitle={summarizeSteps(seq)}
                                        meta={
                                            <>
                                                <Badge variant={seq.status === 'active' ? 'default' : 'secondary'}>
                                                    {seq.status === 'active' ? 'Running' : seq.status === 'paused' ? 'Paused' : seq.status}
                                                </Badge>
                                                <span className="text-muted-foreground tabular-nums">
                                                    {c.active ?? 0} in progress · {c.responded ?? 0} responded
                                                </span>
                                            </>
                                        }
                                        action={
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                disabled={toggling === seq.id}
                                                onClick={() => toggleStatus(seq)}
                                                aria-label={seq.status === 'active' ? `Pause ${seq.name}` : `Resume ${seq.name}`}
                                                className="text-muted-foreground"
                                            >
                                                {seq.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                            </Button>
                                        }
                                    />
                                );
                            })}
                        </MobileList>
                        <div className="overflow-x-auto max-md:hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Steps</TableHead>
                                        <TableHead className="text-right">In progress</TableHead>
                                        <TableHead className="text-right">Responded</TableHead>
                                        <TableHead className="text-right">Finished</TableHead>
                                        <TableHead>Quiet hours</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sequences.map((seq) => {
                                        const c = seq.enrollment_counts ?? {};
                                        return (
                                            <TableRow
                                                key={seq.id}
                                                className="cursor-pointer hover:bg-muted/50"
                                                onClick={() => router.push(`/sequences/${seq.id}`)}
                                            >
                                                <TableCell className="font-medium">{seq.name}</TableCell>
                                                <TableCell>
                                                    <Badge variant={seq.status === 'active' ? 'default' : 'secondary'}>
                                                        {seq.status === 'active' ? 'Running' : seq.status === 'paused' ? 'Paused' : seq.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">
                                                    {summarizeSteps(seq)}
                                                </TableCell>
                                                <TableCell className="text-right">{c.active ?? 0}</TableCell>
                                                <TableCell className="text-right">{c.responded ?? 0}</TableCell>
                                                <TableCell className="text-right">{c.completed ?? 0}</TableCell>
                                                <TableCell className="text-sm">
                                                    {seq.quiet_hours_start != null && seq.quiet_hours_end != null
                                                        ? `${formatHour(seq.quiet_hours_start)}–${formatHour(seq.quiet_hours_end)}`
                                                        : '—'}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            disabled={toggling === seq.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleStatus(seq);
                                                            }}
                                                        >
                                                            {seq.status === 'active' ? (
                                                                <><Pause className="h-4 w-4 mr-1" />Pause</>
                                                            ) : (
                                                                <><Play className="h-4 w-4 mr-1" />Resume</>
                                                            )}
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                router.push(`/sequences/${seq.id}`);
                                                            }}
                                                        >
                                                            Open
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <SequenceEditorDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                sequence={null}
                workflows={workflows}
                getAccessToken={getAccessToken}
                onSaved={(seq) => router.push(`/sequences/${seq.id}`)}
            />
        </div>
    );
}
