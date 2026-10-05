import type { EnrollmentState, Sequence, SequenceStep } from '@/lib/sequencesApi';

export type DelayUnit = 'minutes' | 'hours' | 'days';

export const UNIT_SECONDS: Record<DelayUnit, number> = {
    minutes: 60,
    hours: 3600,
    days: 86400,
};

/** Express a delay in the largest unit that divides it evenly. */
export function splitDelay(seconds: number): { amount: number; unit: DelayUnit } {
    if (seconds > 0 && seconds % UNIT_SECONDS.days === 0) {
        return { amount: seconds / UNIT_SECONDS.days, unit: 'days' };
    }
    if (seconds > 0 && seconds % UNIT_SECONDS.hours === 0) {
        return { amount: seconds / UNIT_SECONDS.hours, unit: 'hours' };
    }
    return { amount: Math.round(seconds / 60), unit: 'minutes' };
}

export function formatDelay(seconds: number): string {
    if (!seconds) return 'right away';
    const { amount, unit } = splitDelay(seconds);
    const label = amount === 1 ? unit.slice(0, -1) : unit;
    return `${amount} ${label}`;
}

export function describeStepTiming(step: SequenceStep, index: number): string {
    if (index === 0) {
        return step.delay_seconds ? `${formatDelay(step.delay_seconds)} after enrolling` : 'As soon as a lead is added';
    }
    return step.delay_seconds
        ? `${formatDelay(step.delay_seconds)} after the previous step`
        : 'Right after the previous step';
}

export function channelLabel(channel: string): string {
    if (channel === 'voice') return 'Call';
    if (channel === 'sms') return 'SMS';
    return channel;
}

/** "Call → 2 days → Call → 1 day → SMS" */
export function summarizeSteps(sequence: Sequence): string {
    const steps = [...sequence.steps].sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
    return steps
        .map((s, i) => {
            const label = channelLabel(s.channel);
            if (i === 0 || !s.delay_seconds) return label;
            return `${formatDelay(s.delay_seconds)} → ${label}`;
        })
        .join(' → ');
}

export function formatHour(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
}

export const STATE_LABELS: Record<EnrollmentState, string> = {
    active: 'In progress',
    completed: 'Finished (no response)',
    stopped: 'Stopped',
    converted: 'Converted',
};

export function stateVariant(state: string): 'default' | 'secondary' | 'outline' | 'destructive' {
    if (state === 'converted') return 'default';
    if (state === 'active') return 'outline';
    return 'secondary';
}

export function describeStopReason(reason: string | null): string {
    if (!reason) return '';
    if (reason === 'stopped_manually') return 'Stopped by you';
    if (reason === 'opted_out') return 'Asked not to be contacted';
    if (reason.startsWith('responded:campaign_')) return 'Responded to a campaign call';
    if (reason.startsWith('responded:')) {
        const what = reason.slice('responded:'.length).replace(/_/g, ' ');
        return what === 'engaged' ? 'Talked to the agent' : `Responded (${what})`;
    }
    if (reason.startsWith('suppressed:')) {
        const why = reason.slice('suppressed:'.length);
        return why === 'dnc' ? 'On do-not-call list' : `Lead is ${why}`;
    }
    if (reason === 'lead_or_sequence_missing') return 'Lead was deleted';
    return reason.replace(/_/g, ' ');
}

export function browserTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

export function allTimezones(): string[] {
    try {
        const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
        return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
    } catch {
        return [];
    }
}
