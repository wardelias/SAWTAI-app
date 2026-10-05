'use client';

import { CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { type CopilotSettings, fetchCopilotSettings, saveCopilotSettings } from '@/lib/agentCopilot';
import { useAuth } from '@/lib/auth';

const MODEL_LABELS: Record<string, { name: string; detail: string }> = {
    'claude-opus-5-5': { name: 'Claude Opus 5.5', detail: 'Best quality for building agents · $4 / $20 per million tokens' },
    'claude-sonnet-5-5': { name: 'Claude Sonnet 5.5', detail: 'Faster and cheaper · $2 / $10 per million tokens' },
};

const EFFORT_LABELS: Record<string, string> = {
    low: 'Low — fastest, cheapest',
    medium: 'Medium — recommended',
    high: 'High — more careful',
    xhigh: 'Extra high',
    max: 'Max — slowest, most thorough',
};

/** Organization settings for the AI Assistant: API key, model, effort, limits. */
export function AgentCopilotSettingsSection() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const [settings, setSettings] = useState<CopilotSettings | null>(null);
    const [enabled, setEnabled] = useState(true);
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('claude-opus-5-5');
    const [effort, setEffort] = useState('medium');
    const [limit, setLimit] = useState('');
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const hasFetched = useRef(false);

    function apply(next: CopilotSettings) {
        setSettings(next);
        setEnabled(next.enabled);
        setApiKey(next.api_key);
        setModel(next.model);
        setEffort(next.effort);
        setLimit(next.daily_message_limit != null ? String(next.daily_message_limit) : '');
    }

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        (async () => {
            try {
                apply(await fetchCopilotSettings(await getAccessToken()));
            } catch (err) {
                setLoadError(err instanceof Error ? err.message : 'Failed to load AI Assistant settings');
            }
        })();
    }, [authLoading, user, getAccessToken]);

    async function save(keyOverride?: string) {
        setSaving(true);
        setSaveError(null);
        try {
            const trimmedLimit = limit.trim();
            const next = await saveCopilotSettings(await getAccessToken(), {
                enabled,
                api_key: keyOverride ?? apiKey,
                model,
                effort,
                daily_message_limit: trimmedLimit === '' ? null : Number(trimmedLimit),
            });
            apply(next);
            toast.success(keyOverride === '' ? 'API key removed' : 'AI Assistant settings saved');
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    }

    if (loadError) {
        return <p className="text-sm text-destructive">{loadError}</p>;
    }
    if (!settings) {
        return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    }

    const limitInvalid = limit.trim() !== '' && !/^\d+$/.test(limit.trim());
    const keyStatus = settings.has_own_key
        ? { icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, text: "Using your organization's API key." }
        : settings.platform_key_available
            ? { icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, text: "Using the platform's API key. Add your own to remove the platform's daily limit." }
            : { icon: <ShieldAlert className="h-4 w-4 text-amber-500" />, text: 'No API key yet — the assistant is unavailable until you add one.' };

    return (
        <form
            className="space-y-6"
            onSubmit={(e) => {
                e.preventDefault();
                if (!limitInvalid) void save();
            }}
        >
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-0.5">
                    <Label htmlFor="copilot-enabled" className="text-sm font-medium">Enable AI Assistant</Label>
                    <p className="text-xs text-muted-foreground">
                        Shows the assistant on the agents list and in every agent&apos;s editor.
                    </p>
                </div>
                <Switch id="copilot-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="space-y-2">
                <Label htmlFor="copilot-api-key" className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    Anthropic API key
                </Label>
                <div className="flex gap-2">
                    <Input
                        id="copilot-api-key"
                        type="password"
                        autoComplete="off"
                        placeholder="sk-ant-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                    />
                    {settings.has_own_key ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={saving}
                            onClick={() => void save('')}
                            aria-label="Remove API key"
                            title="Remove API key"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    ) : null}
                </div>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <span className="mt-px">{keyStatus.icon}</span>
                    <span>
                        {keyStatus.text} Create a key in the{' '}
                        <a
                            href="https://console.anthropic.com/settings/keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 underline"
                        >
                            Anthropic Console <ExternalLink className="h-3 w-3" />
                        </a>
                        . Keys are checked with Anthropic before saving and are never shown again in full.
                    </span>
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label>Model</Label>
                    <Select value={model} onValueChange={setModel}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {settings.supported_models.map((id) => (
                                <SelectItem key={id} value={id}>
                                    {MODEL_LABELS[id]?.name ?? id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{MODEL_LABELS[model]?.detail}</p>
                </div>
                <div className="space-y-2">
                    <Label>Effort</Label>
                    <Select value={effort} onValueChange={setEffort}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {settings.effort_levels.map((level) => (
                                <SelectItem key={level} value={level}>
                                    {EFFORT_LABELS[level] ?? level}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        How much the model thinks before acting. Higher is slower and costs more.
                    </p>
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="copilot-limit">Daily message limit</Label>
                <Input
                    id="copilot-limit"
                    inputMode="numeric"
                    placeholder="No limit of your own"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    className="sm:max-w-[200px]"
                    aria-invalid={limitInvalid}
                />
                <p className="text-xs text-muted-foreground">
                    {limitInvalid
                        ? 'Enter a whole number, or leave it empty.'
                        : settings.effective_daily_message_limit > 0
                            ? `Currently ${settings.effective_daily_message_limit} messages per day for your organization (resets at midnight UTC).`
                            : 'Currently unlimited.'}{' '}
                    Each message can run several model calls, so this is the main way to cap spend.
                </p>
            </div>

            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

            <div className="flex justify-end">
                <Button type="submit" disabled={saving || limitInvalid}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {saving ? 'Saving…' : 'Save'}
                </Button>
            </div>
        </form>
    );
}
