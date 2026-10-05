import type { CopilotEvent } from '@/lib/agentCopilot';

export type AssistantPart =
    | { kind: 'text'; text: string }
    | { kind: 'progress'; text: string }
    | {
          kind: 'tool';
          id: string;
          name: string;
          status: 'running' | 'ok' | 'error';
          workflowId?: number;
          workflowName?: string;
      }
    | { kind: 'error'; text: string };

export interface AssistantTurn {
    parts: AssistantPart[];
    // parts as they were when the current model call began; a retried call
    // restores this (text deltas may have merged into an earlier part, so
    // truncating by index is not enough).
    stepSnapshot: AssistantPart[];
}

export type ChatMessage =
    | { role: 'user'; text: string }
    | ({ role: 'assistant'; pending: boolean } & AssistantTurn);

/** Fold one streamed event into the assistant turn being built. */
export function applyCopilotEvent(turn: AssistantTurn, event: CopilotEvent): AssistantTurn {
    const parts = turn.parts;
    const last = parts[parts.length - 1];
    switch (event.type) {
        case 'step_start':
            return { ...turn, stepSnapshot: parts };
        case 'step_retry':
            return { ...turn, parts: turn.stepSnapshot };
        case 'text':
        case 'progress': {
            const kind = event.type;
            if (last && last.kind === kind) {
                return { ...turn, parts: [...parts.slice(0, -1), { kind, text: last.text + event.text }] };
            }
            return { ...turn, parts: [...parts, { kind, text: event.text }] };
        }
        case 'tool_start':
            return {
                ...turn,
                parts: [...parts, { kind: 'tool', id: event.id, name: event.name, status: 'running' }],
            };
        case 'tool_end':
            return {
                ...turn,
                parts: parts.map((part) =>
                    part.kind === 'tool' && part.id === event.id
                        ? {
                              ...part,
                              status: event.ok ? 'ok' : 'error',
                              workflowId: event.workflow_id,
                              workflowName: event.workflow_name,
                          }
                        : part,
                ),
            };
        case 'error':
            return { ...turn, parts: [...parts, { kind: 'error', text: event.message }] };
        default:
            return turn;
    }
}

const TOOL_LABELS: Record<string, string> = {
    list_workflows: 'Looking up your agents',
    get_workflow: 'Reading the agent',
    get_workflow_code: 'Reading the agent',
    save_workflow: 'Saving a draft',
    create_workflow: 'Creating the agent',
    create_tool: 'Creating a tool',
    get_voice_prompting_guide: 'Checking voice prompting guidelines',
    list_node_types: 'Checking available building blocks',
    get_node_type: 'Checking available building blocks',
    list_tools: 'Checking your tools',
    list_credentials: 'Checking your credentials',
    list_documents: 'Checking your knowledge base',
    list_recordings: 'Checking your recordings',
    search_docs: 'Searching the docs',
    read_doc: 'Reading the docs',
    list_docs: 'Browsing the docs',
};

export function toolLabel(name: string): string {
    return TOOL_LABELS[name] ?? name;
}
