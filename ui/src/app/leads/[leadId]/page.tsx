"use client";

import { ArrowLeft, Mail, MessageSquare, Phone } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import {
    getLead,
    getLeadActivities,
    type Lead,
    type LeadActivity,
} from '@/lib/leadsApi';

const CHANNEL_ICON: Record<string, typeof Phone> = {
    voice: Phone,
    sms: MessageSquare,
    email: Mail,
};

export default function LeadDetailPage() {
    const { user, getAccessToken, redirectToLogin, loading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const leadId = Number(params.leadId);

    const [lead, setLead] = useState<Lead | null>(null);
    const [activities, setActivities] = useState<LeadActivity[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const hasFetched = useRef(false);

    useEffect(() => {
        if (!authLoading && !user) redirectToLogin();
    }, [authLoading, user, redirectToLogin]);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current || !leadId) return;
        hasFetched.current = true;
        (async () => {
            setIsLoading(true);
            try {
                const token = await getAccessToken();
                const [leadRes, actRes] = await Promise.all([
                    getLead(token, leadId),
                    getLeadActivities(token, leadId),
                ]);
                if (leadRes.error) {
                    toast.error(detailFromError(leadRes.error, 'Failed to load lead'));
                    return;
                }
                setLead(leadRes.data ?? null);
                setActivities(actRes.data?.activities ?? []);
            } finally {
                setIsLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user, leadId]);

    const leadName = (l: Lead) =>
        [l.first_name, l.last_name].filter(Boolean).join(' ') || l.phone_number;
    const formatDateTime = (d: string | null) =>
        d ? new Date(d).toLocaleString() : '—';

    if (isLoading) {
        return (
            <div className="container mx-auto p-6 max-md:px-4 max-md:py-5">
                <div className="animate-pulse space-y-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-12 bg-muted rounded"></div>
                    ))}
                </div>
            </div>
        );
    }

    if (!lead) {
        return (
            <div className="container mx-auto p-6 max-md:px-4 max-md:py-5">
                <Button variant="ghost" onClick={() => router.push('/leads')} className="max-md:hidden">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to leads
                </Button>
                <p className="mt-4">Lead not found.</p>
            </div>
        );
    }

    const attributeEntries = Object.entries(lead.attributes || {});

    return (
        <div className="container mx-auto p-6 space-y-6 max-md:space-y-5 max-md:px-4 max-md:py-5">
            <Button variant="ghost" onClick={() => router.push('/leads')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to leads
            </Button>

            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold mb-1 max-md:text-2xl">{leadName(lead)}</h1>
                    <p className="text-muted-foreground">{lead.phone_number}</p>
                </div>
                <div className="flex gap-2">
                    <Badge>{lead.status}</Badge>
                    {lead.dnc && <Badge variant="destructive">DNC</Badge>}
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <Row label="Email" value={lead.email ?? '—'} />
                        <Row label="Source" value={lead.source ?? '—'} />
                        <Row label="Lead score" value={lead.lead_score != null ? String(lead.lead_score) : '—'} />
                        <Row label="Timezone" value={lead.timezone ?? '—'} />
                        <Row label="SMS consent" value={lead.consent_sms ? 'Yes' : 'No'} />
                        <Row label="Email consent" value={lead.consent_email ? 'Yes' : 'No'} />
                        <Row label="Last contacted" value={formatDateTime(lead.last_contacted_at)} />
                        <Row label="Created" value={formatDateTime(lead.created_at)} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Attributes</CardTitle>
                        <CardDescription>Imported fields available to the AI agent</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        {attributeEntries.length > 0 ? (
                            attributeEntries.map(([k, v]) => (
                                <Row key={k} label={k} value={String(v)} />
                            ))
                        ) : (
                            <p className="text-muted-foreground">No extra attributes.</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Activity timeline</CardTitle>
                    <CardDescription>Every touch across voice, SMS and email</CardDescription>
                </CardHeader>
                <CardContent>
                    {activities.length === 0 ? (
                        <p className="text-muted-foreground">No activity yet.</p>
                    ) : (
                        <div className="space-y-4">
                            {activities.map((a) => {
                                const Icon = CHANNEL_ICON[a.channel] ?? Phone;
                                return (
                                    <div key={a.id} className="flex gap-3">
                                        <div className="mt-1">
                                            <Icon className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{a.type.replace(/_/g, ' ')}</span>
                                                <Badge variant="outline">{a.channel}</Badge>
                                                <Badge variant="secondary">{a.direction}</Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                {formatDateTime(a.created_at)}
                                            </p>
                                            {a.payload && Object.keys(a.payload).length > 0 && (
                                                <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-x-auto">
                                                    {JSON.stringify(a.payload, null, 2)}
                                                </pre>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right break-all">{value}</span>
        </div>
    );
}
