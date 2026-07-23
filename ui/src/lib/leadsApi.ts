/**
 * Typed fetch wrappers for the persistent-lead endpoints (`/api/v1/leads`).
 *
 * This is a hand-written bridge that mirrors the generated client's
 * `{ data, error }` return convention. Once the backend is running you can
 * regenerate the real client with `npm run generate-client` and migrate these
 * calls to the generated functions; the leads pages only import from here so
 * that migration is a one-file change.
 */

export interface Lead {
    id: number;
    organization_id: number;
    phone_number: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    attributes: Record<string, unknown>;
    status: string;
    lead_score: number | null;
    source: string | null;
    external_id: string | null;
    dnc: boolean;
    consent_sms: boolean;
    consent_email: boolean;
    timezone: string | null;
    last_contacted_at: string | null;
    next_action_at: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface LeadListResponse {
    leads: Lead[];
    total: number;
    status_counts: Record<string, number>;
}

export interface LeadActivity {
    id: number;
    lead_id: number;
    channel: string;
    direction: string;
    type: string;
    workflow_run_id: number | null;
    payload: Record<string, unknown>;
    created_at: string | null;
}

export interface LeadActivityListResponse {
    activities: LeadActivity[];
    total: number;
}

export interface ImportLeadsResponse {
    total_rows: number;
    imported: number;
    duplicates_in_db: number;
    duplicates_in_file: number;
    invalid: number;
    invalid_rows: number[];
}

export interface CreateLeadBody {
    phone_number: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    attributes?: Record<string, unknown>;
    source?: string;
    dnc?: boolean;
    consent_sms?: boolean;
    consent_email?: boolean;
    timezone?: string;
}

export type ApiResult<T> = { data?: T; error?: unknown };

function backendBaseUrl(): string {
    if (typeof window === 'undefined') {
        return process.env.BACKEND_URL || 'http://api:8000';
    }
    return process.env.NEXT_PUBLIC_BACKEND_URL || window.location.origin;
}

async function request<T>(
    path: string,
    token: string,
    init: RequestInit = {},
): Promise<ApiResult<T>> {
    try {
        const res = await fetch(`${backendBaseUrl()}/api/v1${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(init.headers || {}),
            },
        });
        const body = res.status === 204 ? null : await res.json().catch(() => null);
        if (!res.ok) {
            return { error: body ?? { detail: `Request failed (${res.status})` } };
        }
        return { data: body as T };
    } catch (e) {
        return { error: e };
    }
}

export function listLeads(
    token: string,
    params: { status?: string; search?: string; limit?: number; offset?: number } = {},
): Promise<ApiResult<LeadListResponse>> {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.search) q.set('search', params.search);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return request<LeadListResponse>(`/leads${qs ? `?${qs}` : ''}`, token);
}

export function getLead(token: string, leadId: number): Promise<ApiResult<Lead>> {
    return request<Lead>(`/leads/${leadId}`, token);
}

export function getLeadActivities(
    token: string,
    leadId: number,
): Promise<ApiResult<LeadActivityListResponse>> {
    return request<LeadActivityListResponse>(`/leads/${leadId}/activities`, token);
}

export function createLead(
    token: string,
    body: CreateLeadBody,
): Promise<ApiResult<Lead>> {
    return request<Lead>(`/leads`, token, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export function importLeads(
    token: string,
    fileKey: string,
    source = 'csv',
): Promise<ApiResult<ImportLeadsResponse>> {
    return request<ImportLeadsResponse>(`/leads/import`, token, {
        method: 'POST',
        body: JSON.stringify({ file_key: fileKey, source }),
    });
}
