'use client';

import { useParams, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { useEffect, useMemo, useState } from 'react';

import RenderWorkflow, { type WorkflowEditorPanel } from '@/app/workflow/[workflowId]/RenderWorkflow';
import { getWorkflowApiV1WorkflowFetchWorkflowIdGet } from '@/client/sdk.gen';
import type { WorkflowResponse } from '@/client/types.gen';
import { FlowEdge, FlowNode } from '@/components/flow/types';
import SpinLoader from '@/components/SpinLoader';
import { PostHogEvent } from '@/constants/posthog-events';
import { fetchCallInsights, insightFixPrompt } from '@/lib/agentCopilot';
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import logger from '@/lib/logger';
import { WorkflowConfigurations } from '@/types/workflow-configurations';

import WorkflowLayout from '../WorkflowLayout';

export default function WorkflowDetailPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const [workflow, setWorkflow] = useState<WorkflowResponse | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { user, redirectToLogin, loading: authLoading, getAccessToken } = useAuth();
    // "Fix with AI" on the Overview's Call Insights links here with
    // ?insight=<reportId>-<issueIndex>. The issue is read from the server's
    // stored report for this organization, never from URL text.
    const insightParam = searchParams.get('insight');
    const insightMatch = insightParam?.match(/^([0-9a-f]{12})-(\d{1,2})$/) ?? null;
    const [insightPrompt, setInsightPrompt] = useState<string | null>(null);
    const [insightLoading, setInsightLoading] = useState(Boolean(insightMatch));

    // Redirect if not authenticated
    useEffect(() => {
        if (!authLoading && !user) {
            redirectToLogin();
        }
    }, [authLoading, user, redirectToLogin]);

    useEffect(() => {
        const fetchWorkflow = async () => {
            if (!user) return;
            try {
                const response = await getWorkflowApiV1WorkflowFetchWorkflowIdGet({
                    path: {
                        workflow_id: Number(params.workflowId)
                    },
                });

                if (response.error) {
                    const fallback = response.response?.status === 503
                        ? 'Sawt is temporarily unavailable. Please try again later.'
                        : 'Failed to fetch workflow';
                    setError(detailFromError(response.error, fallback));
                    return;
                }

                const workflow = response.data;
                if (!workflow) {
                    setError('Workflow not found');
                    return;
                }
                setWorkflow(workflow);
                posthog.capture(PostHogEvent.WORKFLOW_EDITOR_OPENED, {
                    workflow_id: workflow.id,
                    workflow_name: workflow.name,
                });
            } catch (err) {
                setError('Failed to fetch workflow');
                logger.error(`Error fetching workflow: ${err}`);
            } finally {
                setLoading(false);
            }
        };

        if (user) {
            fetchWorkflow();
        }
    }, [params.workflowId, user]);

    useEffect(() => {
        if (!user || !insightMatch) return;
        const [, reportId, index] = insightMatch;
        (async () => {
            try {
                const report = await fetchCallInsights(await getAccessToken());
                const issue = report?.id === reportId ? report.issues[Number(index)] : undefined;
                if (issue) setInsightPrompt(insightFixPrompt(issue));
            } catch (err) {
                logger.error(`Error loading call insight: ${err}`);
            } finally {
                setInsightLoading(false);
            }
        })();
        // Only the param values matter; the match array is recreated each render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, insightParam, getAccessToken]);

    const stableUser = useMemo(() => user, [user]);
    const openTesterOnLoad = searchParams.get('onboarding') === 'web_call';
    const panelParam = searchParams.get('panel');
    const initialPanel: WorkflowEditorPanel | null =
        panelParam === 'assistant' || panelParam === 'test' ? panelParam : null;
    const copilotConversationId = searchParams.get('copilot');
    // "Ask AI about this call" links here with the call's id. Only a numeric
    // id is accepted; the request itself is written here, never taken from
    // the URL, so a crafted link can't make the assistant act on its words.
    const reviewCallId = searchParams.get('reviewCall');
    const reviewCallPrompt = reviewCallId && /^\d+$/.test(reviewCallId)
        ? `Review call #${reviewCallId}: what happened, what went wrong or well, and what should change in this agent to handle calls like it better?`
        : null;
    const copilotPrompt = reviewCallPrompt ?? insightPrompt;

    if (loading || insightLoading) {
        return (
            <WorkflowLayout>
                <SpinLoader />
            </WorkflowLayout>
        );
    }
    else if (error || !workflow) {
        return (
            <WorkflowLayout showFeaturesNav={false}>
                <div className="flex items-center justify-center min-h-screen">
                    <div className="text-lg text-destructive">{error || 'Workflow not found'}</div>
                </div>
            </WorkflowLayout>
        );
    }
    else {
        return stableUser ? (
            <RenderWorkflow
                initialWorkflowName={workflow.name}
                workflowId={workflow.id}
                workflowUuid={workflow.workflow_uuid ?? undefined}
                initialTotalRuns={workflow.total_runs ?? 0}
                openTesterOnLoad={openTesterOnLoad}
                initialPanel={initialPanel}
                initialCopilotConversationId={copilotConversationId}
                initialCopilotPrompt={copilotPrompt}
                initialFlow={{
                    nodes: workflow.workflow_definition.nodes as FlowNode[],
                    edges: workflow.workflow_definition.edges as FlowEdge[],
                    viewport: { x: 0, y: 0, zoom: 0 }
                }}
                initialTemplateContextVariables={workflow.template_context_variables as Record<string, string> || {}}
                initialWorkflowConfigurations={
                    workflow.workflow_configurations
                        ? (workflow.workflow_configurations as WorkflowConfigurations)
                        : undefined
                }
                initialVersionNumber={workflow.version_number ?? null}
                initialVersionStatus={workflow.version_status ?? null}
                user={stableUser}
            />
        ) : null;
    }
}
