"use client";

import { Check, Clock, Facebook, Globe, Instagram, Linkedin, Loader2, Lock, Plus, RefreshCw, Settings2, Target, Webhook, Zap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getWorkflowsSummaryApiV1WorkflowSummaryGet } from "@/client/sdk.gen";
import type { WorkflowSummaryResponse } from "@/client/types.gen";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import {
    connectMetaForm,
    type ConnectMetaPayload,
    disconnectMetaAccount,
    disconnectMetaConnection,
    getMetaAccount,
    listMetaConnections,
    listMetaLeadForms,
    listMetaPages,
    type MetaAccount,
    type MetaConnection,
    type MetaLeadForm,
    type MetaPage,
    startMetaOAuth,
    type UpdateConnectionPayload,
    updateMetaConnection,
} from "@/lib/marketingApi";
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
    // Only Meta is wired end-to-end in v1; the rest are placeholders.
    connectable: boolean;
};

const SOURCES: MarketingSource[] = [
    {
        id: "meta_instant_form",
        name: "Meta Instant Form",
        description: "Facebook Lead Ads — pull leads from instant forms the moment they submit.",
        icon: Facebook,
        tint: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        connectable: true,
    },
    {
        id: "instagram_lead",
        name: "Instagram Lead Ads",
        description: "Capture leads from Instagram lead generation campaigns.",
        icon: Instagram,
        tint: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
        connectable: false,
    },
    {
        id: "google_lead_form",
        name: "Google Lead Form",
        description: "Leads from Google Ads lead form extensions.",
        icon: Globe,
        tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        connectable: false,
    },
    {
        id: "linkedin_lead",
        name: "LinkedIn Lead Gen",
        description: "Sync leads from LinkedIn Lead Gen Forms.",
        icon: Linkedin,
        tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        connectable: false,
    },
    {
        id: "web_form",
        name: "Website Form",
        description: "Embed a form or post submissions from your own site.",
        icon: Zap,
        tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
        connectable: false,
    },
    {
        id: "webhook",
        name: "Webhook / Zapier",
        description: "Send leads from any tool via a generic webhook.",
        icon: Webhook,
        tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        connectable: false,
    },
];

const META_SOURCE = SOURCES[0];

const CALL_AFTER_OPTIONS: { value: number; label: string }[] = [
    { value: 0, label: "Immediately" },
    { value: 300, label: "After 5 minutes" },
    { value: 900, label: "After 15 minutes" },
    { value: 1800, label: "After 30 minutes" },
    { value: 3600, label: "After 1 hour" },
    { value: 86400, label: "After 1 day" },
];

function callAfterLabel(seconds: number) {
    return CALL_AFTER_OPTIONS.find((o) => o.value === seconds)?.label ?? `After ${seconds}s`;
}

const FORM_STATUS_LABEL: Record<string, string> = {
    ACTIVE: "Active",
    DRAFT: "Draft",
    ARCHIVED: "Archived",
};

/** Active forms first; deleted forms can never receive leads, so hide them. */
function sortForms(forms: MetaLeadForm[]) {
    const rank = (f: MetaLeadForm) => (f.status === "ACTIVE" ? 0 : f.status === "DRAFT" ? 1 : 2);
    return forms.filter((f) => f.status !== "DELETED").sort((a, b) => rank(a) - rank(b));
}

function formDetail(form: MetaLeadForm) {
    const parts = [FORM_STATUS_LABEL[form.status ?? ""] ?? form.status];
    if (form.leads_count != null) parts.push(`${form.leads_count} lead${form.leads_count === 1 ? "" : "s"}`);
    return parts.filter(Boolean).join(" · ");
}

type AuthHeadersFn = () => Promise<{ Authorization: string }>;

type DialogState =
    | { mode: "connect" }
    | { mode: "edit"; connection: MetaConnection }
    | null;

export default function MarketingPage() {
    return (
        <Suspense fallback={null}>
            <MarketingPageContent />
        </Suspense>
    );
}

function MarketingPageContent() {
    const { user, getAccessToken, loading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [agents, setAgents] = useState<WorkflowSummaryResponse[]>([]);
    const [connections, setConnections] = useState<MetaConnection[]>([]);
    const [metaAccount, setMetaAccount] = useState<MetaAccount | null>(null);
    const [loading, setLoading] = useState(true);
    const [dialog, setDialog] = useState<DialogState>(null);
    const [redirectingToFacebook, setRedirectingToFacebook] = useState(false);
    const [confirmUnlink, setConfirmUnlink] = useState(false);
    const hasFetched = useRef(false);
    const handledOAuthReturn = useRef(false);

    const authHeaders = useCallback(async () => {
        const token = await getAccessToken();
        return { Authorization: `Bearer ${token}` };
    }, [getAccessToken]);

    const fetchConnections = useCallback(async () => {
        const headers = await authHeaders();
        const res = await listMetaConnections(headers);
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to load connections"));
            return;
        }
        setConnections(res.data?.connections ?? []);
    }, [authHeaders]);

    const fetchAgents = useCallback(async () => {
        const headers = await authHeaders();
        const res = await getWorkflowsSummaryApiV1WorkflowSummaryGet({
            headers,
            query: { status: "active" },
        });
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to load agents"));
            return;
        }
        setAgents(res.data ?? []);
    }, [authHeaders]);

    const fetchMetaAccount = useCallback(async () => {
        const headers = await authHeaders();
        const res = await getMetaAccount(headers);
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to load Facebook connection"));
            return;
        }
        setMetaAccount(res.data ?? null);
    }, [authHeaders]);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        (async () => {
            await Promise.all([fetchAgents(), fetchConnections(), fetchMetaAccount()]);
            setLoading(false);
        })();
    }, [authLoading, user, fetchAgents, fetchConnections, fetchMetaAccount]);

    // Back from Facebook Login (via /marketing/meta/callback): open the lead
    // form picker straight away, or explain why the connection failed.
    useEffect(() => {
        if (loading || handledOAuthReturn.current) return;
        const status = searchParams.get("meta");
        const error = searchParams.get("meta_error");
        if (!status && !error) return;
        handledOAuthReturn.current = true;
        if (status === "connected") {
            toast.success("Facebook connected. Pick a lead form to start calling leads.");
            setDialog({ mode: "connect" });
        }
        if (error) toast.error(error);
        router.replace("/marketing", { scroll: false });
    }, [loading, searchParams, router]);

    const handleConnectFacebook = async () => {
        setRedirectingToFacebook(true);
        const headers = await authHeaders();
        const res = await startMetaOAuth(headers);
        if (res.error || !res.data) {
            toast.error(detailFromError(res.error, "Couldn't start Facebook sign-in"));
            setRedirectingToFacebook(false);
            return;
        }
        window.location.assign(res.data.authorize_url);
    };

    const handleUnlinkFacebook = async () => {
        const headers = await authHeaders();
        const res = await disconnectMetaAccount(headers);
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to disconnect Facebook"));
            return;
        }
        toast.success("Facebook disconnected. Lead forms you already connected keep calling new leads.");
        setConfirmUnlink(false);
        await fetchMetaAccount();
    };

    const handleConnect = async (payload: ConnectMetaPayload) => {
        const headers = await authHeaders();
        const res = await connectMetaForm(payload, headers);
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to connect Meta form"));
            return;
        }
        toast.success("Lead form connected — your agent will call every new lead automatically.");
        setDialog(null);
        await fetchConnections();
    };

    const handleUpdate = async (id: number, patch: UpdateConnectionPayload) => {
        const headers = await authHeaders();
        const res = await updateMetaConnection(id, patch, headers);
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to update connection"));
            return;
        }
        toast.success("Connection updated.");
        setDialog(null);
        await fetchConnections();
    };

    const handleDisconnect = async (id: number) => {
        const headers = await authHeaders();
        const res = await disconnectMetaConnection(id, headers);
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to disconnect"));
            return;
        }
        toast.success("Disconnected.");
        setDialog(null);
        await fetchConnections();
    };

    // All source cards are shown; Meta stays connectable (you can add multiple
    // forms), the rest render as "Coming soon".
    const available = SOURCES;
    const connectedFormIds = useMemo(
        () => new Set(connections.map((c) => c.form_id).filter((id): id is string => !!id)),
        [connections],
    );

    const metaActions = (
        <MetaCardActions
            account={metaAccount}
            redirecting={redirectingToFacebook}
            onConnectFacebook={handleConnectFacebook}
            onAddForm={() => setDialog({ mode: "connect" })}
            onUnlink={() => setConfirmUnlink(true)}
        />
    );

    return (
        <div className="container mx-auto px-4 py-8 max-md:py-5">
            <div className="mx-auto max-w-5xl space-y-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
                    <p className="text-sm text-muted-foreground">
                        Connect your lead sources and decide how your voice agents follow up on every new lead.
                    </p>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading connections…
                    </div>
                ) : (
                    <>
                        {/* Connected sources */}
                        <section className="space-y-3">
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                                    Connected Sources
                                </h2>
                                {connections.length > 0 && (
                                    <Badge variant="secondary">{connections.length}</Badge>
                                )}
                            </div>

                            {connections.length === 0 ? (
                                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground sm:p-8">
                                    <p className="mb-4 text-center">No sources connected yet. Get your agent calling Facebook leads in three steps:</p>
                                    <ol className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-3">
                                        {[
                                            "Connect your Facebook account",
                                            "Pick the lead form to pull leads from",
                                            "Your voice agent calls every new lead",
                                        ].map((step, i) => (
                                            <li key={step} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 text-foreground">
                                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                                                    {i + 1}
                                                </span>
                                                {step}
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {connections.map((conn) => {
                                        const Icon = META_SOURCE.icon;
                                        return (
                                            <Card key={conn.id}>
                                                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                                                    <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", META_SOURCE.tint)}>
                                                        <Icon className="h-5 w-5" />
                                                    </div>

                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <p className="min-w-0 break-words font-medium">{conn.form_name || META_SOURCE.name}</p>
                                                            {conn.enabled ? (
                                                                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
                                                                    Active
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="secondary">Paused</Badge>
                                                            )}
                                                        </div>
                                                        {conn.page_name && (
                                                            <p className="text-xs text-muted-foreground">{conn.page_name}</p>
                                                        )}
                                                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                                            {conn.instant && (
                                                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                                                                    <Zap className="h-3.5 w-3.5" />
                                                                    Instant
                                                                </span>
                                                            )}
                                                            <span className="inline-flex items-center gap-1">
                                                                <Target className="h-3.5 w-3.5" />
                                                                {conn.workflow_name || "Unassigned"}
                                                            </span>
                                                            <span className="inline-flex items-center gap-1">
                                                                <Clock className="h-3.5 w-3.5" />
                                                                Call {callAfterLabel(conn.call_after_seconds).toLowerCase()}
                                                            </span>
                                                            <span>
                                                                {conn.max_retries} retr{conn.max_retries === 1 ? "y" : "ies"}
                                                            </span>
                                                            <span>{conn.total_leads} lead{conn.total_leads === 1 ? "" : "s"}</span>
                                                        </div>
                                                    </div>

                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="shrink-0"
                                                        onClick={() => setDialog({ mode: "edit", connection: conn })}
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
                                                {source.id === "meta_instant_form" ? (
                                                    metaActions
                                                ) : source.connectable ? (
                                                    <Button
                                                        variant="outline"
                                                        className="w-full"
                                                        onClick={() => setDialog({ mode: "connect" })}
                                                    >
                                                        <Plus className="mr-1 h-4 w-4" />
                                                        Connect
                                                    </Button>
                                                ) : (
                                                    <Button variant="outline" className="w-full" disabled>
                                                        <Lock className="mr-1 h-4 w-4" />
                                                        Coming soon
                                                    </Button>
                                                )}
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        </section>
                    </>
                )}
            </div>

            {dialog && (
                <ConfigureSourceDialog
                    dialog={dialog}
                    agents={agents}
                    account={metaAccount}
                    connectedFormIds={connectedFormIds}
                    authHeaders={authHeaders}
                    onOpenChange={(open) => !open && setDialog(null)}
                    onConnect={handleConnect}
                    onUpdate={handleUpdate}
                    onDisconnect={handleDisconnect}
                />
            )}

            <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect Facebook?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You won&apos;t be able to add new lead forms until you reconnect. Lead forms you already
                            connected keep calling new leads; disconnect those individually to stop them.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleUnlinkFacebook}>Disconnect</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

interface MetaCardActionsProps {
    account: MetaAccount | null;
    redirecting: boolean;
    onConnectFacebook: () => void;
    onAddForm: () => void;
    onUnlink: () => void;
}

/** Meta card button: Connect with Facebook -> Add lead form (or manual token if OAuth is off). */
function MetaCardActions({ account, redirecting, onConnectFacebook, onAddForm, onUnlink }: MetaCardActionsProps) {
    if (!account?.oauth_configured) {
        return (
            <Button variant="outline" className="w-full" onClick={onAddForm}>
                <Plus className="mr-1 h-4 w-4" />
                Connect
            </Button>
        );
    }

    const facebookButton = (label: string, Icon: typeof Facebook) => (
        <Button
            className="w-full bg-[#1877F2] text-white hover:bg-[#166FE5]"
            disabled={redirecting}
            onClick={onConnectFacebook}
        >
            {redirecting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Icon className="mr-1 h-4 w-4" />}
            {label}
        </Button>
    );

    if (!account.connected) return facebookButton("Connect with Facebook", Facebook);

    if (account.needs_reconnect) {
        return (
            <div className="space-y-2">
                {facebookButton("Reconnect Facebook", RefreshCw)}
                <p className="text-xs text-muted-foreground">
                    Your Facebook connection expired. Connected forms keep calling leads.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <Button variant="outline" className="w-full" onClick={onAddForm}>
                <Plus className="mr-1 h-4 w-4" />
                Add lead form
            </Button>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                    Connected as {account.meta_user_name || "your Facebook account"}
                </span>
                <button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={onUnlink}>
                    Disconnect
                </button>
            </div>
        </div>
    );
}

interface ConfigureSourceDialogProps {
    dialog: Exclude<DialogState, null>;
    agents: WorkflowSummaryResponse[];
    account: MetaAccount | null;
    connectedFormIds: Set<string>;
    authHeaders: AuthHeadersFn;
    onOpenChange: (open: boolean) => void;
    onConnect: (payload: ConnectMetaPayload) => Promise<void>;
    onUpdate: (id: number, patch: UpdateConnectionPayload) => Promise<void>;
    onDisconnect: (id: number) => Promise<void>;
}

function ConfigureSourceDialog({
    dialog,
    agents,
    account,
    connectedFormIds,
    authHeaders,
    onOpenChange,
    onConnect,
    onUpdate,
    onDisconnect,
}: ConfigureSourceDialogProps) {
    const isConnect = dialog.mode === "connect";
    const existing = dialog.mode === "edit" ? dialog.connection : null;
    const canPick = !!account?.connected && !account.needs_reconnect;

    // Connected account -> pick Page + form; otherwise paste a token by hand.
    const [manual, setManual] = useState(!canPick);
    const usePicker = isConnect && !manual;

    const [pages, setPages] = useState<MetaPage[] | null>(null);
    const [pickerError, setPickerError] = useState<string | null>(null);
    const [selectedPageId, setSelectedPageId] = useState("");
    const [forms, setForms] = useState<MetaLeadForm[] | null>(null);
    const [pickedFormId, setPickedFormId] = useState("");

    useEffect(() => {
        if (!usePicker || pages !== null) return;
        let cancelled = false;
        (async () => {
            const res = await listMetaPages(await authHeaders());
            if (cancelled) return;
            if (res.error) {
                setPickerError(detailFromError(res.error, "Couldn't load your Facebook Pages"));
                setPages([]);
                return;
            }
            const list = res.data?.pages ?? [];
            setPages(list);
            const readable = list.filter((p) => p.can_read_leads);
            if (readable.length === 1) setSelectedPageId(readable[0].id);
        })();
        return () => {
            cancelled = true;
        };
    }, [usePicker, pages, authHeaders]);

    useEffect(() => {
        if (!selectedPageId) return;
        let cancelled = false;
        (async () => {
            setForms(null);
            setPickedFormId("");
            setPickerError(null);
            const res = await listMetaLeadForms(selectedPageId, await authHeaders());
            if (cancelled) return;
            if (res.error) {
                setPickerError(detailFromError(res.error, "Couldn't load lead forms for this Page"));
                setForms([]);
                return;
            }
            const list = sortForms(res.data?.forms ?? []);
            setForms(list);
            const available = list.filter((f) => !connectedFormIds.has(f.id));
            const active = available.filter((f) => f.status === "ACTIVE");
            if (available.length === 1) setPickedFormId(available[0].id);
            else if (active.length === 1) setPickedFormId(active[0].id);
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedPageId, authHeaders, connectedFormIds]);

    const [pageToken, setPageToken] = useState("");
    const [formId, setFormId] = useState("");
    const [pageId, setPageId] = useState("");
    const [workflowId, setWorkflowId] = useState<string>(
        existing ? String(existing.workflow_id) : agents[0] ? String(agents[0].id) : "",
    );
    const [callAfter, setCallAfter] = useState<number>(existing?.call_after_seconds ?? 300);
    const [maxRetries, setMaxRetries] = useState<number>(existing?.max_retries ?? 2);
    const [enabled, setEnabled] = useState<boolean>(existing?.enabled ?? true);
    const [saving, setSaving] = useState(false);

    const Icon = META_SOURCE.icon;

    const canSubmit = !isConnect
        ? workflowId !== ""
        : usePicker
          ? selectedPageId !== "" && pickedFormId !== "" && workflowId !== ""
          : pageToken.trim().length > 0 && formId.trim().length > 0 && workflowId !== "";

    const handleSubmit = async () => {
        setSaving(true);
        try {
            if (usePicker) {
                await onConnect({
                    page_id: selectedPageId,
                    form_id: pickedFormId,
                    workflow_id: Number(workflowId),
                    call_after_seconds: callAfter,
                    max_retries: maxRetries,
                });
            } else if (isConnect) {
                await onConnect({
                    page_access_token: pageToken.trim(),
                    form_id: formId.trim(),
                    page_id: pageId.trim() || undefined,
                    workflow_id: Number(workflowId),
                    call_after_seconds: callAfter,
                    max_retries: maxRetries,
                });
            } else if (existing) {
                await onUpdate(existing.id, {
                    workflow_id: Number(workflowId),
                    call_after_seconds: callAfter,
                    max_retries: maxRetries,
                    enabled,
                });
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", META_SOURCE.tint)}>
                            <Icon className="h-4 w-4" />
                        </span>
                        {existing?.form_name || META_SOURCE.name}
                    </DialogTitle>
                    <DialogDescription>
                        {usePicker
                            ? "Pick the Facebook Page and lead form to pull leads from, then choose which agent calls them."
                            : isConnect
                              ? "Paste your Meta Page access token and lead form ID, then choose which agent calls new leads."
                              : "Choose which voice agent handles these leads and when it should call."}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 py-4">
                    {usePicker && (
                        <>
                            <div className="grid gap-2">
                                <Label>Facebook Page</Label>
                                <Select value={selectedPageId} onValueChange={setSelectedPageId} disabled={pages === null}>
                                    <SelectTrigger>
                                        <SelectValue
                                            placeholder={
                                                pages === null
                                                    ? "Loading your Pages…"
                                                    : pages.length
                                                      ? "Select a Page"
                                                      : "No Pages found"
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(pages ?? []).map((page) => (
                                            <SelectItem key={page.id} value={page.id} disabled={!page.can_read_leads}>
                                                {page.name}
                                                {!page.can_read_leads && " (no lead access)"}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {pages?.length === 0 && !pickerError && (
                                    <p className="text-xs text-muted-foreground">
                                        No Pages were shared. Reconnect Facebook and allow access to the Page that runs
                                        your lead ads.
                                    </p>
                                )}
                            </div>

                            {selectedPageId && (
                                <div className="grid gap-2">
                                    <Label>Lead form</Label>
                                    <Select value={pickedFormId} onValueChange={setPickedFormId} disabled={forms === null}>
                                        <SelectTrigger>
                                            <SelectValue
                                                placeholder={
                                                    forms === null
                                                        ? "Loading lead forms…"
                                                        : forms.length
                                                          ? "Select a lead form"
                                                          : "No lead forms on this Page"
                                                }
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(forms ?? []).map((form) => {
                                                const taken = connectedFormIds.has(form.id);
                                                return (
                                                    <SelectItem key={form.id} value={form.id} disabled={taken}>
                                                        <span>{form.name}</span>
                                                        <span className="ml-2 text-xs text-muted-foreground">
                                                            {taken ? "Already connected" : formDetail(form)}
                                                        </span>
                                                    </SelectItem>
                                                );
                                            })}
                                        </SelectContent>
                                    </Select>
                                    {forms?.length === 0 && !pickerError && (
                                        <p className="text-xs text-muted-foreground">
                                            Create an Instant Form for this Page in Meta Ads Manager, then come back.
                                        </p>
                                    )}
                                </div>
                            )}

                            {pickerError && <p className="text-xs text-destructive">{pickerError}</p>}

                            <p className="text-xs text-muted-foreground">
                                Only leads submitted from now on are called.{" "}
                                <button
                                    type="button"
                                    className="underline underline-offset-2 hover:text-foreground"
                                    onClick={() => setManual(true)}
                                >
                                    Paste a Page access token instead
                                </button>
                            </p>
                        </>
                    )}

                    {isConnect && !usePicker && (
                        <>
                            <div className="grid gap-2">
                                <Label htmlFor="page-token">Page access token</Label>
                                <Input
                                    id="page-token"
                                    type="password"
                                    autoComplete="off"
                                    placeholder="EAAB..."
                                    value={pageToken}
                                    onChange={(e) => setPageToken(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    A long-lived Page access token with the leads_retrieval permission.
                                </p>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="form-id">Lead form ID</Label>
                                <Input
                                    id="form-id"
                                    placeholder="1234567890"
                                    value={formId}
                                    onChange={(e) => setFormId(e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="page-id">Page ID (optional)</Label>
                                <Input
                                    id="page-id"
                                    placeholder="Your Facebook Page ID"
                                    value={pageId}
                                    onChange={(e) => setPageId(e.target.value)}
                                />
                            </div>
                            {canPick && (
                                <button
                                    type="button"
                                    className="justify-self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                    onClick={() => setManual(false)}
                                >
                                    Pick a lead form from Facebook instead
                                </button>
                            )}
                        </>
                    )}

                    <div className="grid gap-2">
                        <Label>Assign voice agent</Label>
                        <Select value={workflowId} onValueChange={setWorkflowId}>
                            <SelectTrigger>
                                <SelectValue placeholder={agents.length ? "Select an agent" : "No agents available"} />
                            </SelectTrigger>
                            <SelectContent>
                                {agents.map((agent) => (
                                    <SelectItem key={agent.id} value={String(agent.id)}>
                                        {agent.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {agents.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                                Create an agent (workflow) first, then connect a lead source.
                            </p>
                        )}
                    </div>

                    <div className="grid gap-2">
                        <Label>Call after</Label>
                        <Select value={String(callAfter)} onValueChange={(v) => setCallAfter(Number(v))}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CALL_AFTER_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={String(opt.value)}>
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
                            onChange={(e) => setMaxRetries(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                        />
                        <p className="text-xs text-muted-foreground">
                            Retries if the lead doesn&apos;t answer the first call.
                        </p>
                    </div>

                    {!isConnect && (
                        <div className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                                <p className="text-sm font-medium">Active</p>
                                <p className="text-xs text-muted-foreground">
                                    When off, leads are stored but no calls are placed.
                                </p>
                            </div>
                            <Switch checked={enabled} onCheckedChange={setEnabled} />
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:justify-between">
                    {existing ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={saving}
                            onClick={() => onDisconnect(existing.id)}
                        >
                            Disconnect
                        </Button>
                    ) : (
                        <span />
                    )}
                    <Button type="button" onClick={handleSubmit} disabled={!canSubmit || saving}>
                        {saving ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                            <Check className="mr-1 h-4 w-4" />
                        )}
                        {isConnect ? "Start calling leads" : "Save changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
