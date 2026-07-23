"use client";

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
    createSequence,
    listSequences,
    listWorkflowSummaries,
    type Sequence,
    type WorkflowSummary,
} from '@/lib/sequencesApi';

interface StepDraft {
    channel: string;
    delayMinutes: number;
    workflowId: string; // select value as string
    stopOnResponse: boolean;
}

const emptyStep = (): StepDraft => ({
    channel: 'voice',
    delayMinutes: 0,
    workflowId: '',
    stopOnResponse: true,
});

export default function SequencesPage() {
    const { user, getAccessToken, redirectToLogin, loading: authLoading } = useAuth();
    const router = useRouter();

    const [sequences, setSequences] = useState<Sequence[]>([]);
    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const hasFetched = useRef(false);

    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [quietStart, setQuietStart] = useState('');
    const [quietEnd, setQuietEnd] = useState('');
    const [timezone, setTimezone] = useState('');
    const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) redirectToLogin();
    }, [authLoading, user, redirectToLogin]);

    const fetchAll = async () => {
        setIsLoading(true);
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

    const updateStep = (i: number, patch: Partial<StepDraft>) => {
        setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    };

    const handleCreate = async () => {
        if (!name.trim()) {
            toast.error('Give the sequence a name');
            return;
        }
        for (const [i, s] of steps.entries()) {
            if (s.channel === 'voice' && !s.workflowId) {
                toast.error(`Step ${i + 1}: pick a voice agent`);
                return;
            }
        }
        setSaving(true);
        try {
            const token = await getAccessToken();
            const res = await createSequence(token, {
                name,
                status: 'active',
                quiet_hours_start: quietStart === '' ? null : Number(quietStart),
                quiet_hours_end: quietEnd === '' ? null : Number(quietEnd),
                default_timezone: timezone || null,
                steps: steps.map((s) => ({
                    channel: s.channel,
                    delay_seconds: Math.round(s.delayMinutes * 60),
                    workflow_id: s.channel === 'voice' ? Number(s.workflowId) : null,
                    stop_on_response: s.stopOnResponse,
                })),
            });
            if (res.error) {
                toast.error(detailFromError(res.error, 'Failed to create sequence'));
                return;
            }
            toast.success('Sequence created');
            setCreateOpen(false);
            setName('');
            setQuietStart('');
            setQuietEnd('');
            setTimezone('');
            setSteps([emptyStep()]);
            await fetchAll();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold mb-2">Reactivation Sequences</h1>
                    <p>Multi-step wake-up cadences that stop when a lead responds</p>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    New Sequence
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>All Sequences</CardTitle>
                    <CardDescription>Enroll leads from a sequence&apos;s page</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="animate-pulse space-y-3">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="h-12 bg-muted rounded"></div>
                            ))}
                        </div>
                    ) : sequences.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Steps</TableHead>
                                        <TableHead>Quiet hours</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sequences.map((seq) => (
                                        <TableRow
                                            key={seq.id}
                                            className="cursor-pointer hover:bg-muted/50"
                                            onClick={() => router.push(`/sequences/${seq.id}`)}
                                        >
                                            <TableCell className="font-medium">{seq.name}</TableCell>
                                            <TableCell>
                                                <Badge variant={seq.status === 'active' ? 'default' : 'secondary'}>
                                                    {seq.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{seq.steps.length}</TableCell>
                                            <TableCell>
                                                {seq.quiet_hours_start != null && seq.quiet_hours_end != null
                                                    ? `${seq.quiet_hours_start}:00 – ${seq.quiet_hours_end}:00`
                                                    : '—'}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        router.push(`/sequences/${seq.id}`);
                                                    }}
                                                >
                                                    Open
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-muted-foreground">
                            No sequences yet. Create one to start reactivating leads.
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>New reactivation sequence</DialogTitle>
                        <DialogDescription>
                            Steps fire in order. Each delay is measured from the previous step
                            (step 1 fires at enrollment). The cadence stops automatically when a
                            lead engages on a call.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="seq-name">Name</Label>
                            <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <Label htmlFor="qs">Quiet from (hour)</Label>
                                <Input id="qs" type="number" min={0} max={23} value={quietStart}
                                    onChange={(e) => setQuietStart(e.target.value)} placeholder="21" />
                            </div>
                            <div>
                                <Label htmlFor="qe">Quiet until (hour)</Label>
                                <Input id="qe" type="number" min={0} max={23} value={quietEnd}
                                    onChange={(e) => setQuietEnd(e.target.value)} placeholder="9" />
                            </div>
                            <div>
                                <Label htmlFor="tz">Default timezone</Label>
                                <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}
                                    placeholder="America/New_York" />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Label>Steps</Label>
                            {steps.map((step, i) => (
                                <div key={i} className="border rounded p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">Step {i + 1}</span>
                                        {steps.length > 1 && (
                                            <Button variant="ghost" size="sm"
                                                onClick={() => setSteps((p) => p.filter((_, idx) => idx !== i))}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-xs">Channel</Label>
                                            <Select value={step.channel}
                                                onValueChange={(v) => updateStep(i, { channel: v })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="voice">Voice call</SelectItem>
                                                    <SelectItem value="sms">SMS (coming soon)</SelectItem>
                                                    <SelectItem value="email">Email (coming soon)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <Label className="text-xs">
                                                {i === 0 ? 'Delay after enrollment (min)' : 'Delay after previous (min)'}
                                            </Label>
                                            <Input type="number" min={0} value={step.delayMinutes}
                                                onChange={(e) => updateStep(i, { delayMinutes: Number(e.target.value) })} />
                                        </div>
                                    </div>
                                    {step.channel === 'voice' && (
                                        <div>
                                            <Label className="text-xs">Voice agent</Label>
                                            <Select value={step.workflowId}
                                                onValueChange={(v) => updateStep(i, { workflowId: v })}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select a voice agent" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {workflows.map((w) => (
                                                        <SelectItem key={w.id} value={String(w.id)}>
                                                            {w.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <Checkbox id={`stop-${i}`} checked={step.stopOnResponse}
                                            onCheckedChange={(v) => updateStep(i, { stopOnResponse: Boolean(v) })} />
                                        <Label htmlFor={`stop-${i}`} className="text-xs">
                                            Stop the cadence if the lead engages on this step
                                        </Label>
                                    </div>
                                </div>
                            ))}
                            <Button variant="outline" size="sm" onClick={() => setSteps((p) => [...p, emptyStep()])}>
                                <Plus className="h-4 w-4 mr-2" />
                                Add step
                            </Button>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} disabled={saving}>
                            {saving ? 'Creating…' : 'Create sequence'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
