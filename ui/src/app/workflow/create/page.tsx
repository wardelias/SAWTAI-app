'use client';

import { Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { createWorkflowFromTemplateApiV1WorkflowCreateTemplatePost } from '@/client/sdk.gen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { AgentQuestionnaire, type AgentQuestionnaireResult } from '@/components/workflow/AgentQuestionnaire';
import { answersFromPrefill } from '@/components/workflow/agentQuestionnaire';
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import logger from '@/lib/logger';

export default function CreateWorkflowPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, getAccessToken } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [workflowId, setWorkflowId] = useState<string | null>(null);

    // Prefilled from the AI hub / idea chips: ?call_type=&use_case=&description=
    const [initialAnswers] = useState(() =>
        answersFromPrefill({
            callType: searchParams.get('call_type'),
            useCase: searchParams.get('use_case'),
            description: searchParams.get('description'),
        }),
    );

    const handleCreateWorkflow = async ({ callType, useCase, description }: AgentQuestionnaireResult) => {
        if (!user) {
            setError('You must be logged in to create a workflow');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const accessToken = await getAccessToken();

            // Call the API to create workflow from template
            const response = await createWorkflowFromTemplateApiV1WorkflowCreateTemplatePost({
                body: {
                    call_type: callType,
                    use_case: useCase,
                    activity_description: description,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (response.error) {
                setError(detailFromError(response.error, 'Failed to create the agent. Please try again.'));
                return;
            }
            if (response.data?.id) {
                setWorkflowId(String(response.data.id));
                setShowSuccessModal(true);
            }
        } catch (err) {
            setError('Failed to create workflow. Please try again.');
            logger.error(`Error creating workflow: ${err}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleModalContinue = () => {
        if (!workflowId) return;
        router.push(`/workflow/${workflowId}?onboarding=web_call`);
    };

    return (
        <div className="min-h-screen max-md:min-h-0">
            <div className="container mx-auto px-4 py-8 max-w-2xl max-md:py-5">
                <div className="mb-8 max-md:mb-6">
                    <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-ai/12 px-2.5 py-1 text-xs font-semibold text-ai">
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Agent Builder
                    </span>
                    <h1 className="text-3xl font-bold mb-2 max-md:text-2xl">Create Voice Agent</h1>
                    <p className="text-muted-foreground max-md:text-sm">
                        Answer a few questions and AI builds an agent that fits your business exactly.
                    </p>
                </div>

                <Card className="max-md:rounded-2xl">
                    <CardContent className="p-8 max-md:p-5">
                        <AgentQuestionnaire
                            initialAnswers={initialAnswers}
                            onSubmit={handleCreateWorkflow}
                            isSubmitting={isLoading}
                            error={error}
                        />
                    </CardContent>
                </Card>
            </div>

            {/* Loading Overlay */}
            {isLoading && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <Card className="w-full max-w-md p-8">
                        <div className="flex flex-col items-center space-y-6">
                            {/* Animated spinner */}
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-muted rounded-full"></div>
                                <div className="absolute top-0 left-0 w-16 h-16 border-4 border-transparent border-t-primary rounded-full animate-spin"></div>
                            </div>

                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-semibold">
                                    Creating Your Workflow
                                </h3>
                                <p className="text-sm text-muted-foreground max-w-xs">
                                    We&apos;re setting up your voice agent with your specifications. This will just take a moment...
                                </p>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {/* Success Modal */}
            <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Workflow Created Successfully!
                        </DialogTitle>
                        <DialogDescription asChild>
                            <div className="mt-4 space-y-3">
                                <p>
                                    A voice agent workflow has been generated for your use case, with some artificial data and sample actions.
                                </p>
                                <p>
                                    The voice starts on the default settings, so check the voice and language in the editor match the languages you picked.
                                </p>
                                <p>
                                    Next steps would be to test the voice bot in the editor, and then modify it to suit your use case.
                                </p>
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-6">
                        <Button
                            onClick={handleModalContinue}
                            className="w-full"
                        >
                            Open and Test Agent
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
