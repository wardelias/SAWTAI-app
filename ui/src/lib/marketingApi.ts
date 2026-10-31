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
    page_name: string | null;
    /** "oauth" when picked via Connect with Facebook, "token" when pasted by hand. */
    connected_via: "oauth" | "token";
    /** True when Meta pushes new leads by webhook (otherwise polled every ~2 min). */
    instant: boolean;
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
    /** Omit to use the connected Facebook account (then page_id is required). */
    page_access_token?: string;
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

export interface MetaAccount {
    /** False when the server has no Meta app configured (manual token only). */
    oauth_configured: boolean;
    connected: boolean;
    needs_reconnect?: boolean;
    meta_user_id?: string | null;
    meta_user_name?: string | null;
    connected_at?: string | null;
    token_expires_at?: string | null;
}

export interface MetaPage {
    id: string;
    name: string;
    picture_url: string | null;
    /** False when the person's Page role can't read leads (needs Advertise or Manage). */
    can_read_leads: boolean;
}

export interface MetaLeadForm {
    id: string;
    name: string;
    status: string | null;
    leads_count: number | null;
    created_time: string | null;
}

// Response shapes are interfaces on purpose: the hey-api client unwraps
// object-literal types (`{ 200: T }` style) but passes interfaces through.
export interface MetaPagesResponse {
    pages: MetaPage[];
}

export interface MetaLeadFormsResponse {
    forms: MetaLeadForm[];
}

export interface MetaAuthorizeUrlResponse {
    authorize_url: string;
}

type AuthHeaders = { Authorization: string };

export function getMetaAccount(headers: AuthHeaders) {
    return client.get<MetaAccount>({
        url: "/api/v1/marketing/meta/account",
        headers,
    });
}

export function startMetaOAuth(headers: AuthHeaders) {
    return client.post<MetaAuthorizeUrlResponse>({
        url: "/api/v1/marketing/meta/oauth/start",
        headers,
    });
}

export function completeMetaOAuth(payload: { code: string; state: string }, headers: AuthHeaders) {
    return client.post<MetaAccount>({
        url: "/api/v1/marketing/meta/oauth/complete",
        body: payload,
        headers,
    });
}

export function disconnectMetaAccount(headers: AuthHeaders) {
    return client.delete({
        url: "/api/v1/marketing/meta/account",
        headers,
    });
}

export function listMetaPages(headers: AuthHeaders) {
    return client.get<MetaPagesResponse>({
        url: "/api/v1/marketing/meta/pages",
        headers,
    });
}

export function listMetaLeadForms(pageId: string, headers: AuthHeaders) {
    return client.get<MetaLeadFormsResponse>({
        url: `/api/v1/marketing/meta/pages/${encodeURIComponent(pageId)}/forms`,
        headers,
    });
}

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
