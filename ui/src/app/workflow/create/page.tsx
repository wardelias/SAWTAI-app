'use client';

import { PhoneIncoming, PhoneOutgoing, Sparkles, Wand2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { createWorkflowFromTemplateApiV1WorkflowCreateTemplatePost } from '@/client/sdk.gen';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_IDEAS, type AgentCallType } from '@/components/workflow/agentIdeas';
import { useAuth } from '@/lib/auth';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';

const CALL_TYPE_OPTIONS: { value: AgentCallType; label: string; hint: string; icon: typeof PhoneIncoming }[] = [
    { value: 'inbound', label: 'Inbound', hint: 'People call your agent', icon: PhoneIncoming },
    { value: 'outbound', label: 'Outbound', hint: 'Your agent calls people', icon: PhoneOutgoing },
];

export default function CreateWorkflowPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, getAccessToken } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [workflowId, setWorkflowId] = useState<string | null>(null);

    // Prefilled from the AI hub / idea chips: ?call_type=&use_case=&description=
    const [callType, setCallType] = useState<'inbound' | 'outbound'>(
        searchParams.get('call_type') === 'outbound' ? 'outbound' : 'inbound',
    );
    const [useCase, setUseCase] = useState(searchParams.get('use_case') ?? '');
    const [activityDescription, setActivityDescription] = useState(searchParams.get('description') ?? '');

    const handleCreateWorkflow = async () => {
        if (!useCase || !activityDescription) {
            setError('Please fill in all fields');
            return;
        }

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
                    activity_description: activityDescription,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

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
                <div className="mb-6 max-md:mb-5">
                    <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-ai/12 px-2.5 py-1 text-xs font-semibold text-ai md:hidden">
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Agent Builder
                    </span>
                    <h1 className="text-3xl font-bold mb-2 max-md:text-2xl">Create Voice Agent</h1>
                    <p className="text-muted-foreground max-md:text-sm">
                        Tell us about your use case and we&apos;ll create a customized voice agent for you
                    </p>
                </div>

                {/* Phones: one-tap starting points that fill in the form below. */}
                <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:hidden">
                    {AGENT_IDEAS.map((idea) => {
                        const Icon = idea.icon;
                        const active = useCase === idea.useCase;
                        return (
                            <button
                                key={idea.useCase}
                                type="button"
                                onClick={() => {
                                    setUseCase(idea.useCase);
                                    setCallType(idea.callType);
                                    setActivityDescription(idea.description);
                                    setError(null);
                                }}
                                className={cn(
                                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                                    active
                                        ? 'border-ai bg-ai text-ai-foreground'
                                        : 'border-border/70 bg-card active:bg-accent',
                                )}
                            >
                                <Icon className={cn('h-3.5 w-3.5', !active && 'text-ai')} />
                                {idea.useCase}
                            </button>
                        );
                    })}
                </div>

                <Card className="max-md:rounded-2xl">
                    <CardHeader className="max-md:hidden">
                        <CardTitle>Agent Details</CardTitle>
                        <CardDescription>
                            Configure your voice agent settings
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 max-md:space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="call-type">Call Type</Label>
                            <div className="grid grid-cols-2 gap-2 md:hidden" role="radiogroup" aria-label="Call type">
                                {CALL_TYPE_OPTIONS.map(({ value, label, hint, icon: Icon }) => (
                                    <button
                                        key={value}
                                        type="button"
                                        role="radio"
                                        aria-checked={callType === value}
                                        onClick={() => setCallType(value)}
                                        className={cn(
                                            'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                                            callType === value
                                                ? 'border-ai bg-ai/[0.08] ring-1 ring-ai'
                                                : 'border-border/70 active:bg-accent',
                                        )}
                                    >
                                        <Icon className={cn('h-4 w-4', callType === value ? 'text-ai' : 'text-muted-foreground')} />
                                        <span className="text-sm font-medium">{label}</span>
                                        <span className="text-xs text-muted-foreground">{hint}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="max-md:hidden">
                                <Select value={callType} onValueChange={(value) => setCallType(value as 'inbound' | 'outbound')}>
                                    <SelectTrigger id="call-type">
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="inbound">
                                            Inbound (Users call AI)
                                        </SelectItem>
                                        <SelectItem value="outbound">
                                            Outbound (AI calls users)
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-sm text-muted-foreground max-md:hidden">
                                Choose whether users will call your AI or your AI will call users
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="use-case">Use Case</Label>
                            <Input
                                id="use-case"
                                placeholder="e.g., Lead Qualification, HR Screening, Customer Support"
                                value={useCase}
                                onChange={(e) => setUseCase(e.target.value)}
                            />
                            <p className="text-sm text-muted-foreground max-md:text-xs">
                                Describe the primary purpose of your voice agent
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="activity-description">Activity Description</Label>
                            <Textarea
                                id="activity-description"
                                placeholder="Describe briefly what your voice agent will do (e.g., Qualify leads for real estate, Screen candidates for roles, Handle customer support). This will be a prompt to an LLM."
                                value={activityDescription}
                                onChange={(e) => setActivityDescription(e.target.value)}
                                className="min-h-[100px] max-md:min-h-[140px]"
                            />
                            <p className="text-sm text-muted-foreground max-md:text-xs">
                                This description will be used to generate the AI prompt for your voice agent
                            </p>
                        </div>

                        {error && (
                            <p className="text-sm text-red-500">{error}</p>
                        )}

                        <div className="pt-4 max-md:pt-1">
                            <Button
                                onClick={handleCreateWorkflow}
                                disabled={isLoading || !useCase || !activityDescription}
                                className="w-full max-md:h-12 max-md:rounded-xl max-md:bg-ai max-md:text-base max-md:text-ai-foreground max-md:hover:bg-ai/90"
                            >
                                <Wand2 className="h-4 w-4 md:hidden" />
                                {isLoading ? 'Creating...' : 'Create Agent'}
                            </Button>
                            <p className="mt-2 text-center text-xs text-muted-foreground md:hidden">
                                AI writes the prompts and call flow. You can edit everything after.
                            </p>
                        </div>
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
                                    The voice bot is pre-set to communicate in English with an American accent.
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
