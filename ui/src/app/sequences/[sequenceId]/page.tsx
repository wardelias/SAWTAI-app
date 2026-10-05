"use client";

import { ArrowLeft, Mail, MessageSquare, Phone, UserPlus } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MobileList, MobileListItem } from '@/components/ui/mobile-list';
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
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import { listLeads } from '@/lib/leadsApi';
import {
    enrollLeads,
    type Enrollment,
    getSequence,
    listEnrollments,
    type Sequence,
} from '@/lib/sequencesApi';

const ENROLL_STATUSES = ['new', 'enrolled', 'contacted', 'unresponsive'];

const CHANNEL_ICONS: Record<string, typeof Phone> = { voice: Phone, sms: MessageSquare, email: Mail };
const CHANNEL_LABELS: Record<string, string> = { voice: 'Voice call', call: 'Voice call', sms: 'SMS', email: 'Email' };

function formatDelay(seconds: number) {
    const minutes = Math.round(seconds / 60);
    if (minutes === 0) return 'Immediately';
    if (minutes % 1440 === 0) return `After ${minutes / 1440} d`;
    if (minutes % 60 === 0) return `After ${minutes / 60} h`;
    return `After ${minutes} min`;
}

export default function SequenceDetailPage() {
    const { user, getAccessToken, redirectToLogin, loading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const sequenceId = Number(params.sequenceId);

    const [sequence, setSequence] = useState<Sequence | null>(null);
    const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [enrollStatus, setEnrollStatus] = useState('new');
    const [enrolling, setEnrolling] = useState(false);
    const hasFetched = useRef(false);

    useEffect(() => {
        if (!authLoading && !user) redirectToLogin();
    }, [authLoading, user, redirectToLogin]);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
            const token = await getAccessToken();
            const [seqRes, enrRes] = await Promise.all([
                getSequence(token, sequenceId),
                listEnrollments(token, sequenceId),
            ]);
            if (seqRes.error) {
                toast.error(detailFromError(seqRes.error, 'Failed to load sequence'));
                return;
            }
            setSequence(seqRes.data ?? null);
            setEnrollments(enrRes.data?.enrollments ?? []);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (authLoading || !user || hasFetched.current || !sequenceId) return;
        hasFetched.current = true;
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user, sequenceId]);

    const handleEnroll = async () => {
        setEnrolling(true);
        try {
            const token = await getAccessToken();
            const leadsRes = await listLeads(token, { status: enrollStatus, limit: 500 });
            if (leadsRes.error) {
                toast.error(detailFromError(leadsRes.error, 'Failed to load leads'));
                return;
            }
            const ids = (leadsRes.data?.leads ?? []).map((l) => l.id);
            if (ids.length === 0) {
                toast.info(`No leads with status "${enrollStatus}"`);
                return;
            }
            const res = await enrollLeads(token, sequenceId, ids);
            if (res.error) {
                toast.error(detailFromError(res.error, 'Enrollment failed'));
                return;
            }
            toast.success(`Enrolled ${res.data?.enrolled ?? 0} (skipped ${res.data?.skipped ?? 0})`);
            await fetchAll();
        } finally {
            setEnrolling(false);
        }
    };

    const formatDateTime = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');
    const stateVariant = (s: string): 'default' | 'secondary' | 'outline' | 'destructive' =>
        s === 'converted' ? 'default' : s === 'stopped' ? 'destructive' : s === 'completed' ? 'secondary' : 'outline';

    if (isLoading) {
        return (
            <div className="container mx-auto p-6 max-md:px-4 max-md:py-5">
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
            <div className="container mx-auto p-6 max-md:px-4 max-md:py-5">
                <Button variant="ghost" onClick={() => router.push('/sequences')} className="max-md:hidden">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                </Button>
                <p className="mt-4">Sequence not found.</p>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 space-y-6 max-md:space-y-5 max-md:px-4 max-md:py-5">
            <Button variant="ghost" onClick={() => router.push('/sequences')} className="max-md:hidden">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to sequences
            </Button>

            <div className="flex justify-between items-start max-md:gap-3">
                <div className="max-md:min-w-0">
                    <h1 className="text-3xl font-bold mb-1 max-md:text-2xl">{sequence.name}</h1>
                    <p className="text-muted-foreground max-md:text-sm">
                        {sequence.steps.length} step(s)
                        {sequence.quiet_hours_start != null && sequence.quiet_hours_end != null
                            ? ` · quiet ${sequence.quiet_hours_start}:00–${sequence.quiet_hours_end}:00`
                            : ''}
                    </p>
                </div>
                <Badge variant={sequence.status === 'active' ? 'default' : 'secondary'}>
                    {sequence.status}
                </Badge>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Steps</CardTitle>
                </CardHeader>
                <CardContent>
                    <ol className="md:hidden">
                        {sequence.steps.map((s, i) => {
                            const ChannelIcon = CHANNEL_ICONS[s.channel] ?? Phone;
                            return (
                                <li key={s.id ?? s.step_order} className="relative flex gap-3 pb-5 last:pb-0">
                                    {i < sequence.steps.length - 1 && (
                                        <span aria-hidden className="absolute left-4 top-9 bottom-1 w-px bg-border" />
                                    )}
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                        <ChannelIcon className="size-4" />
                                    </span>
                                    <div className="min-w-0 pt-0.5">
                                        <p className="text-sm font-medium">
                                            {i + 1}. {CHANNEL_LABELS[s.channel] ?? s.channel}
                                            {s.workflow_id != null && (
                                                <span className="font-normal text-muted-foreground"> · agent #{s.workflow_id}</span>
                                            )}
                                        </p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {formatDelay(s.delay_seconds)}
                                            {s.stop_on_response ? ' · stops when the lead responds' : ''}
                                        </p>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                    <Table className="max-md:hidden">
                        <TableHeader>
                            <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Channel</TableHead>
                                <TableHead>Delay</TableHead>
                                <TableHead>Workflow</TableHead>
                                <TableHead>Stop on response</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sequence.steps.map((s) => (
                                <TableRow key={s.id ?? s.step_order}>
                                    <TableCell>{(s.step_order ?? 0) + 1}</TableCell>
                                    <TableCell>{s.channel}</TableCell>
                                    <TableCell>{Math.round(s.delay_seconds / 60)} min</TableCell>
                                    <TableCell>{s.workflow_id ?? '—'}</TableCell>
                                    <TableCell>{s.stop_on_response ? 'Yes' : 'No'}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Enroll leads</CardTitle>
                    <CardDescription>
                        Enroll all leads with a given status. DNC/suppressed/already-enrolled
                        leads are skipped automatically.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-end gap-2 max-md:flex-col max-md:items-stretch">
                    <div>
                        <Select value={enrollStatus} onValueChange={setEnrollStatus}>
                            <SelectTrigger className="w-48 max-md:w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {ENROLL_STATUSES.map((s) => (
                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button onClick={handleEnroll} disabled={enrolling}>
                        <UserPlus className="h-4 w-4 mr-2" />
                        {enrolling ? 'Enrolling…' : 'Enroll matching leads'}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Enrollments</CardTitle>
                    <CardDescription>{enrollments.length} total</CardDescription>
                </CardHeader>
                <CardContent>
                    {enrollments.length === 0 ? (
                        <p className="text-muted-foreground">No leads enrolled yet.</p>
                    ) : (
                        <>
                        <MobileList>
                            {enrollments.map((e) => (
                                <MobileListItem
                                    key={e.id}
                                    href={`/leads/${e.lead_id}`}
                                    title={`Lead #${e.lead_id}`}
                                    subtitle={`Step ${e.current_step + 1}${e.next_step_at ? ` · next ${formatDateTime(e.next_step_at)}` : ''}`}
                                    meta={e.stop_reason ? <span className="text-muted-foreground">Stopped: {e.stop_reason}</span> : undefined}
                                    trailing={<Badge variant={stateVariant(e.state)}>{e.state}</Badge>}
                                />
                            ))}
                        </MobileList>
                        <div className="overflow-x-auto max-md:hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Lead</TableHead>
                                        <TableHead>Step</TableHead>
                                        <TableHead>State</TableHead>
                                        <TableHead>Next step</TableHead>
                                        <TableHead>Stop reason</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {enrollments.map((e) => (
                                        <TableRow
                                            key={e.id}
                                            className="cursor-pointer hover:bg-muted/50"
                                            onClick={() => router.push(`/leads/${e.lead_id}`)}
                                        >
                                            <TableCell>#{e.lead_id}</TableCell>
                                            <TableCell>{e.current_step + 1}</TableCell>
                                            <TableCell>
                                                <Badge variant={stateVariant(e.state)}>{e.state}</Badge>
                                            </TableCell>
                                            <TableCell>{formatDateTime(e.next_step_at)}</TableCell>
                                            <TableCell>{e.stop_reason ?? '—'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
