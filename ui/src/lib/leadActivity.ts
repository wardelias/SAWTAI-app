import type { LeadActivity } from '@/lib/leadsApi';

const SKIP_REASONS: Record<string, string> = {
    no_sms_consent: 'lead has not consented to SMS',
    channel_not_supported: 'this channel is not available yet',
    channel_not_yet_implemented: 'this channel is not available yet',
    voice_step_missing_agent: 'the step has no voice agent',
};

function str(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

/** One human-readable line for a lead timeline entry. */
export function describeLeadActivity(a: LeadActivity): string {
    const p = a.payload ?? {};
    const reason = str(p.reason);
    const error = str(p.error);
    const disposition = str(p.disposition)?.replace(/_/g, ' ');
    const source =
        p.sequence_id != null
            ? ` (sequence step ${Number(p.step_order ?? 0) + 1})`
            : p.campaign_id != null
                ? ' (campaign)'
                : '';

    switch (a.type) {
        case 'call_placed':
            return `Call placed${source}`;
        case 'call_completed':
            if (p.engaged) {
                return `Talked to the agent${disposition ? ` — ${disposition}` : ''}${source}`;
            }
            return `Call not answered${disposition ? ` (${disposition})` : ''}${source}`;
        case 'call_failed':
            return `Call could not be placed: ${error ?? (reason && SKIP_REASONS[reason]) ?? 'unknown error'}`;
        case 'sms_sent':
            return `Text sent${source}: “${str(p.body) ?? ''}”`;
        case 'sms_failed':
            return `Text could not be sent: ${error ?? 'unknown error'}`;
        case 'sms_skipped':
        case 'email_skipped':
            return `${a.type === 'sms_skipped' ? 'Text' : 'Email'} skipped — ${(reason && SKIP_REASONS[reason]) ?? reason ?? 'not sent'}`;
        default:
            return a.type.replace(/_/g, ' ');
    }
}

/** Link to the call's recording/transcript page, when the entry is a call. */
export function leadActivityCallHref(a: LeadActivity): string | null {
    const workflowId = a.payload?.workflow_id;
    if (!a.workflow_run_id || workflowId == null) return null;
    return `/workflow/${workflowId}/run/${a.workflow_run_id}`;
}
