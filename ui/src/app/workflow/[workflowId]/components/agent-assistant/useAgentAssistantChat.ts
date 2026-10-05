import { useCallback, useRef, useState } from "react";

import { chatWithAgentAssistantApiV1WorkflowWorkflowIdAssistantPost } from "@/client/sdk.gen";
import type { AgentAssistantSuggestion } from "@/client/types.gen";
import { detailFromError } from "@/lib/apiError";

export type AssistantChatMessage =
    | { id: string; role: "user"; content: string }
    | {
          id: string;
          role: "assistant";
          content: string;
          suggestions: AgentAssistantSuggestion[];
          /** node ids whose suggestion the builder already applied */
          applied: string[];
      };

interface SendOptions {
    workflowDefinition: Record<string, unknown>;
    focusNodeId?: string | null;
}

let messageCounter = 0;
const nextId = () => `m${Date.now().toString(36)}${(messageCounter++).toString(36)}`;

/** What the model sees for one of its earlier turns, including what it proposed. */
function historyContent(message: AssistantChatMessage): string {
    if (message.role === "user" || message.suggestions.length === 0) {
        return message.content;
    }
    const proposed = message.suggestions
        .map((s) => `- ${s.node_name}: ${s.summary || "rewrote the prompt"}`)
        .join("\n");
    return `${message.content}\n\nSuggested prompt changes:\n${proposed}`;
}

/**
 * Conversation state for the in-editor AI assistant. Lives above the panel so
 * closing and reopening the sheet keeps the thread.
 */
export function useAgentAssistantChat(workflowId: number) {
    const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Guards against a reset landing while a request is in flight.
    const conversationRef = useRef(0);

    const send = useCallback(
        async (text: string, { workflowDefinition, focusNodeId }: SendOptions) => {
            const content = text.trim();
            if (!content || pending) return;

            const conversation = conversationRef.current;
            const userMessage: AssistantChatMessage = { id: nextId(), role: "user", content };
            const history = [...messages, userMessage];
            setMessages(history);
            setPending(true);
            setError(null);

            try {
                const response = await chatWithAgentAssistantApiV1WorkflowWorkflowIdAssistantPost({
                    path: { workflow_id: workflowId },
                    body: {
                        messages: history.map((m) => ({ role: m.role, content: historyContent(m) })),
                        workflow_definition: workflowDefinition,
                        focus_node_id: focusNodeId ?? null,
                    },
                });
                if (conversation !== conversationRef.current) return;
                if (response.error || !response.data) {
                    setError(detailFromError(response.error, "The assistant couldn't answer. Please try again."));
                    return;
                }
                const data = response.data;
                setMessages((prev) => [
                    ...prev,
                    {
                        id: nextId(),
                        role: "assistant",
                        content: data.reply,
                        suggestions: data.suggestions,
                        applied: [],
                    },
                ]);
            } catch {
                if (conversation !== conversationRef.current) return;
                setError("Couldn't reach the assistant. Check your connection and try again.");
            } finally {
                if (conversation === conversationRef.current) setPending(false);
            }
        },
        [messages, pending, workflowId],
    );

    /** Drop the failed user turn so it can be re-sent from the composer. */
    const takeBackLastUserMessage = useCallback((): string | null => {
        const last = messages[messages.length - 1];
        if (!last || last.role !== "user") return null;
        setMessages(messages.slice(0, -1));
        setError(null);
        return last.content;
    }, [messages]);

    const markApplied = useCallback((messageId: string, nodeId: string) => {
        setMessages((prev) =>
            prev.map((m) =>
                m.id === messageId && m.role === "assistant" && !m.applied.includes(nodeId)
                    ? { ...m, applied: [...m.applied, nodeId] }
                    : m,
            ),
        );
    }, []);

    const reset = useCallback(() => {
        conversationRef.current += 1;
        setMessages([]);
        setPending(false);
        setError(null);
    }, []);

    return { messages, pending, error, send, markApplied, reset, takeBackLastUserMessage };
}

export type AgentAssistantChat = ReturnType<typeof useAgentAssistantChat>;
