import { describe, expect, it } from 'vitest';

import { insightFixPrompt } from './agentCopilot';

describe('insightFixPrompt', () => {
    it('builds the fix request from the stored issue', () => {
        const prompt = insightFixPrompt({
            title: 'Greeting too long',
            severity: 'high',
            what_happened: 'Callers hung up during the greeting.',
            evidence: '"Uh, hello?"',
            suggestion: 'Keep the greeting to one sentence.',
            needs_change: true,
            call_ids: [2, 3],
            agents: [{ id: 1, name: 'Reception' }],
        });

        expect(prompt).toBe(
            [
                'Fix this issue found in my recent calls:',
                '',
                'Issue: Greeting too long — Callers hung up during the greeting.',
                'Evidence: "Uh, hello?"',
                'Suggested change: Keep the greeting to one sentence.',
                'Calls: #2, #3',
                '',
                'Read those calls first, then apply the change to this agent as a draft and tell me what you changed.',
            ].join('\n'),
        );
    });

    it('omits empty evidence and calls without leaving blank gaps', () => {
        const prompt = insightFixPrompt({
            title: 'T',
            severity: 'low',
            what_happened: 'W',
            evidence: '',
            suggestion: 'S',
            needs_change: true,
            call_ids: [],
            agents: [],
        });
        expect(prompt).not.toContain('Evidence:');
        expect(prompt).not.toContain('Calls:');
        expect(prompt).not.toMatch(/\n\n\n/);
    });
});
