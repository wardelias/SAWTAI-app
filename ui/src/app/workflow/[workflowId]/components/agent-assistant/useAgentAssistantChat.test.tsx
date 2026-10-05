import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock("@/client/sdk.gen", () => ({
    chatWithAgentAssistantApiV1WorkflowWorkflowIdAssistantPost: chatMock,
}));

import { useAgentAssistantChat } from "./useAgentAssistantChat";

const definition = { nodes: [], edges: [] };
const suggestion = { node_id: "1", node_name: "Greeting", summary: "Shorter", prompt: "Hi." };

describe("useAgentAssistantChat", () => {
    beforeEach(() => {
        chatMock.mockReset();
    });

    it("sends the conversation and appends the reply with its suggestions", async () => {
        chatMock.mockResolvedValueOnce({ data: { reply: "Done.", suggestions: [suggestion] } });
        const { result } = renderHook(() => useAgentAssistantChat(7));

        await act(async () => {
            await result.current.send("  Make it shorter ", { workflowDefinition: definition, focusNodeId: "1" });
        });

        expect(chatMock).toHaveBeenCalledWith({
            path: { workflow_id: 7 },
            body: {
                messages: [{ role: "user", content: "Make it shorter" }],
                workflow_definition: definition,
                focus_node_id: "1",
            },
        });
        expect(result.current.messages).toMatchObject([
            { role: "user", content: "Make it shorter" },
            { role: "assistant", content: "Done.", suggestions: [suggestion], applied: [] },
        ]);
        expect(result.current.pending).toBe(false);
    });

    it("tells the model which edits it proposed earlier", async () => {
        chatMock
            .mockResolvedValueOnce({ data: { reply: "Done.", suggestions: [suggestion] } })
            .mockResolvedValueOnce({ data: { reply: "Sure.", suggestions: [] } });
        const { result } = renderHook(() => useAgentAssistantChat(7));

        await act(async () => {
            await result.current.send("Shorten it", { workflowDefinition: definition });
        });
        await act(async () => {
            await result.current.send("Why?", { workflowDefinition: definition });
        });

        const { messages } = chatMock.mock.calls[1][0].body;
        expect(messages[1]).toEqual({
            role: "assistant",
            content: "Done.\n\nSuggested prompt changes:\n- Greeting: Shorter",
        });
        expect(messages[2]).toEqual({ role: "user", content: "Why?" });
    });

    it("surfaces API errors and lets the failed message be taken back for a retry", async () => {
        chatMock.mockResolvedValueOnce({ error: { detail: "No language model is configured." } });
        const { result } = renderHook(() => useAgentAssistantChat(7));

        await act(async () => {
            await result.current.send("Hello", { workflowDefinition: definition });
        });
        expect(result.current.error).toBe("No language model is configured.");

        let taken: string | null = null;
        act(() => {
            taken = result.current.takeBackLastUserMessage();
        });
        expect(taken).toBe("Hello");
        expect(result.current.messages).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    it("marks a suggestion as applied once", async () => {
        chatMock.mockResolvedValueOnce({ data: { reply: "Done.", suggestions: [suggestion] } });
        const { result } = renderHook(() => useAgentAssistantChat(7));
        await act(async () => {
            await result.current.send("Shorten it", { workflowDefinition: definition });
        });
        const assistantId = result.current.messages[1].id;

        act(() => {
            result.current.markApplied(assistantId, "1");
            result.current.markApplied(assistantId, "1");
        });

        expect(result.current.messages[1]).toMatchObject({ applied: ["1"] });
    });

    it("drops a reply that arrives after the chat was reset", async () => {
        let resolve: (value: unknown) => void = () => {};
        chatMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
        const { result } = renderHook(() => useAgentAssistantChat(7));

        let pendingSend: Promise<void> = Promise.resolve();
        act(() => {
            pendingSend = result.current.send("Hello", { workflowDefinition: definition });
        });
        await waitFor(() => expect(result.current.pending).toBe(true));

        act(() => result.current.reset());
        await act(async () => {
            resolve({ data: { reply: "Late reply", suggestions: [] } });
            await pendingSend;
        });

        expect(result.current.messages).toEqual([]);
        expect(result.current.pending).toBe(false);
    });
});
