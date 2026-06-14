"use client";

import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { BEHAVIOR_PRESETS, type BehaviorPreset, type BehaviorScope } from "../../config";

export interface BehaviorToolConfigProps {
    name: string;
    onNameChange: (name: string) => void;
    description: string;
    onDescriptionChange: (description: string) => void;
    instructions: string;
    onInstructionsChange: (instructions: string) => void;
    scope: BehaviorScope;
    onScopeChange: (scope: BehaviorScope) => void;
    onApplyPreset: (preset: BehaviorPreset) => void;
    special?: string | null;
}

export function BehaviorToolConfig({
    name,
    onNameChange,
    description,
    onDescriptionChange,
    instructions,
    onInstructionsChange,
    scope,
    onScopeChange,
    onApplyPreset,
    special,
}: BehaviorToolConfigProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    Behavior Configuration
                </CardTitle>
                <CardDescription>
                    A behavior injects these instructions into the agent&apos;s system prompt. Attach
                    it to a node, or enable it for the whole agent under the agent&apos;s Behaviors
                    settings.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Name */}
                <div className="space-y-2">
                    <Label htmlFor="behavior-name">Name</Label>
                    <Input
                        id="behavior-name"
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="e.g., Concise Voice Replies"
                    />
                </div>

                {/* Description */}
                <div className="space-y-2">
                    <Label htmlFor="behavior-description">Description</Label>
                    <Input
                        id="behavior-description"
                        value={description}
                        onChange={(e) => onDescriptionChange(e.target.value)}
                        placeholder="Short summary of what this behavior does"
                    />
                </div>

                {/* Start from a preset */}
                <div className="space-y-2">
                    <Label htmlFor="behavior-preset">Start from a preset (optional)</Label>
                    <Select
                        onValueChange={(id) => {
                            const preset = BEHAVIOR_PRESETS.find((p) => p.id === id);
                            if (preset) onApplyPreset(preset);
                        }}
                    >
                        <SelectTrigger id="behavior-preset">
                            <SelectValue placeholder="Choose a ready-made behavior..." />
                        </SelectTrigger>
                        <SelectContent>
                            {[...BEHAVIOR_PRESETS]
                                .sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false))
                                .map((preset) => (
                                    <SelectItem key={preset.id} value={preset.id}>
                                        <span className="flex items-center gap-2">
                                            {preset.name}
                                            {preset.recommended && (
                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                    Recommended
                                                </Badge>
                                            )}
                                        </span>
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Picking a preset fills in the instructions below — you can then edit them.
                    </p>
                </div>

                {/* Scope */}
                <div className="space-y-2">
                    <Label htmlFor="behavior-scope">Applies to</Label>
                    <Select value={scope} onValueChange={(v) => onScopeChange(v as BehaviorScope)}>
                        <SelectTrigger id="behavior-scope">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="global">Whole agent (enable in agent settings)</SelectItem>
                            <SelectItem value="node">Specific nodes (attach in the node tool picker)</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {scope === "global"
                            ? "Enable this behavior for an agent under Settings → Behaviors; it applies across the whole call."
                            : "Attach this behavior to individual nodes via the node's tool picker."}
                    </p>
                </div>

                {/* Instructions */}
                <div className="space-y-2">
                    <Label htmlFor="behavior-instructions">Instructions</Label>
                    <p className="text-xs text-muted-foreground">
                        Written as direct instructions to the agent. Injected under a &quot;BEHAVIOR
                        GUIDELINES&quot; heading in the system prompt.
                    </p>
                    <Textarea
                        id="behavior-instructions"
                        value={instructions}
                        onChange={(e) => onInstructionsChange(e.target.value)}
                        placeholder="e.g., Keep replies short and conversational; never use markdown or lists."
                        rows={6}
                    />
                </div>

                {special === "voice_gender_detection" && (
                    <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 text-sm text-purple-700 dark:text-purple-300">
                        This behavior also enables <strong>voice gender detection</strong>: the agent
                        estimates the caller&apos;s gender from their voice and the detected note is
                        injected automatically at runtime.
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
