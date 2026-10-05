'use client';

import { Check, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import type { ChoiceOption } from './agentQuestionnaire';

/* Answer controls shared by the agent-builder questionnaire and AI interview. */

export function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function OptionCard({
    option,
    selected,
    onSelect,
    compact,
    multiple,
}: {
    option: ChoiceOption;
    selected: boolean;
    onSelect: () => void;
    compact?: boolean;
    /** A checkbox in a pick-several list instead of a radio. */
    multiple?: boolean;
}) {
    const Icon = option.icon;
    return (
        <button
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={selected}
            onClick={onSelect}
            className={cn(
                'group flex w-full items-center gap-3 rounded-xl border text-left transition-all',
                compact ? 'p-3' : 'p-3.5',
                selected
                    ? 'border-ai bg-ai/[0.07] ring-1 ring-ai'
                    : 'border-border/70 bg-card hover:border-ai/50 hover:bg-accent/40 active:bg-accent',
            )}
        >
            {Icon && (
                <span
                    className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
                        selected ? 'bg-ai text-ai-foreground' : 'bg-muted text-muted-foreground group-hover:text-ai',
                    )}
                >
                    <Icon className="size-5" />
                </span>
            )}
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.label}</span>
                {option.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>}
            </span>
            <span
                className={cn(
                    'flex size-5 shrink-0 items-center justify-center border transition-colors',
                    multiple ? 'rounded-md' : 'rounded-full',
                    selected ? 'border-ai bg-ai text-ai-foreground' : 'border-border',
                )}
                aria-hidden
            >
                {selected && <Check className="size-3" strokeWidth={3} />}
            </span>
        </button>
    );
}

export function Chip({ label, selected, onToggle }: { label: string; selected: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onToggle}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-all',
                selected
                    ? 'border-ai bg-ai text-ai-foreground shadow-sm'
                    : 'border-border/70 bg-card hover:border-ai/50 active:bg-accent',
            )}
        >
            {selected && <Check className="size-3.5" strokeWidth={3} />}
            {label}
        </button>
    );
}

export function ChipGroup({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((o) => (
                <Chip key={o} label={o} selected={selected.includes(o)} onToggle={() => onToggle(o)} />
            ))}
        </div>
    );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={htmlFor} className="text-sm font-medium">
                    {label}
                </Label>
                {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </div>
            {children}
        </div>
    );
}

export function AddCustomChip({ onAdd, placeholder }: { onAdd: (value: string) => void; placeholder: string }) {
    const [value, setValue] = useState('');
    const add = () => {
        const v = value.trim();
        if (!v) return;
        onAdd(v);
        setValue('');
    };
    return (
        <div className="flex gap-2">
            <Input
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        add();
                    }
                }}
            />
            <Button type="button" variant="outline" onClick={add} disabled={!value.trim()} className="shrink-0">
                <Plus className="size-4" />
                Add
            </Button>
        </div>
    );
}
