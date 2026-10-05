import { useCallback, useEffect, useRef, useState } from "react";

import { getWorkflowsApiV1WorkflowFetchGet } from "@/client/sdk.gen";
import type { WorkflowListResponse } from "@/client/types.gen";
import { useAuth } from "@/lib/auth";

/**
 * The organization's active agents, newest first. Fetches once auth is ready
 * and `enabled` is true, so callers can defer the request until it's needed
 * (e.g. until a sheet opens).
 */
export function useActiveAgents({ enabled = true }: { enabled?: boolean } = {}) {
    const { user, loading: authLoading } = useAuth();
    const [agents, setAgents] = useState<WorkflowListResponse[] | null>(null);
    const [error, setError] = useState(false);
    const hasFetched = useRef(false);

    const load = useCallback(async () => {
        setError(false);
        try {
            const response = await getWorkflowsApiV1WorkflowFetchGet({
                query: { status: "active" },
            });
            if (response.error || !response.data) {
                setError(true);
                return;
            }
            const list = Array.isArray(response.data) ? response.data : [response.data];
            setAgents(
                [...list].sort(
                    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                ),
            );
        } catch {
            setError(true);
        }
    }, []);

    useEffect(() => {
        if (!enabled || authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        void load();
    }, [enabled, authLoading, user, load]);

    return { agents, loading: agents === null && !error, error, reload: load };
}
