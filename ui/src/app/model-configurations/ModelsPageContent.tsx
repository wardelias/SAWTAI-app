"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AgentCopilotSettingsCard } from "@/components/agent-copilot/AgentCopilotSettingsCard";
import ModelConfigurationV2 from "@/components/ModelConfigurationV2";

const AI_ASSISTANT_ID = "ai-assistant";
// How long to keep the card in view while the sections settle.
const SETTLE_MS = 2000;
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Voice agent models, then the AI Assistant's settings.
 *
 * Links to `#ai-assistant` land while both sections are still loading, so the
 * browser's own jump happens on the shorter skeleton page and ends up short of
 * the card. Once both have loaded, jump again, and keep the card in view while
 * the voice editor settles (it picks its tab and provider forms over a few more
 * renders), until the user scrolls themselves.
 */
export function ModelsPageContent({ docsUrl }: { docsUrl?: string }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [voiceReady, setVoiceReady] = useState(false);
    const [assistantReady, setAssistantReady] = useState(false);
    const jumped = useRef(false);

    const onVoiceReady = useCallback(() => setVoiceReady(true), []);
    const onAssistantReady = useCallback(() => setAssistantReady(true), []);

    useEffect(() => {
        if (!voiceReady || !assistantReady || jumped.current) return;
        jumped.current = true;
        const card = document.getElementById(AI_ASSISTANT_ID);
        const content = contentRef.current;
        if (window.location.hash !== `#${AI_ASSISTANT_ID}` || !card || !content) return;

        const jump = () => card.scrollIntoView({ block: "start" });
        const observer = new ResizeObserver(jump);
        observer.observe(content); // Also fires once right away.

        const stop = () => {
            observer.disconnect();
            window.clearTimeout(timer);
            USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, stop));
        };
        const timer = window.setTimeout(stop, SETTLE_MS);
        USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, stop, { passive: true }));
        return stop;
    }, [voiceReady, assistantReady]);

    return (
        <div ref={contentRef} className="space-y-8">
            <ModelConfigurationV2 docsUrl={docsUrl} onReady={onVoiceReady} />
            <AgentCopilotSettingsCard onReady={onAssistantReady} />
        </div>
    );
}
