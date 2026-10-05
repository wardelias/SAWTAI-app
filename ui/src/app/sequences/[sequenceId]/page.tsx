"use client";

import {
    ArrowLeft,
    Loader2,
    MessageSquare,
    Pause,
    Pencil,
    Phone,
    Play,
    RefreshCw,
    Search,
    Square,
    Trash2,
    UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import BackgroundServicesBanner from '@/components/BackgroundServicesBanner';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import { type Lead, listLeads } from '@/lib/leadsApi';
import {
    deleteSequence,
    enrollLeads,
    type Enrollment,
    type EnrollmentState,
    getSequence,
    listEnrollments,
    listWorkflowSummaries,
    type Sequence,
    stopEnrollments,
    updateSequence,
    type WorkflowSummary,
} from '@/lib/sequencesApi';

import SequenceEditorDialog from '../SequenceEditorDialog';
import {
    describeStepTiming,
    describeStopReason,
    formatHour,
    STATE_LABELS,
    stateVariant,
} from '../sequenceFormat';

// Lead statuses that make sense to add to a sequence.
const ENROLL_STATUSES: Array<{ value: string; label: string }> = [
    { value: 'new', label: 'New leads' },
    { value: 'unresponsive', label: 'Unresponsive leads' },
    { value: 'contacted', label: 'Contacted leads' },
    { value: 'all', label: 'All callable leads' },
];

const REFRESH_MS = 15_000;

export default function SequenceDetailPage() {
    const { user, getAccessToken, redirectToLogin, loading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const sequenceId = Number(params.sequenceId);

    const [sequence, setSequence] = useState<Sequence | null>(null);
    const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
    const [enrollmentTotal, setEnrollmentTotal] = useState(0);
    const [stateFilter, setStateFilter] = useState<'all' | EnrollmentState>('all');
    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmStopAll, setConfirmStopAll] = useState(false);

    // Add-leads state
    const [enrollStatus, setEnrollStatus] = useState('new');
    const [search, setSearch] = useState('');
    const [searchResults, setSearchResults] = useState<Lead[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
    const hasFetched = useRef(false);

    useEffect(() => {
        if (!authLoading && !user) redirectToLogin();
    }, [authLoading, user, redirectToLogin]);

    const fetchEnrollments = useCallback(async (token: string, filter: 'all' | EnrollmentState) => {
        const res = await listEnrollments(token, sequenceId, {
            state: filter === 'all' ? undefined : filter,
            limit: 500,
        });
        if (!res.error) {
            setEnrollments(res.data?.enrollments ?? []);
            setEnrollmentTotal(res.data?.total ?? 0);
        }
    }, [sequenceId]);

    const fetchSequence = useCallback(async (token: string) => {
        const res = await getSequence(token, sequenceId);
        if (res.error) {
            toast.error(detailFromError(res.error, 'Failed to load sequence'));
            return false;
        }
        setSequence(res.data ?? null);
        return true;
    }, [sequenceId]);

    const refresh = useCallback(async () => {
        const token = await getAccessToken();
        await Promise.all([fetchSequence(token), fetchEnrollments(token, stateFilter)]);
    }, [getAccessToken, fetchSequence, fetchEnrollments, stateFilter]);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current || !sequenceId) return;
        hasFetched.current = true;
        (async () => {
            try {
                const token = await getAccessToken();
                const [, , wfRes, leadsRes] = await Promise.all([
                    fetchSequence(token),
                    fetchEnrollments(token, 'all'),
                    listWorkflowSummaries(token),
                    listLeads(token, { limit: 1 }),
                ]);
                if (!wfRes.error) setWorkflows(wfRes.data ?? []);
                if (!leadsRes.error) setStatusCounts(leadsRes.data?.status_counts ?? {});
            } finally {
                setIsLoading(false);
            }
        })();
    }, [authLoading, user, sequenceId, getAccessToken, fetchSequence, fetchEnrollments]);

    // Keep progress live while the page is open.
    useEffect(() => {
        if (!sequence) return;
        const timer = setInterval(() => {
            refresh().catch(() => undefined);
        }, REFRESH_MS);
        return () => clearInterval(timer);
    }, [sequence, refresh]);

    const changeFilter = async (value: 'all' | EnrollmentState) => {
        setStateFilter(value);
        const token = await getAccessToken();
        await fetchEnrollments(token, value);
    };

    const toggleStatus = async () => {
        if (!sequence) return;
        const status = sequence.status === 'active' ? 'paused' : 'active';
        setBusy(true);
        try {
            const token = await getAccessToken();
            const res = await updateSequence(token, sequence.id, { status });
            if (res.error || !res.data) {
                toast.error(detailFromError(res.error, 'Could not update the sequence'));
                return;
            }
            setSequence(res.data);
            toast.success(status === 'active' ? 'Sequence resumed' : 'Sequence paused — no calls or texts will go out');
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        setBusy(true);
        try {
            const token = await getAccessToken();
            const res = await deleteSequence(token, sequenceId);
            if (res.error) {
                toast.error(detailFromError(res.error, 'Could not delete the sequence'));
                return;
            }
            toast.success('Sequence deleted');
            router.push('/sequences');
        } finally {
            setBusy(false);
        }
    };

    const handleStop = async (enrollmentIds?: number[]) => {
        setBusy(true);
        try {
            const token = await getAccessToken();
            const res = await stopEnrollments(token, sequenceId, enrollmentIds);
            if (res.error) {
                toast.error(detailFromError(res.error, 'Could not stop'));
                return;
            }
            const n = res.data?.stopped ?? 0;
            toast.success(n === 1 ? 'Lead removed from the sequence' : `${n} leads removed from the sequence`);
            await refresh();
        } finally {
            setBusy(false);
        }
    };

    const enroll = async (target: { leadIds?: number[]; leadStatus?: string }) => {
        setBusy(true);
        try {
            const token = await getAccessToken();
            const res = await enrollLeads(token, sequenceId, target);
            if (res.error) {
                toast.error(detailFromError(res.error, 'Could not add leads'));
                return;
            }
            const { enrolled = 0, skipped = 0 } = res.data ?? {};
            if (enrolled === 0) {
                toast.info(
                    skipped
                        ? `No leads added — all ${skipped} are already in progress, on the do-not-call list, or already responded`
                        : 'No matching leads to add',
                );
            } else {
                toast.success(
                    `Added ${enrolled} lead${enrolled === 1 ? '' : 's'}` +
                    (skipped ? ` (skipped ${skipped} already in progress, DNC or responded)` : ''),
                );
            }
            setSelectedLeadIds(new Set());
            await refresh();
        } finally {
            setBusy(false);
        }
    };

    const runSearch = async () => {
        setSearching(true);
        try {
            const token = await getAccessToken();
            const res = await listLeads(token, { search: search.trim() || undefined, limit: 50 });
            if (res.error) {
                toast.error(detailFromError(res.error, 'Failed to search leads'));
                return;
            }
            setSearchResults(res.data?.leads ?? []);
        } finally {
            setSearching(false);
        }
    };

    const formatDateTime = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');
    const nextActionLabel = (e: Enrollment): string => {
        if (e.state !== 'active') return describeStopReason(e.stop_reason) || '—';
        if (e.waiting_on_call) return 'Waiting for the call to finish';
        if (sequence?.status !== 'active') return 'Paused';
        if (!e.next_step_at) return '—';
        const due = new Date(e.next_step_at);
        return due.getTime() <= Date.now() ? 'Due now' : due.toLocaleString();
    };

    if (isLoading) {
        return (
            <div className="container mx-auto p-6">
                <div className="animate-pulse space-y-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-12 bg-muted rounded"></div>
                    ))}
                </div>
            </div>
        );
    }

    if (!sequence) {
        return (
            <div className="container mx-auto p-6">
                <Button variant="ghost" onClick={() => router.push('/sequences')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                </Button>
                <p className="mt-4">Sequence not found.</p>
            </div>
        );
    }

    const steps = [...sequence.steps].sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
    const counts = sequence.enrollment_counts ?? {};
    const statusOptionCount = (value: string) =>
        value === 'all'
            ? Object.entries(statusCounts)
                .filter(([s]) => !['suppressed', 'responded', 'converted'].includes(s))
                .reduce((sum, [, n]) => sum + n, 0)
            : statusCounts[value] ?? 0;

    return (
        <div className="container mx-auto p-6 space-y-6">
            <Button variant="ghost" onClick={() => router.push('/sequences')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to sequences
            </Button>

            <div className="flex flex-wrap justify-between items-start gap-4">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <h1 className="text-3xl font-bold">{sequence.name}</h1>
                        <Badge variant={sequence.status === 'active' ? 'default' : 'secondary'}>
                            {sequence.status === 'active' ? 'Running' : sequence.status === 'paused' ? 'Paused' : sequence.status}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground">
                        {steps.length} step{steps.length === 1 ? '' : 's'}
                        {sequence.quiet_hours_start != null && sequence.quiet_hours_end != null
                            ? ` · no contact ${formatHour(sequence.quiet_hours_start)}–${formatHour(sequence.quiet_hours_end)}`
                            : ''}
                        {sequence.default_timezone ? ` (${sequence.default_timezone})` : ''}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => refresh()} disabled={busy}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                    <Button variant="outline" onClick={toggleStatus} disabled={busy}>
                        {sequence.status === 'active' ? (
                            <><Pause className="h-4 w-4 mr-2" />Pause</>
                        ) : (
                            <><Play className="h-4 w-4 mr-2" />Resume</>
                        )}
                    </Button>
                    <Button variant="outline" onClick={() => setEditOpen(true)} disabled={busy}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                    </Button>
                </div>
            </div>

            <BackgroundServicesBanner />

            {sequence.status !== 'active' && (
                <div className="rounded-md border p-4 text-sm">
                    This sequence is paused. Leads stay where they are and nothing is sent until you
                    press <span className="font-medium">Resume</span>.
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                    { label: 'In progress', value: counts.active ?? 0 },
                    { label: 'Responded', value: counts.responded ?? 0 },
                    { label: 'Converted', value: counts.converted ?? 0 },
                    { label: 'Finished without response', value: counts.completed ?? 0 },
                ].map((stat) => (
                    <Card key={stat.label}>
                        <CardHeader className="pb-2">
                            <CardDescription>{stat.label}</CardDescription>
                            <CardTitle className="text-3xl">{stat.value}</CardTitle>
                        </CardHeader>
                    </Card>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Steps</CardTitle>
                    <CardDescription>What happens to each lead, in order</CardDescription>
                </CardHeader>
                <CardContent>
                    <ol className="space-y-3">
                        {steps.map((s, i) => (
                            <li key={s.id ?? i} className="flex gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border">
                                    {s.channel === 'sms' ? <MessageSquare className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                                </div>
                                <div>
                                    <p className="font-medium">
                                        {i + 1}. {s.channel === 'sms'
                                            ? 'Send a text'
                                            : `Call with ${s.workflow_name ?? `agent #${s.workflow_id}`}`}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {describeStepTiming(s, i)}
                                        {s.channel === 'voice' && (s.stop_on_response
                                            ? ' · stops the sequence if the lead talks'
                                            : ' · keeps going even if the lead talks')}
                                    </p>
                                    {s.channel === 'sms' && s.message_text && (
                                        <p className="text-sm mt-1 rounded bg-muted px-2 py-1">{s.message_text}</p>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Add leads</CardTitle>
                    <CardDescription>
                        Leads on the do-not-call list, leads who already responded and leads already in
                        this sequence are skipped automatically. Need leads? <Link href="/leads" className="underline">Import them on the Leads page</Link>.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="status">
                        <TabsList>
                            <TabsTrigger value="status">By status</TabsTrigger>
                            <TabsTrigger value="pick">Pick leads</TabsTrigger>
                        </TabsList>
                        <TabsContent value="status" className="pt-4">
                            <div className="flex flex-wrap items-end gap-2">
                                <Select value={enrollStatus} onValueChange={setEnrollStatus}>
                                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ENROLL_STATUSES.map((s) => (
                                            <SelectItem key={s.value} value={s.value}>
                                                {s.label} ({statusOptionCount(s.value)})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button onClick={() => enroll({ leadStatus: enrollStatus })} disabled={busy}>
                                    <UserPlus className="h-4 w-4 mr-2" />
                                    Add these leads
                                </Button>
                            </div>
                        </TabsContent>
                        <TabsContent value="pick" className="pt-4 space-y-3">
                            <form
                                className="flex gap-2"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    runSearch();
                                }}
                            >
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search by name, phone or email"
                                    className="max-w-sm"
                                />
                                <Button type="submit" variant="outline" disabled={searching}>
                                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                                </Button>
                            </form>
                            {searchResults.length > 0 && (
                                <div className="max-h-72 overflow-y-auto rounded-md border">
                                    {searchResults.map((lead) => {
                                        const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
                                        const blocked = lead.dnc || ['suppressed', 'responded', 'converted'].includes(lead.status);
                                        return (
                                            <label
                                                key={lead.id}
                                                className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0"
                                            >
                                                <Checkbox
                                                    disabled={blocked}
                                                    checked={selectedLeadIds.has(lead.id)}
                                                    onCheckedChange={(v) =>
                                                        setSelectedLeadIds((prev) => {
                                                            const next = new Set(prev);
                                                            if (v) next.add(lead.id);
                                                            else next.delete(lead.id);
                                                            return next;
                                                        })
                                                    }
                                                />
                                                <span className="flex-1">
                                                    {name || 'Unnamed lead'}{' '}
                                                    <span className="text-muted-foreground">{lead.phone_number}</span>
                                                </span>
                                                <Badge variant="outline">{lead.dnc ? 'DNC' : lead.status}</Badge>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                            <Button
                                onClick={() => enroll({ leadIds: Array.from(selectedLeadIds) })}
                                disabled={busy || selectedLeadIds.size === 0}
                            >
                                <UserPlus className="h-4 w-4 mr-2" />
                                Add {selectedLeadIds.size || ''} selected
                            </Button>
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
                    <div>
                        <CardTitle>Leads in this sequence</CardTitle>
                        <CardDescription>{enrollmentTotal} shown · refreshes automatically</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Select value={stateFilter} onValueChange={(v) => changeFilter(v as 'all' | EnrollmentState)}>
                            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All leads</SelectItem>
                                {(Object.keys(STATE_LABELS) as EnrollmentState[]).map((s) => (
                                    <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            disabled={busy || (counts.active ?? 0) === 0}
                            onClick={() => setConfirmStopAll(true)}
                        >
                            <Square className="h-4 w-4 mr-2" />
                            Stop all in progress
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {enrollments.length === 0 ? (
                        <p className="text-muted-foreground">
                            {stateFilter === 'all' ? 'No leads yet — add some above.' : 'No leads in this state.'}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Lead</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Step</TableHead>
                                        <TableHead>Next / outcome</TableHead>
                                        <TableHead>Last activity</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {enrollments.map((e) => (
                                        <TableRow key={e.id}>
                                            <TableCell>
                                                <Link href={`/leads/${e.lead_id}`} className="hover:underline">
                                                    <div className="font-medium">{e.lead_name || 'Unnamed lead'}</div>
                                                    <div className="text-xs text-muted-foreground">{e.lead_phone}</div>
                                                </Link>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={stateVariant(e.state)}>
                                                    {e.state === 'active' && e.waiting_on_call ? 'On a call' : STATE_LABELS[e.state] ?? e.state}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {Math.min(e.current_step + (e.state === 'active' && !e.waiting_on_call ? 1 : 0), steps.length)} of {steps.length}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {nextActionLabel(e)}
                                                {e.last_error && e.state === 'active' && (
                                                    <div className="text-xs text-destructive mt-1">{e.last_error}</div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {formatDateTime(e.last_step_at)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {e.state === 'active' && (
                                                    <Button variant="ghost" size="sm" disabled={busy}
                                                        onClick={() => handleStop([e.id])}>
                                                        Stop
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <SequenceEditorDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                sequence={sequence}
                workflows={workflows}
                getAccessToken={getAccessToken}
                onSaved={(seq) => setSequence(seq)}
            />

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this sequence?</AlertDialogTitle>
                        <AlertDialogDescription>
                            All leads in it stop receiving calls and texts from it. Their call history
                            stays on each lead. This can&apos;t be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={confirmStopAll} onOpenChange={setConfirmStopAll}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Stop all {counts.active ?? 0} leads in progress?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Their remaining steps are cancelled. Calls already in progress finish normally.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleStop()}>Stop all</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
