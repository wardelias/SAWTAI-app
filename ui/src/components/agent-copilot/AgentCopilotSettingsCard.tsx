import { Sparkles } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { AgentCopilotSettingsSection } from './AgentCopilotSettingsSection';

/** The AI Assistant settings (API key, model, effort, limits) as a card. */
export function AgentCopilotSettingsCard() {
    return (
        <Card id="ai-assistant" className="scroll-mt-6">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                    </span>
                    AI Assistant
                </CardTitle>
                <CardDescription>
                    The chat that creates and edits your voice agents. Bring your own
                    Anthropic API key and choose the model and limits.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <AgentCopilotSettingsSection />
            </CardContent>
        </Card>
    );
}
