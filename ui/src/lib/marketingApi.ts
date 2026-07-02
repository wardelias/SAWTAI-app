/**
 * Typed client for the Marketing lead-source endpoints (api/routes/marketing.py).
 *
 * These wrap the shared hey-api `client` with explicit request/response types.
 * They live in `lib/` (not the auto-generated `src/client/`) so `npm run
 * generate-client` never clobbers them. Once the backend is reachable and the
 * client is regenerated, callers can swap to the generated
 * `*ApiV1Marketing*` SDK functions — the shapes match by design.
 */
import { client } from "@/client/client.gen";

export interface MetaConnection {
    id: number;
    source_type: string;
    form_id: string | null;
    form_name: string | null;
    page_id: string | null;
    workflow_id: number;
    workflow_name: string | null;
    call_after_seconds: number;
    max_retries: number;
    enabled: boolean;
    state: string;
    total_leads: number;
    created_at: string;
}

export interface MetaConnectionsResponse {
    connections: MetaConnection[];
}

export interface ConnectMetaPayload {
    page_access_token: string;
    form_id: string;
    page_id?: string;
    workflow_id: number;
    call_after_seconds: number;
    max_retries: number;
    country_hint?: string;
    name?: string;
}

export interface UpdateConnectionPayload {
    workflow_id?: number;
    call_after_seconds?: number;
    max_retries?: number;
    enabled?: boolean;
}

type AuthHeaders = { Authorization: string };

export function listMetaConnections(headers: AuthHeaders) {
    return client.get<MetaConnectionsResponse>({
        url: "/api/v1/marketing/connections",
        headers,
    });
}

export function connectMetaForm(payload: ConnectMetaPayload, headers: AuthHeaders) {
    return client.post<MetaConnection>({
        url: "/api/v1/marketing/connections/meta",
        body: payload,
        headers,
    });
}

export function updateMetaConnection(
    campaignId: number,
    payload: UpdateConnectionPayload,
    headers: AuthHeaders,
) {
    return client.patch<MetaConnection>({
        url: `/api/v1/marketing/connections/${campaignId}`,
        body: payload,
        headers,
    });
}

export function disconnectMetaConnection(campaignId: number, headers: AuthHeaders) {
    return client.delete({
        url: `/api/v1/marketing/connections/${campaignId}`,
        headers,
    });
}
