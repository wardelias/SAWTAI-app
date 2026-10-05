"use client";

import { ArrowDown, ArrowUp, MessageSquare, Phone, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { detailFromError } from '@/lib/apiError';
import {
    createSequence,
    type Sequence,
    type SequenceBody,
    type SequenceChannel,
    updateSequence,
    type WorkflowSummary,
} from '@/lib/sequencesApi';

import {
    allTimezones,
    browserTimezone,
    type DelayUnit,
    formatHour,
    splitDelay,
    UNIT_SECONDS,
} from './sequenceFormat';

interface StepDraft {
    key: number;
    channel: SequenceChannel;
    delayAmount: string;
    delayUnit: DelayUnit;
    workflowId: string;
    messageText: string;
    stopOnResponse: boolean;
}

let nextKey = 1;

function newStep(isFirst: boolean, workflowId = ''): StepDraft {
    return {
        key: nextKey++,
        channel: 'voice',
        delayAmount: isFirst ? '0' : '2',
        delayUnit: isFirst ? 'minutes' : 'days',
        workflowId,
        messageText: '',
        stopOnResponse: true,
    };
}

function draftsFrom(sequence: Sequence): StepDraft[] {
    return [...sequence.steps]
        .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
        .map((s) => {
            const { amount, unit } = splitDelay(s.delay_seconds);
            return {
                key: nextKey++,
                channel: (s.channel === 'sms' ? 'sms' : 'voice') as SequenceChannel,
                delayAmount: String(amount),
                delayUnit: unit,
                workflowId: s.workflow_id ? String(s.workflow_id) : '',
                messageText: s.message_text ?? '',
                stopOnResponse: s.stop_on_response,
            };
        });
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Sequence to edit; null to create a new one. */
    sequence: Sequence | null;
    workflows: WorkflowSummary[];
    getAccessToken: () => Promise<string>;
    onSaved: (sequence: Sequence) => void;
}

export default function SequenceEditorDialog({
    open,
    onOpenChange,
    sequence,
    workflows,
    getAccessToken,
    onSaved,
}: Props) {
    const [name, setName] = useState('');
    const [steps, setSteps] = useState<StepDraft[]>([]);
    const [quietEnabled, setQuietEnabled] = useState(true);
    const [quietStart, setQuietStart] = useState('21');
    const [quietEnd, setQuietEnd] = useState('9');
    const [timezone, setTimezone] = useState(browserTimezone());
    const [startActive, setStartActive] = useState(true);
    const [saving, setSaving] = useState(false);
    const [timezones, setTimezones] = useState<string[]>([]);

    // Reset the form whenever the dialog opens.
    useEffect(() => {
        if (!open) return;
        setTimezones(allTimezones());
        const defaultAgent = workflows.length === 1 ? String(workflows[0].id) : '';
        if (sequence) {
            setName(sequence.name);
            setSteps(draftsFrom(sequence));
            const hasQuiet = sequence.quiet_hours_start != null && sequence.quiet_hours_end != null;
            setQuietEnabled(hasQuiet);
            setQuietStart(String(sequence.quiet_hours_start ?? 21));
            setQuietEnd(String(sequence.quiet_hours_end ?? 9));
            setTimezone(sequence.default_timezone || browserTimezone());
        } else {
            setName('');
            setSteps([newStep(true, defaultAgent), { ...newStep(false, defaultAgent) }]);
            setQuietEnabled(true);
            setQuietStart('21');
            setQuietEnd('9');
            setTimezone(browserTimezone());
            setStartActive(true);
        }
    }, [open, sequence, workflows]);

    const updateStep = (key: number, patch: Partial<StepDraft>) =>
        setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

    const moveStep = (index: number, delta: number) =>
        setSteps((prev) => {
            const next = [...prev];
            const target = index + delta;
            if (target < 0 || target >= next.length) return prev;
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error('Give the sequence a name');
            return;
        }
        if (steps.length === 0) {
            toast.error('Add at least one step');
            return;
        }
        for (const [i, s] of steps.entries()) {
            const amount = Number(s.delayAmount);
            if (!Number.isFinite(amount) || amount < 0) {
                toast.error(`Step ${i + 1}: enter a wait time of 0 or more`);
                return;
            }
            if (s.channel === 'voice' && !s.workflowId) {
                toast.error(`Step ${i + 1}: pick the voice agent that should call`);
                return;
            }
            if (s.channel === 'sms' && !s.messageText.trim()) {
                toast.error(`Step ${i + 1}: write the text message`);
                return;
            }
        }
        if (quietEnabled && quietStart === quietEnd) {
            toast.error('Quiet hours start and end must be different');
            return;
        }

        const body: SequenceBody = {
            name: name.trim(),
            quiet_hours_start: quietEnabled ? Number(quietStart) : null,
            quiet_hours_end: quietEnabled ? Number(quietEnd) : null,
            default_timezone: timezone.trim() || null,
            steps: steps.map((s) => ({
                channel: s.channel,
                delay_seconds: Math.round(Number(s.delayAmount) * UNIT_SECONDS[s.delayUnit]),
                workflow_id: s.channel === 'voice' ? Number(s.workflowId) : null,
                message_text: s.channel === 'sms' ? s.messageText.trim() : null,
                stop_on_response: s.stopOnResponse,
            })),
        };

        setSaving(true);
        try {
            const token = await getAccessToken();
            const res = sequence
                ? await updateSequence(token, sequence.id, body)
                : await createSequence(token, { ...body, status: startActive ? 'active' : 'paused' });
            if (res.error || !res.data) {
                toast.error(detailFromError(res.error, 'Could not save the sequence'));
                return;
            }
            toast.success(sequence ? 'Sequence updated' : 'Sequence created — now add leads to it');
            onOpenChange(false);
            onSaved(res.data);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{sequence ? 'Edit sequence' : 'New sequence'}</DialogTitle>
                    <DialogDescription>
                        Each lead you add goes through these steps in order. The sequence stops by
                        itself as soon as the lead talks to your agent.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    <div className="space-y-2">
                        <Label htmlFor="seq-name">Name</Label>
                        <Input
                            id="seq-name"
                            value={name}
                            placeholder="e.g. Win back lapsed customers"
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-3">
                        <Label>Steps</Label>
                        {workflows.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                                You need a voice agent to make calls.{' '}
                                <Link href="/workflow" className="underline">Create an agent</Link> first.
                            </p>
                        )}
                        {steps.map((step, i) => (
                            <div key={step.key} className="rounded-md border p-3 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium flex items-center gap-2">
                                        {step.channel === 'voice' ? <Phone className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                                        Step {i + 1}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <Button type="button" variant="ghost" size="icon" disabled={i === 0}
                                            aria-label="Move step up" onClick={() => moveStep(i, -1)}>
                                            <ArrowUp className="h-4 w-4" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon" disabled={i === steps.length - 1}
                                            aria-label="Move step down" onClick={() => moveStep(i, 1)}>
                                            <ArrowDown className="h-4 w-4" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon" disabled={steps.length === 1}
                                            aria-label="Remove step"
                                            onClick={() => setSteps((p) => p.filter((s) => s.key !== step.key))}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">What to do</Label>
                                        <Select value={step.channel}
                                            onValueChange={(v) => updateStep(step.key, { channel: v as SequenceChannel })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="voice">Call with a voice agent</SelectItem>
                                                <SelectItem value="sms">Send a text message (SMS)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">
                                            {i === 0 ? 'Wait after the lead is added' : 'Wait after the previous step'}
                                        </Label>
                                        <div className="flex gap-2">
                                            <Input type="number" min={0} className="w-24" value={step.delayAmount}
                                                onChange={(e) => updateStep(step.key, { delayAmount: e.target.value })} />
                                            <Select value={step.delayUnit}
                                                onValueChange={(v) => updateStep(step.key, { delayUnit: v as DelayUnit })}>
                                                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="minutes">minutes</SelectItem>
                                                    <SelectItem value="hours">hours</SelectItem>
                                                    <SelectItem value="days">days</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>

                                {step.channel === 'voice' ? (
                                    <>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Voice agent</Label>
                                            <Select value={step.workflowId}
                                                onValueChange={(v) => updateStep(step.key, { workflowId: v })}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Choose the agent that calls" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {workflows.map((w) => (
                                                        <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Checkbox id={`stop-${step.key}`} checked={step.stopOnResponse}
                                                onCheckedChange={(v) => updateStep(step.key, { stopOnResponse: Boolean(v) })} />
                                            <Label htmlFor={`stop-${step.key}`} className="text-xs font-normal">
                                                Stop the sequence when the lead talks to the agent on this call
                                            </Label>
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-1">
                                        <Label className="text-xs">Message</Label>
                                        <Textarea rows={3} maxLength={1600} value={step.messageText}
                                            placeholder="Hi {{first_name}}, it's been a while! Reply or call us back anytime."
                                            onChange={(e) => updateStep(step.key, { messageText: e.target.value })} />
                                        <p className="text-xs text-muted-foreground">
                                            Use {'{{first_name}}'}, {'{{last_name}}'} or any imported lead column. Texts
                                            go only to leads marked as SMS-consented, via your Twilio number.
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                        <Button type="button" variant="outline" size="sm"
                            onClick={() => setSteps((p) => [...p, newStep(p.length === 0, p[p.length - 1]?.workflowId ?? '')])}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add step
                        </Button>
                    </div>

                    <div className="space-y-3 rounded-md border p-3">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <Label htmlFor="quiet-enabled">Quiet hours</Label>
                                <p className="text-xs text-muted-foreground">
                                    Don&apos;t call or text during these hours (in the lead&apos;s timezone when known).
                                    Steps due then wait until the quiet hours end.
                                </p>
                            </div>
                            <Switch id="quiet-enabled" checked={quietEnabled} onCheckedChange={setQuietEnabled} />
                        </div>
                        {quietEnabled && (
                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">No contact from</Label>
                                    <Select value={quietStart} onValueChange={setQuietStart}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {HOURS.map((h) => (
                                                <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Until</Label>
                                    <Select value={quietEnd} onValueChange={setQuietEnd}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {HOURS.map((h) => (
                                                <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="seq-tz" className="text-xs">Default timezone</Label>
                                    <Input id="seq-tz" list="seq-tz-options" value={timezone}
                                        onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Jerusalem" />
                                    <datalist id="seq-tz-options">
                                        {timezones.map((tz) => <option key={tz} value={tz} />)}
                                    </datalist>
                                </div>
                            </div>
                        )}
                    </div>

                    {!sequence && (
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <Label htmlFor="start-active">Turn on right away</Label>
                                <p className="text-xs text-muted-foreground">
                                    When off, leads you add wait until you resume the sequence.
                                </p>
                            </div>
                            <Switch id="start-active" checked={startActive} onCheckedChange={setStartActive} />
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : sequence ? 'Save changes' : 'Create sequence'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
