import { describe, expect, it } from 'vitest';

import { describeLeadActivity, leadActivityCallHref } from '@/lib/leadActivity';
import type { LeadActivity } from '@/lib/leadsApi';

const activity = (type: string, payload: Record<string, unknown>, runId: number | null = null): LeadActivity => ({
    id: 1,
    lead_id: 1,
    channel: 'voice',
    direction: 'outbound',
    type,
    workflow_run_id: runId,
    payload,
    created_at: null,
});

describe('leadActivity', () => {
    it('describes call outcomes in plain words', () => {
        expect(describeLeadActivity(activity('call_completed', { engaged: true, disposition: 'meeting_booked', sequence_id: 3, step_order: 1 })))
            .toBe('Talked to the agent — meeting booked (sequence step 2)');
        expect(describeLeadActivity(activity('call_completed', { engaged: false, disposition: 'no_answer', campaign_id: 9 })))
            .toBe('Call not answered (no answer) (campaign)');
        expect(describeLeadActivity(activity('call_failed', { error: 'No caller ID' })))
            .toBe('Call could not be placed: No caller ID');
    });

    it('explains skipped texts', () => {
        expect(describeLeadActivity(activity('sms_skipped', { reason: 'no_sms_consent' })))
            .toBe('Text skipped — lead has not consented to SMS');
    });

    it('links calls to their run page only when the agent is known', () => {
        expect(leadActivityCallHref(activity('call_placed', { workflow_id: 7 }, 42))).toBe('/workflow/7/run/42');
        expect(leadActivityCallHref(activity('call_placed', {}, 42))).toBeNull();
    });
});
