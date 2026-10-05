import { describe, expect, it } from 'vitest';

import type { Sequence } from '@/lib/sequencesApi';

import { describeStopReason, formatDelay, splitDelay, summarizeSteps } from './sequenceFormat';

describe('sequenceFormat', () => {
    it('splits delays into the largest whole unit', () => {
        expect(splitDelay(2 * 86400)).toEqual({ amount: 2, unit: 'days' });
        expect(splitDelay(3 * 3600)).toEqual({ amount: 3, unit: 'hours' });
        expect(splitDelay(90 * 60)).toEqual({ amount: 90, unit: 'minutes' });
        expect(splitDelay(0)).toEqual({ amount: 0, unit: 'minutes' });
    });

    it('formats delays for people', () => {
        expect(formatDelay(0)).toBe('right away');
        expect(formatDelay(86400)).toBe('1 day');
        expect(formatDelay(2 * 3600)).toBe('2 hours');
    });

    it('summarizes the cadence', () => {
        const seq = {
            steps: [
                { step_order: 0, channel: 'voice', delay_seconds: 0, workflow_id: 1, stop_on_response: true },
                { step_order: 1, channel: 'voice', delay_seconds: 2 * 86400, workflow_id: 1, stop_on_response: true },
                { step_order: 2, channel: 'sms', delay_seconds: 86400, workflow_id: null, stop_on_response: true },
            ],
        } as unknown as Sequence;
        expect(summarizeSteps(seq)).toBe('Call → 2 days → Call → 1 day → SMS');
    });

    it('explains why a lead left the sequence', () => {
        expect(describeStopReason('responded:interested')).toBe('Responded (interested)');
        expect(describeStopReason('stopped_manually')).toBe('Stopped by you');
        expect(describeStopReason('suppressed:dnc')).toBe('On do-not-call list');
    });
});
