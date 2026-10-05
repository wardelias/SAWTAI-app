import type { FlowEdge, FlowNode } from "@/components/flow/types";

/**
 * Order nodes the way a call moves through them: start node first, then a
 * breadth-first walk of the edges, then anything unreachable (global prompt,
 * triggers, webhooks, QA) at the end.
 */
export function orderNodesByFlow(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const next = new Map<string, string[]>();
    for (const edge of edges) {
        next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
    }
    const ordered: FlowNode[] = [];
    const seen = new Set<string>();
    const queue = nodes.filter((n) => n.type === "startCall").map((n) => n.id);
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id) || !byId.has(id)) continue;
        seen.add(id);
        ordered.push(byId.get(id)!);
        queue.push(...(next.get(id) ?? []));
    }
    const rest = nodes.filter((n) => !seen.has(n.id));
    const restRank = (n: FlowNode) =>
        n.type === "agentNode" ? 0 : n.type === "endCall" ? 1 : n.type === "globalNode" ? 2 : 3;
    return [...ordered, ...rest.sort((a, b) => restRank(a) - restRank(b))];
}
