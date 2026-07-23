/**
 * Typed fetch wrappers for the reactivation-sequence endpoints
 * (`/api/v1/sequences`). Hand-written bridge mirroring the generated client's
 * `{ data, error }` convention; see leadsApi.ts. Migrate to the generated
 * client after `npm run generate-client`.
 */

export interface SequenceStep {
    id?: number;
    step_order?: number;
    channel: string;
    delay_seconds: number;
    workflow_id: number | null;
    message_template_id: number | null;
    stop_on_response: boolean;
}

export interface Sequence {
    id: number;
    organization_id: number;
    name: string;
    status: string;
    quiet_hours_start: number | null;
    quiet_hours_end: number | null;
    default_timezone: string | null;
    steps: SequenceStep[];
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
    current_step: number;
    state: string;
    next_step_at: string | null;
    stop_reason: string | null;
    created_at: string | null;
}

export interface EnrollmentListResponse {
    enrollments: Enrollment[];
    total: number;
}

export interface CreateSequenceBody {
    name: string;
    steps: Array<{
        channel: string;
        delay_seconds: number;
        workflow_id?: number | null;
        message_template_id?: number | null;
        stop_on_response: boolean;
    }>;
    quiet_hours_start?: number | null;
    quiet_hours_end?: number | null;
    default_timezone?: string | null;
    status?: string;
}

export interface WorkflowSummary {
    id: number;
    name: string;
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

export function listSequences(token: string): Promise<ApiResult<SequenceListResponse>> {
    return request<SequenceListResponse>('/sequences', token);
}

export function getSequence(token: string, id: number): Promise<ApiResult<Sequence>> {
    return request<Sequence>(`/sequences/${id}`, token);
}

export function createSequence(
    token: string,
    body: CreateSequenceBody,
): Promise<ApiResult<Sequence>> {
    return request<Sequence>('/sequences', token, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export function updateSequence(
    token: string,
    id: number,
    body: Partial<CreateSequenceBody>,
): Promise<ApiResult<Sequence>> {
    return request<Sequence>(`/sequences/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export function enrollLeads(
    token: string,
    sequenceId: number,
    leadIds: number[],
): Promise<ApiResult<{ enrolled: number; skipped: number }>> {
    return request(`/sequences/${sequenceId}/enroll`, token, {
        method: 'POST',
        body: JSON.stringify({ lead_ids: leadIds }),
    });
}

export function listEnrollments(
    token: string,
    sequenceId: number,
): Promise<ApiResult<EnrollmentListResponse>> {
    return request<EnrollmentListResponse>(
        `/sequences/${sequenceId}/enrollments`,
        token,
    );
}

export function listWorkflowSummaries(
    token: string,
): Promise<ApiResult<WorkflowSummary[]>> {
    return request<WorkflowSummary[]>('/workflow?status=active', token);
}
