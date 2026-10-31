"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { completeMetaOAuth } from "@/lib/marketingApi";

/**
 * Facebook Login redirects here with `code` + `state` (or `error` if the person
 * cancelled). We finish the connection while signed in, then hand back to the
 * Marketing page, which opens the lead form picker.
 */
function MetaCallback() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, getAccessToken, loading: authLoading } = useAuth();
    // The code can only be exchanged once; guard against double effects.
    const started = useRef(false);

    useEffect(() => {
        if (authLoading || !user || started.current) return;
        started.current = true;

        const backWithError = (message: string) =>
            router.replace(`/marketing?meta_error=${encodeURIComponent(message)}`);

        const code = searchParams.get("code");
        const state = searchParams.get("state");
        const error = searchParams.get("error");

        if (error || !code || !state) {
            backWithError(
                searchParams.get("error_reason") === "user_denied"
                    ? "Facebook connection was cancelled."
                    : searchParams.get("error_description") || "Facebook didn't complete the connection. Please try again.",
            );
            return;
        }

        (async () => {
            const token = await getAccessToken();
            const res = await completeMetaOAuth({ code, state }, { Authorization: `Bearer ${token}` });
            if (res.error) {
                backWithError(detailFromError(res.error, "Couldn't connect your Facebook account."));
                return;
            }
            router.replace("/marketing?meta=connected");
        })();
    }, [authLoading, user, getAccessToken, router, searchParams]);

    return <CallbackSpinner />;
}

function CallbackSpinner() {
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            Finishing your Facebook connection…
        </div>
    );
}

export default function MetaCallbackPage() {
    return (
        <Suspense fallback={<CallbackSpinner />}>
            <MetaCallback />
        </Suspense>
    );
}
