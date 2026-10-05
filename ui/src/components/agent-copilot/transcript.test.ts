import { describe, expect, it } from 'vitest';

import { type CopilotEvent, parseSseChunk } from '@/lib/agentCopilot';

import { applyCopilotEvent, type AssistantTurn } from './transcript';

function play(events: CopilotEvent[]): AssistantTurn {
    return events.reduce(applyCopilotEvent, { parts: [], stepSnapshot: [] });
}

describe('applyCopilotEvent', () => {
    it('merges consecutive deltas and tracks tool status', () => {
        const turn = play([
            { type: 'step_start' },
            { type: 'progress', text: 'Reading ' },
            { type: 'progress', text: 'the agent.' },
            { type: 'tool_start', id: 't1', name: 'save_workflow' },
            {
                type: 'tool_end',
                id: 't1',
                name: 'save_workflow',
                ok: true,
                workflow_id: 5,
                workflow_name: 'Sales',
            },
            { type: 'step_start' },
            { type: 'text', text: 'Saved ' },
            { type: 'text', text: 'a draft.' },
        ]);

        expect(turn.parts).toEqual([
            { kind: 'progress', text: 'Reading the agent.' },
            { kind: 'tool', id: 't1', name: 'save_workflow', status: 'ok', workflowId: 5, workflowName: 'Sales' },
            { kind: 'text', text: 'Saved a draft.' },
        ]);
    });

    it('drops output from a retried step only', () => {
        const turn = play([
            { type: 'step_start' },
            { type: 'text', text: 'First step.' },
            { type: 'step_start' },
            { type: 'text', text: 'partial' },
            { type: 'step_retry' },
            { type: 'step_start' },
            { type: 'text', text: 'Retried.' },
        ]);

        expect(turn.parts).toEqual([{ kind: 'text', text: 'First step.Retried.' }]);
    });

    it('marks failed tools and appends errors', () => {
        const turn = play([
            { type: 'tool_start', id: 't1', name: 'get_workflow_code' },
            { type: 'tool_end', id: 't1', name: 'get_workflow_code', ok: false },
            { type: 'error', message: 'The assistant is busy.' },
        ]);

        expect(turn.parts).toEqual([
            { kind: 'tool', id: 't1', name: 'get_workflow_code', status: 'error', workflowId: undefined, workflowName: undefined },
            { kind: 'error', text: 'The assistant is busy.' },
        ]);
    });
});

describe('parseSseChunk', () => {
    it('returns complete events and keeps a partial frame for the next chunk', () => {
        const { events, rest } = parseSseChunk(
            'data: {"type":"text","text":"Hi"}\n\ndata: {"type":"done"}\n\ndata: {"type":"te',
        );

        expect(events).toEqual([{ type: 'text', text: 'Hi' }, { type: 'done' }]);
        expect(rest).toBe('data: {"type":"te');
    });
});
