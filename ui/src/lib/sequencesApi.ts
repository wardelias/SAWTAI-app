/**
 * Typed fetch wrappers for the reactivation-sequence endpoints
 * (`/api/v1/sequences`). Hand-written bridge mirroring the generated client's
 * `{ data, error }` convention; see leadsApi.ts. Migrate to the generated
 * client after `npm run generate-client`.
 */

import { client } from '@/client/client.gen';
import { getServerBackendUrl, resolveBrowserBackendUrl } from '@/lib/apiClient';

export type SequenceChannel = 'voice' | 'sms';
export type SequenceStatus = 'draft' | 'active' | 'paused' | 'archived';
export type EnrollmentState = 'active' | 'completed' | 'stopped' | 'converted';

export interface SequenceStep {
    id?: number;
    step_order?: number;
    channel: string;
    delay_seconds: number;
    workflow_id: number | null;
    workflow_name?: string | null;
    message_template_id?: number | null;
    message_text?: string | null;
    stop_on_response: boolean;
}

export interface Sequence {
    id: number;
    organization_id: number;
    name: string;
    status: SequenceStatus;
    quiet_hours_start: number | null;
    quiet_hours_end: number | null;
    default_timezone: string | null;
    steps: SequenceStep[];
    enrollment_counts: Partial<Record<EnrollmentState | 'responded' | 'total', number>>;
    created_at: string | null;
    updated_at: string | null;
}

export interface SequenceListResponse {
    sequences: Sequence[];
    total: number;
}

export interface Enrollment {
    id: number;
    sequence_id: number;
    lead_id: number;
    lead_name: string | null;
    lead_phone: string | null;
    lead_status: string | null;
    current_step: number;
    state: EnrollmentState;
    next_step_at: string | null;
    stop_reason: string | null;
    waiting_on_call: boolean;
    last_workflow_run_id: number | null;
    last_error: string | null;
    last_step_at: string | null;
    created_at: string | null;
}

export interface EnrollmentListResponse {
    enrollments: Enrollment[];
    total: number;
}

export interface SequenceStepBody {
    channel: SequenceChannel;
    delay_seconds: number;
    workflow_id?: number | null;
    message_text?: string | null;
    stop_on_response: boolean;
}

export interface SequenceBody {
    name: string;
    steps: SequenceStepBody[];
    quiet_hours_start: number | null;
    quiet_hours_end: number | null;
    default_timezone: string | null;
    status?: SequenceStatus;
}

export interface WorkflowSummary {
    id: number;
    name: string;
}

export interface BackgroundStatus {
    worker: boolean;
    campaign_orchestrator: boolean;
}

export type ApiResult<T> = { data?: T; error?: unknown };

function backendBaseUrl(): string {
    if (typeof window === 'undefined') {
        return getServerBackendUrl();
    }
    // Same resolution as the generated API client (NEXT_PUBLIC_BACKEND_URL →
    // backend-reported endpoint → same origin).
    return client.getConfig().baseUrl || resolveBrowserBackendUrl();
}

async function request<T>(
    path: string,
    token: string | null,
    init: RequestInit = {},
): Promise<ApiResult<T>> {
    try {
        const res = await fetch(`${backendBaseUrl()}/api/v1${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export function listSequences(token: string): Promise<ApiResult<SequenceListResponse>> {
    return request<SequenceListResponse>('/sequences', token);
}

export function getSequence(token: string, id: number): Promise<ApiResult<Sequence>> {
    return request<Sequence>(`/sequences/${id}`, token);
}

export function createSequence(token: string, body: SequenceBody): Promise<ApiResult<Sequence>> {
    return request<Sequence>('/sequences', token, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export function updateSequence(
    token: string,
    id: number,
    body: Partial<SequenceBody>,
): Promise<ApiResult<Sequence>> {
    return request<Sequence>(`/sequences/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export function deleteSequence(token: string, id: number): Promise<ApiResult<null>> {
    return request<null>(`/sequences/${id}`, token, { method: 'DELETE' });
}

export function enrollLeads(
    token: string,
    sequenceId: number,
    target: { leadIds?: number[]; leadStatus?: string },
): Promise<ApiResult<{ enrolled: number; skipped: number }>> {
    return request(`/sequences/${sequenceId}/enroll`, token, {
        method: 'POST',
        body: JSON.stringify({
            lead_ids: target.leadIds ?? null,
            lead_status: target.leadStatus ?? null,
        }),
    });
}

export function listEnrollments(
    token: string,
    sequenceId: number,
    params: { state?: EnrollmentState; limit?: number; offset?: number } = {},
): Promise<ApiResult<EnrollmentListResponse>> {
    const q = new URLSearchParams();
    if (params.state) q.set('state', params.state);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return request<EnrollmentListResponse>(
        `/sequences/${sequenceId}/enrollments${qs ? `?${qs}` : ''}`,
        token,
    );
}

export function stopEnrollments(
    token: string,
    sequenceId: number,
    enrollmentIds?: number[],
): Promise<ApiResult<{ stopped: number }>> {
    return request(`/sequences/${sequenceId}/enrollments/stop`, token, {
        method: 'POST',
        body: JSON.stringify({ enrollment_ids: enrollmentIds ?? null }),
    });
}

export function listWorkflowSummaries(token: string): Promise<ApiResult<WorkflowSummary[]>> {
    return request<WorkflowSummary[]>('/workflow/summary?status=active', token);
}

export function getBackgroundStatus(): Promise<ApiResult<BackgroundStatus>> {
    return request<BackgroundStatus>('/health/background', null);
}
