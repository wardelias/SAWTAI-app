"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AgentCopilotSettingsCard } from "@/components/agent-copilot/AgentCopilotSettingsCard";
import { Button } from "@/components/ui/button";

export default function AiAssistantSettingsPage() {
  return (
    <div className="flex justify-center py-12 px-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">AI Assistant</h1>
            <p className="text-muted-foreground">
              Add your Anthropic API key and choose how the assistant runs.
            </p>
          </div>
          <Button asChild variant="outline" className="gap-2 self-start sm:self-auto">
            <Link href="/workflow/assistant">
              Open assistant
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <AgentCopilotSettingsCard />
      </div>
    </div>
  );
}
