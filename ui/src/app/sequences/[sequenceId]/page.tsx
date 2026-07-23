"use client";

import { ArrowLeft, UserPlus } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    getSequence,
    listEnrollments,
    type Enrollment,
    type Sequence,
} from '@/lib/sequencesApi';

const ENROLL_STATUSES = ['new', 'enrolled', 'contacted', 'unresponsive'];

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

    return (
        <div className="container mx-auto p-6 space-y-6">
            <Button variant="ghost" onClick={() => router.push('/sequences')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to sequences
            </Button>

            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold mb-1">{sequence.name}</h1>
                    <p className="text-muted-foreground">
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
                    <Table>
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
                <CardContent className="flex items-end gap-2">
                    <div>
                        <Select value={enrollStatus} onValueChange={setEnrollStatus}>
                            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
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
                        <div className="overflow-x-auto">
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
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
