"use client";

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type BackgroundStatus, getBackgroundStatus } from '@/lib/sequencesApi';

/**
 * Warns when the background worker or campaign orchestrator isn't running.
 * Campaigns and sequences silently stall without them, so make it visible.
 */
export default function BackgroundServicesBanner({ needsOrchestrator = false }: { needsOrchestrator?: boolean }) {
    const [status, setStatus] = useState<BackgroundStatus | null>(null);

    useEffect(() => {
        let cancelled = false;
        const check = async () => {
            const res = await getBackgroundStatus();
            if (!cancelled && res.data) setStatus(res.data);
        };
        check();
        const timer = setInterval(check, 60_000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    if (!status) return null;
    const missing: string[] = [];
    if (!status.worker) missing.push('background worker');
    if (needsOrchestrator && !status.campaign_orchestrator) missing.push('campaign orchestrator');
    if (missing.length === 0) return null;

    return (
        <div className="flex gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
                <p className="font-medium">
                    The {missing.join(' and ')} {missing.length > 1 ? 'are' : 'is'} not running
                </p>
                <p className="text-muted-foreground">
                    Calls won&apos;t be placed until {missing.length > 1 ? 'they are' : 'it is'} back.
                    Redeploy the API service (it starts these automatically) or check its logs.
                </p>
            </div>
        </div>
    );
}
