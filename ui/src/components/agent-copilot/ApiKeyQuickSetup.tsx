'use client';

import { ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchCopilotSettings, saveCopilotSettings } from '@/lib/agentCopilot';
import { useAuth } from '@/lib/auth';

/**
 * A one-field form for adding the organization's Anthropic API key where the
 * assistant asks for one. Keeps the other AI Assistant settings as they are.
 */
export function ApiKeyQuickSetup({ onSaved }: { onSaved: () => void }) {
    const { getAccessToken } = useAuth();
    const [apiKey, setApiKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function save() {
        const key = apiKey.trim();
        if (!key) return;
        setSaving(true);
        setError(null);
        try {
            const token = await getAccessToken();
            const current = await fetchCopilotSettings(token);
            await saveCopilotSettings(token, {
                enabled: current.enabled,
                api_key: key,
                model: current.model,
                effort: current.effort,
                daily_message_limit: current.daily_message_limit,
            });
            toast.success('API key saved');
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save the API key');
        } finally {
            setSaving(false);
        }
    }

    return (
        <form
            className="mx-auto w-full max-w-sm space-y-2 text-left"
            onSubmit={(e) => {
                e.preventDefault();
                void save();
            }}
        >
            <label htmlFor="copilot-quick-api-key" className="text-xs font-medium">
                Anthropic API key
            </label>
            <div className="flex gap-2">
                <Input
                    id="copilot-quick-api-key"
                    type="password"
                    autoComplete="off"
                    placeholder="sk-ant-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={saving}
                />
                <Button
                    type="submit"
                    disabled={saving || !apiKey.trim()}
                    className="shrink-0 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <p className="text-xs text-muted-foreground">
                Create one in the{' '}
                <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 underline"
                >
                    Anthropic Console <ExternalLink className="h-3 w-3" />
                </a>
                . It&apos;s checked with Anthropic before it&apos;s saved.
            </p>
        </form>
    );
}
