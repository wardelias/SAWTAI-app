/**
 * Meeting API — typed wrappers matching the backend /api/v1/meetings routes.
 * Follows the same pattern as sdk.gen.ts but written manually since the backend
 * meeting routes are not yet in the auto-generated client.
 */

import { client } from "./client.gen";

// ---------------------------------------------------------------------------
// Types (mirror api/schemas/meeting.py)
// ---------------------------------------------------------------------------

export type MeetingResponse = {
    id: number;
    organization_id: number;
    title: string;
    attendee: string;
    phone: string | null;
    notes: string | null;
    start_time: string; // ISO datetime
    duration_minutes: number;
    booked_by: string;
    workflow_run_id: number | null;
    created_at: string;
};

export type MeetingListResponse = {
    meetings: MeetingResponse[];
    total: number;
};

export type CreateMeetingBody = {
    title: string;
    attendee: string;
    start_time: string; // ISO datetime
    duration_minutes?: number;
    phone?: string | null;
    notes?: string | null;
    booked_by?: string;
    workflow_run_id?: number | null;
};

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export const listMeetingsApiV1MeetingsGet = (options?: {
    query?: { from_time?: string; to_time?: string };
}) =>
    client.get<{ 200: MeetingListResponse }, { detail: string }>({
        url: "/api/v1/meetings",
        ...options,
    });

export const createMeetingApiV1MeetingsPost = (options: {
    body: CreateMeetingBody;
}) =>
    client.post<{ 201: MeetingResponse }, { detail: string }>({
        url: "/api/v1/meetings",
        ...options,
    });

export const deleteMeetingApiV1MeetingsMeetingIdDelete = (options: {
    path: { meeting_id: number };
}) =>
    client.delete<{ 204: void }, { detail: string }>({
        url: "/api/v1/meetings/{meeting_id}",
        ...options,
    });
