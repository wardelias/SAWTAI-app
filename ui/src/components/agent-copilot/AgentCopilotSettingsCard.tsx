import { Sparkles } from 'lucide-react';

import { AgentCopilotSettingsSection } from '@/components/agent-copilot/AgentCopilotSettingsSection';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The AI Assistant's settings card, linked to as `#ai-assistant`. */
export function AgentCopilotSettingsCard({ onReady }: { onReady?: () => void }) {
    return (
        // scroll-mt clears the sticky top bar when the page opens at #ai-assistant.
        <Card id="ai-assistant" className="scroll-mt-20">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                    </span>
                    AI Assistant
                </CardTitle>
                <CardDescription>
                    The chat that creates and edits your voice agents, and reviews their calls. It runs on
                    Claude: add your Anthropic API key here and choose the model and limits.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <AgentCopilotSettingsSection onReady={onReady} />
            </CardContent>
        </Card>
    );
}
