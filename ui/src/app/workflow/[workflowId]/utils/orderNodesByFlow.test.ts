import { describe, expect, it } from "vitest";

import type { FlowEdge, FlowNode } from "@/components/flow/types";

import { orderNodesByFlow } from "./orderNodesByFlow";

const node = (id: string, type: string): FlowNode => ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: { name: id },
});
const edge = (source: string, target: string): FlowEdge => ({
    id: `${source}-${target}`,
    source,
    target,
    data: { condition: "", label: "" },
});

describe("orderNodesByFlow", () => {
    it("walks the call from the start node, then lists unreachable nodes by kind", () => {
        const nodes = [
            node("global", "globalNode"),
            node("end", "endCall"),
            node("qualify", "agentNode"),
            node("webhook", "webhook"),
            node("orphan", "agentNode"),
            node("start", "startCall"),
            node("book", "agentNode"),
        ];
        const edges = [edge("start", "qualify"), edge("qualify", "book"), edge("book", "end")];

        expect(orderNodesByFlow(nodes, edges).map((n) => n.id)).toEqual([
            "start",
            "qualify",
            "book",
            "end",
            "orphan",
            "global",
            "webhook",
        ]);
    });

    it("visits each node once even when the graph has cycles", () => {
        const nodes = [node("start", "startCall"), node("a", "agentNode"), node("b", "agentNode")];
        const edges = [edge("start", "a"), edge("a", "b"), edge("b", "a"), edge("b", "start")];

        expect(orderNodesByFlow(nodes, edges).map((n) => n.id)).toEqual(["start", "a", "b"]);
    });

    it("ignores edges pointing at nodes that no longer exist", () => {
        const nodes = [node("start", "startCall")];

        expect(orderNodesByFlow(nodes, [edge("start", "deleted")]).map((n) => n.id)).toEqual(["start"]);
    });
});
