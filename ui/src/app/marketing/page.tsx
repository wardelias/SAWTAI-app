"use client";

import { Check, Clock, Facebook, Globe, Instagram, Linkedin, Plus, Settings2, Target, Webhook, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SourceId =
    | "meta_instant_form"
    | "instagram_lead"
    | "google_lead_form"
    | "linkedin_lead"
    | "web_form"
    | "webhook";

type MarketingSource = {
    id: SourceId;
    name: string;
    description: string;
    icon: typeof Facebook;
    tint: string;
};

type SourceSettings = {
    agentId: string;
    callAfter: string; // delay key
    maxRetries: number;
    enabled: boolean;
};

const SOURCES: MarketingSource[] = [
    {
        id: "meta_instant_form",
        name: "Meta Instant Form",
        description: "Facebook Lead Ads — pull leads from instant forms the moment they submit.",
        icon: Facebook,
        tint: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    {
        id: "instagram_lead",
        name: "Instagram Lead Ads",
        description: "Capture leads from Instagram lead generation campaigns.",
        icon: Instagram,
        tint: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
    },
    {
        id: "google_lead_form",
        name: "Google Lead Form",
        description: "Leads from Google Ads lead form extensions.",
        icon: Globe,
        tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    {
        id: "linkedin_lead",
        name: "LinkedIn Lead Gen",
        description: "Sync leads from LinkedIn Lead Gen Forms.",
        icon: Linkedin,
        tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    },
    {
        id: "web_form",
        name: "Website Form",
        description: "Embed a form or post submissions from your own site.",
        icon: Zap,
        tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    },
    {
        id: "webhook",
        name: "Webhook / Zapier",
        description: "Send leads from any tool via a generic webhook.",
        icon: Webhook,
        tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
];

const CALL_AFTER_OPTIONS: { value: string; label: string }[] = [
    { value: "0", label: "Immediately" },
    { value: "5", label: "After 5 minutes" },
    { value: "15", label: "After 15 minutes" },
    { value: "30", label: "After 30 minutes" },
    { value: "60", label: "After 1 hour" },
    { value: "1440", label: "After 1 day" },
];

// Mock voice agents — in a real build these come from the workflows API.
const MOCK_AGENTS: { id: string; name: string }[] = [
    { id: "agent-1", name: "Inbound Qualifier" },
    { id: "agent-2", name: "Demo Booker" },
    { id: "agent-3", name: "Renewal Outreach" },
];

const DEFAULT_SETTINGS: SourceSettings = {
    agentId: "agent-1",
    callAfter: "5",
    maxRetries: 2,
    enabled: true,
};

// Mock initial connections.
const INITIAL_CONNECTIONS: Partial<Record<SourceId, SourceSettings>> = {
    meta_instant_form: { agentId: "agent-2", callAfter: "0", maxRetries: 3, enabled: true },
};

function callAfterLabel(value: string) {
    return CALL_AFTER_OPTIONS.find((o) => o.value === value)?.label ?? "Immediately";
}

function agentName(id: string) {
    return MOCK_AGENTS.find((a) => a.id === id)?.name ?? "Unassigned";
}

export default function MarketingPage() {
    const [connections, setConnections] =
        useState<Partial<Record<SourceId, SourceSettings>>>(INITIAL_CONNECTIONS);
    const [editing, setEditing] = useState<SourceId | null>(null);

    const sourceById = useMemo(() => {
        const map = new Map<SourceId, MarketingSource>();
        SOURCES.forEach((s) => map.set(s.id, s));
        return map;
    }, []);

    const connected = SOURCES.filter((s) => connections[s.id]);
    const available = SOURCES.filter((s) => !connections[s.id]);

    const openConfigure = (id: SourceId) => setEditing(id);

    const handleSave = (id: SourceId, settings: SourceSettings) => {
        setConnections((prev) => ({ ...prev, [id]: settings }));
        setEditing(null);
    };

    const handleDisconnect = (id: SourceId) => {
        setConnections((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        setEditing(null);
    };

    const editingSource = editing ? sourceById.get(editing) ?? null : null;
    const editingSettings = editing ? connections[editing] ?? DEFAULT_SETTINGS : DEFAULT_SETTINGS;
    const editingIsConnected = editing ? Boolean(connections[editing]) : false;

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mx-auto max-w-5xl space-y-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
                    <p className="text-sm text-muted-foreground">
                        Connect your lead sources and decide how your voice agents follow up on every new lead.
                    </p>
                </div>

                {/* Connected sources */}
                <section className="space-y-3">
                    <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Connected Sources
                        </h2>
                        {connected.length > 0 && (
                            <Badge variant="secondary">{connected.length}</Badge>
                        )}
                    </div>

                    {connected.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                            No sources connected yet. Connect one below to start routing leads to your agents.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {connected.map((source) => {
                                const settings = connections[source.id]!;
                                const Icon = source.icon;
                                return (
                                    <Card key={source.id}>
                                        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                                            <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", source.tint)}>
                                                <Icon className="h-5 w-5" />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium">{source.name}</p>
                                                    {settings.enabled ? (
                                                        <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
                                                            Active
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary">Paused</Badge>
                                                    )}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                                    <span className="inline-flex items-center gap-1">
                                                        <Target className="h-3.5 w-3.5" />
                                                        {agentName(settings.agentId)}
                                                    </span>
                                                    <span className="inline-flex items-center gap-1">
                                                        <Clock className="h-3.5 w-3.5" />
                                                        Call {callAfterLabel(settings.callAfter).toLowerCase()}
                                                    </span>
                                                    <span>
                                                        {settings.maxRetries} retr{settings.maxRetries === 1 ? "y" : "ies"}
                                                    </span>
                                                </div>
                                            </div>

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="shrink-0"
                                                onClick={() => openConfigure(source.id)}
                                            >
                                                <Settings2 className="mr-1 h-4 w-4" />
                                                Configure
                                            </Button>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* Available integrations */}
                {available.length > 0 && (
                    <section className="space-y-3">
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Available Integrations
                        </h2>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {available.map((source) => {
                                const Icon = source.icon;
                                return (
                                    <Card key={source.id} className="flex flex-col">
                                        <CardHeader className="flex-1">
                                            <div className={cn("mb-2 flex h-11 w-11 items-center justify-center rounded-xl", source.tint)}>
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <CardTitle className="text-base">{source.name}</CardTitle>
                                            <CardDescription>{source.description}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <Button
                                                variant="outline"
                                                className="w-full"
                                                onClick={() => openConfigure(source.id)}
                                            >
                                                <Plus className="mr-1 h-4 w-4" />
                                                Connect
                                            </Button>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>

            {editingSource && (
                <ConfigureSourceDialog
                    source={editingSource}
                    isConnected={editingIsConnected}
                    initial={editingSettings}
                    onOpenChange={(open) => !open && setEditing(null)}
                    onSave={(settings) => handleSave(editingSource.id, settings)}
                    onDisconnect={() => handleDisconnect(editingSource.id)}
                />
            )}
        </div>
    );
}

interface ConfigureSourceDialogProps {
    source: MarketingSource;
    isConnected: boolean;
    initial: SourceSettings;
    onOpenChange: (open: boolean) => void;
    onSave: (settings: SourceSettings) => void;
    onDisconnect: () => void;
}

function ConfigureSourceDialog({
    source,
    isConnected,
    initial,
    onOpenChange,
    onSave,
    onDisconnect,
}: ConfigureSourceDialogProps) {
    const [agentId, setAgentId] = useState(initial.agentId);
    const [callAfter, setCallAfter] = useState(initial.callAfter);
    const [maxRetries, setMaxRetries] = useState(initial.maxRetries);
    const [enabled, setEnabled] = useState(initial.enabled);

    const Icon = source.icon;

    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", source.tint)}>
                            <Icon className="h-4 w-4" />
                        </span>
                        {source.name}
                    </DialogTitle>
                    <DialogDescription>
                        Choose which voice agent handles these leads and when it should call.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 py-4">
                    <div className="grid gap-2">
                        <Label>Assign voice agent</Label>
                        <Select value={agentId} onValueChange={setAgentId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select an agent" />
                            </SelectTrigger>
                            <SelectContent>
                                {MOCK_AGENTS.map((agent) => (
                                    <SelectItem key={agent.id} value={agent.id}>
                                        {agent.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label>Call after</Label>
                        <Select value={callAfter} onValueChange={setCallAfter}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CALL_AFTER_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            How long to wait after a lead submits before the agent dials.
                        </p>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="max-retries">Max retry attempts</Label>
                        <Input
                            id="max-retries"
                            type="number"
                            min={0}
                            max={10}
                            value={maxRetries}
                            onChange={(e) => setMaxRetries(Math.max(0, Number(e.target.value) || 0))}
                        />
                        <p className="text-xs text-muted-foreground">
                            Retries if the lead doesn&apos;t answer the first call.
                        </p>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                            <p className="text-sm font-medium">Active</p>
                            <p className="text-xs text-muted-foreground">
                                When off, leads are stored but no calls are placed.
                            </p>
                        </div>
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:justify-between">
                    {isConnected ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={onDisconnect}
                        >
                            Disconnect
                        </Button>
                    ) : (
                        <span />
                    )}
                    <Button
                        type="button"
                        onClick={() => onSave({ agentId, callAfter, maxRetries, enabled })}
                    >
                        <Check className="mr-1 h-4 w-4" />
                        {isConnected ? "Save changes" : "Connect source"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
