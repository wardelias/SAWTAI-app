'use client';

import { ArrowLeft, ArrowRight, Check, PenLine, Plus, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { AgentCallType } from './agentIdeas';
import {
    AUDIENCE_OPTIONS,
    buildAgentBrief,
    type ChoiceOption,
    COLLECT_OPTIONS,
    DIRECTION_OPTIONS,
    findGoal,
    goalsFor,
    HANDOFF_OPTIONS,
    INDUSTRY_OPTIONS,
    LANGUAGE_OPTIONS,
    LENGTH_OPTIONS,
    OTHER_GOAL,
    OUTCOME_OPTIONS,
    type QuestionnaireAnswers,
    resolveUseCase,
    TONE_OPTIONS,
    VOICE_OPTIONS,
} from './agentQuestionnaire';

export interface AgentQuestionnaireResult {
    callType: AgentCallType;
    useCase: string;
    description: string;
}

interface AgentQuestionnaireProps {
    initialAnswers: QuestionnaireAnswers;
    onSubmit: (result: AgentQuestionnaireResult) => void;
    isSubmitting: boolean;
    error: string | null;
}

type StepId = 'direction' | 'goal' | 'business' | 'audience' | 'persona' | 'collect' | 'outcome' | 'details' | 'review';

interface StepDef {
    id: StepId;
    eyebrow: string;
    title: string;
    description: string;
    optional?: boolean;
    isValid?: (a: QuestionnaireAnswers) => boolean;
}

const STEPS: StepDef[] = [
    {
        id: 'direction',
        eyebrow: 'Call type',
        title: 'Who starts the call?',
        description: 'This decides how the agent opens the conversation.',
        isValid: (a) => Boolean(a.callType),
    },
    {
        id: 'goal',
        eyebrow: 'The job',
        title: 'What is the main job of this agent?',
        description: 'Pick the closest match. You can describe it in your own words next.',
        isValid: (a) => Boolean(resolveUseCase(a)),
    },
    {
        id: 'business',
        eyebrow: 'Your business',
        title: 'Tell us about your business',
        description: 'The agent uses this to introduce itself and answer questions.',
        optional: true,
    },
    {
        id: 'audience',
        eyebrow: 'Audience & language',
        title: 'Who will it talk to, and in which language?',
        description: 'Pick every language your callers use, including the dialect.',
        isValid: (a) => a.languages.length > 0,
    },
    {
        id: 'persona',
        eyebrow: 'Personality',
        title: 'How should the agent sound?',
        description: 'Give it a name and a tone that fits your brand.',
        optional: true,
    },
    {
        id: 'collect',
        eyebrow: 'Information',
        title: 'What should the agent find out?',
        description: "We've suggested the usual details for this job. Tap to add or remove.",
        optional: true,
    },
    {
        id: 'outcome',
        eyebrow: 'Outcome',
        title: 'How should a successful call end?',
        description: 'And when should the agent stop or hand over?',
        isValid: (a) => Boolean(a.outcome),
    },
    {
        id: 'details',
        eyebrow: 'Knowledge & rules',
        title: 'Anything else it should know?',
        description: 'Prices, opening hours, address, FAQs, and things it must never say.',
        optional: true,
    },
    {
        id: 'review',
        eyebrow: 'Review',
        title: 'Here is the brief for your agent',
        description: 'AI turns this into prompts and a call flow. Edit anything before building.',
    },
];

const QUESTION_STEPS = STEPS.length - 1;

function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/* ---------- answer controls ---------- */

function OptionCard({
    option,
    selected,
    onSelect,
    compact,
}: {
    option: ChoiceOption;
    selected: boolean;
    onSelect: () => void;
    compact?: boolean;
}) {
    const Icon = option.icon;
    return (
        <button
            type="button"
            role="radio"
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
                    'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                    selected ? 'border-ai bg-ai text-ai-foreground' : 'border-border',
                )}
                aria-hidden
            >
                {selected && <Check className="size-3" strokeWidth={3} />}
            </span>
        </button>
    );
}

function Chip({ label, selected, onToggle }: { label: string; selected: boolean; onToggle: () => void }) {
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

function ChipGroup({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((o) => (
                <Chip key={o} label={o} selected={selected.includes(o)} onToggle={() => onToggle(o)} />
            ))}
        </div>
    );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
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

function AddCustomChip({ onAdd, placeholder }: { onAdd: (value: string) => void; placeholder: string }) {
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

/* ---------- questionnaire ---------- */

export function AgentQuestionnaire({ initialAnswers, onSubmit, isSubmitting, error }: AgentQuestionnaireProps) {
    const [answers, setAnswers] = useState<QuestionnaireAnswers>(initialAnswers);
    const [stepIndex, setStepIndex] = useState(() => {
        // Skip what the builder link already answered.
        if (initialAnswers.callType && resolveUseCase(initialAnswers)) return 2;
        if (initialAnswers.callType) return 1;
        return 0;
    });
    const [direction, setDirection] = useState<1 | -1>(1);
    const [brief, setBrief] = useState('');
    const [briefEdited, setBriefEdited] = useState(false);
    const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const topRef = useRef<HTMLDivElement>(null);

    const step = STEPS[stepIndex];
    const isReview = step.id === 'review';
    const valid = step.isValid ? step.isValid(answers) : true;
    const generatedBrief = useMemo(() => buildAgentBrief(answers), [answers]);

    useEffect(() => () => {
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
    }, []);

    useEffect(() => {
        if (isReview && !briefEdited) setBrief(generatedBrief);
    }, [isReview, briefEdited, generatedBrief]);

    const update = (patch: Partial<QuestionnaireAnswers>) => setAnswers((prev) => ({ ...prev, ...patch }));

    const goTo = (index: number) => {
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
        setDirection(index >= stepIndex ? 1 : -1);
        setStepIndex(Math.max(0, Math.min(STEPS.length - 1, index)));
        topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    const next = () => goTo(stepIndex + 1);
    const back = () => goTo(stepIndex - 1);
    const advanceSoon = () => {
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
        advanceTimer.current = setTimeout(() => goTo(stepIndex + 1), 280);
    };

    const pickGoal = (value: string) => {
        const goal = findGoal(value);
        update({
            goal: value,
            // Suggest the usual details and outcome, but don't wipe answers the user already chose.
            collect: goal && answers.collect.length === 0 ? [...goal.collects] : answers.collect,
            outcome: goal && !answers.outcome ? goal.outcome : answers.outcome,
        });
        if (value !== OTHER_GOAL) advanceSoon();
    };

    const submit = () => {
        if (!answers.callType || !resolveUseCase(answers) || !brief.trim()) return;
        onSubmit({ callType: answers.callType, useCase: resolveUseCase(answers), description: brief.trim() });
    };

    const writeMyself = () => {
        if (!answers.callType) update({ callType: 'inbound' });
        if (!resolveUseCase(answers)) update({ goal: OTHER_GOAL, goalOther: 'Custom agent' });
        setBriefEdited(true);
        setBrief(answers.goalDetails || generatedBrief);
        goTo(STEPS.length - 1);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (e.key !== 'Enter' || target.tagName === 'TEXTAREA' || isReview) return;
        if (target.tagName === 'BUTTON') return;
        e.preventDefault();
        if (valid) next();
    };

    const progress = Math.min(stepIndex, QUESTION_STEPS) / QUESTION_STEPS;
    const goals = goalsFor(answers.callType);

    return (
        <div ref={topRef} className="scroll-mt-20" onKeyDown={onKeyDown}>
            {/* Progress */}
            <div className="mb-6 max-md:mb-5">
                <div className="mb-2.5 flex items-center justify-between text-xs font-medium">
                    <span className="inline-flex items-center gap-1.5 text-ai">
                        <Sparkles className="size-3.5" />
                        {isReview ? 'Ready to build' : `Question ${stepIndex + 1} of ${QUESTION_STEPS}`}
                    </span>
                    {!isReview && (
                        <button
                            type="button"
                            onClick={writeMyself}
                            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <PenLine className="size-3.5" />
                            Write it myself
                        </button>
                    )}
                </div>
                <div className="flex gap-1" aria-hidden>
                    {Array.from({ length: QUESTION_STEPS }).map((_, i) => (
                        <span
                            key={i}
                            className={cn(
                                'h-1 flex-1 rounded-full transition-colors duration-300',
                                i < stepIndex || isReview ? 'bg-ai' : i === stepIndex ? 'bg-ai/40' : 'bg-muted',
                            )}
                        />
                    ))}
                </div>
                <span className="sr-only" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} />
            </div>

            <div
                key={step.id}
                className={cn(
                    'animate-in fade-in duration-300',
                    direction === 1 ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
                )}
            >
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {step.eyebrow}
                    {step.optional && <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">Optional</span>}
                </p>
                <h2 className="text-2xl font-semibold tracking-tight max-md:text-xl">{step.title}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{step.description}</p>

                <div className="mt-6 space-y-6 max-md:mt-5 max-md:space-y-5">
                    {step.id === 'direction' && (
                        <div role="radiogroup" aria-label="Who starts the call" className="grid gap-2.5 sm:grid-cols-2">
                            {DIRECTION_OPTIONS.map((o) => (
                                <OptionCard
                                    key={o.value}
                                    option={o}
                                    selected={answers.callType === o.value}
                                    onSelect={() => {
                                        const callType = o.value as AgentCallType;
                                        const goal = findGoal(answers.goal);
                                        update({
                                            callType,
                                            // Drop a goal that doesn't fit the new direction.
                                            goal: goal && !goal.callTypes.includes(callType) ? '' : answers.goal,
                                        });
                                        advanceSoon();
                                    }}
                                />
                            ))}
                        </div>
                    )}

                    {step.id === 'goal' && (
                        <>
                            <div role="radiogroup" aria-label="Main job" className="grid gap-2.5 sm:grid-cols-2">
                                {goals.map((g) => (
                                    <OptionCard
                                        key={g.value}
                                        option={g}
                                        compact
                                        selected={answers.goal === g.value}
                                        onSelect={() => pickGoal(g.value)}
                                    />
                                ))}
                                <OptionCard
                                    option={{ value: OTHER_GOAL, label: 'Something else', hint: 'Describe it yourself', icon: PenLine }}
                                    compact
                                    selected={answers.goal === OTHER_GOAL}
                                    onSelect={() => pickGoal(OTHER_GOAL)}
                                />
                            </div>
                            {answers.goal === OTHER_GOAL && (
                                <Field label="What should the agent do?" htmlFor="goal-other">
                                    <Input
                                        id="goal-other"
                                        autoFocus
                                        placeholder="e.g. Collect warranty claims"
                                        value={answers.goalOther}
                                        onChange={(e) => update({ goalOther: e.target.value })}
                                    />
                                </Field>
                            )}
                        </>
                    )}

                    {step.id === 'business' && (
                        <>
                            <Field label="Business name" htmlFor="business-name">
                                <Input
                                    id="business-name"
                                    autoFocus
                                    placeholder="e.g. Haddad Real Estate"
                                    value={answers.businessName}
                                    onChange={(e) => update({ businessName: e.target.value })}
                                />
                            </Field>
                            <Field label="Industry">
                                <div className="flex flex-wrap gap-2">
                                    {INDUSTRY_OPTIONS.map((i) => (
                                        <Chip
                                            key={i}
                                            label={i}
                                            selected={answers.industry === i}
                                            onToggle={() => update({ industry: answers.industry === i ? '' : i })}
                                        />
                                    ))}
                                </div>
                            </Field>
                            <Field label="What do you sell or offer?" htmlFor="offering">
                                <Input
                                    id="offering"
                                    placeholder="e.g. Apartments for sale in Haifa and Tel Aviv"
                                    value={answers.offering}
                                    onChange={(e) => update({ offering: e.target.value })}
                                />
                            </Field>
                            <Field label="In your own words, what should the agent do?" htmlFor="goal-details">
                                <Textarea
                                    id="goal-details"
                                    placeholder="e.g. Call people who filled in our Facebook form, check they're looking to buy in the next 3 months and book a viewing."
                                    value={answers.goalDetails}
                                    onChange={(e) => update({ goalDetails: e.target.value })}
                                    className="min-h-24"
                                />
                            </Field>
                        </>
                    )}

                    {step.id === 'audience' && (
                        <>
                            <Field label="Who are the callers?" hint="Pick any">
                                <ChipGroup
                                    options={AUDIENCE_OPTIONS}
                                    selected={answers.audience}
                                    onToggle={(v) => update({ audience: toggle(answers.audience, v) })}
                                />
                            </Field>
                            <Field label="Languages" hint="At least one">
                                <ChipGroup
                                    options={LANGUAGE_OPTIONS}
                                    selected={answers.languages}
                                    onToggle={(v) => update({ languages: toggle(answers.languages, v) })}
                                />
                            </Field>
                            {answers.languages.length > 1 && (
                                <label className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-3.5">
                                    <span>
                                        <span className="block text-sm font-medium">Match the caller&apos;s language</span>
                                        <span className="block text-xs text-muted-foreground">
                                            Switch automatically when the caller speaks another of these languages
                                        </span>
                                    </span>
                                    <Switch
                                        checked={answers.matchCallerLanguage}
                                        onCheckedChange={(v) => update({ matchCallerLanguage: v })}
                                    />
                                </label>
                            )}
                        </>
                    )}

                    {step.id === 'persona' && (
                        <>
                            <Field label="Agent name" htmlFor="agent-name" hint="How it introduces itself">
                                <Input
                                    id="agent-name"
                                    autoFocus
                                    placeholder="e.g. Mariam"
                                    value={answers.agentName}
                                    onChange={(e) => update({ agentName: e.target.value })}
                                />
                            </Field>
                            <Field label="Voice">
                                <div role="radiogroup" aria-label="Voice" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
                                    {VOICE_OPTIONS.map((v) => (
                                        <button
                                            key={v.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={answers.voice === v.value}
                                            onClick={() => update({ voice: v.value })}
                                            className={cn(
                                                'rounded-lg px-2 py-2 text-sm transition-all',
                                                answers.voice === v.value
                                                    ? 'bg-background font-medium shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground',
                                            )}
                                        >
                                            {v.label}
                                        </button>
                                    ))}
                                </div>
                            </Field>
                            <Field label="Tone">
                                <div role="radiogroup" aria-label="Tone" className="grid gap-2.5 sm:grid-cols-2">
                                    {TONE_OPTIONS.map((t) => (
                                        <OptionCard
                                            key={t.value}
                                            option={t}
                                            compact
                                            selected={answers.tone === t.value}
                                            onSelect={() => update({ tone: answers.tone === t.value ? '' : t.value })}
                                        />
                                    ))}
                                </div>
                            </Field>
                        </>
                    )}

                    {step.id === 'collect' && (
                        <>
                            <Field label="Details to collect" hint={`${answers.collect.length} selected`}>
                                <ChipGroup
                                    options={[...new Set([...COLLECT_OPTIONS, ...answers.collect])]}
                                    selected={answers.collect}
                                    onToggle={(v) => update({ collect: toggle(answers.collect, v) })}
                                />
                            </Field>
                            <AddCustomChip
                                placeholder="Add another detail, e.g. Number of bedrooms"
                                onAdd={(v) => update({ collect: answers.collect.includes(v) ? answers.collect : [...answers.collect, v] })}
                            />
                            <Field label="Questions it must ask word for word" htmlFor="must-ask">
                                <Textarea
                                    id="must-ask"
                                    placeholder={'e.g. "Are you looking to buy or rent?"\n"Have you been pre-approved for a mortgage?"'}
                                    value={answers.mustAsk}
                                    onChange={(e) => update({ mustAsk: e.target.value })}
                                    className="min-h-24"
                                />
                            </Field>
                        </>
                    )}

                    {step.id === 'outcome' && (
                        <>
                            <div role="radiogroup" aria-label="Successful outcome" className="grid gap-2.5 sm:grid-cols-2">
                                {OUTCOME_OPTIONS.map((o) => (
                                    <OptionCard
                                        key={o.value}
                                        option={o}
                                        compact
                                        selected={answers.outcome === o.value}
                                        onSelect={() => update({ outcome: o.value })}
                                    />
                                ))}
                            </div>
                            <Field label="Hand over or end the call when…" hint="Pick any">
                                <ChipGroup
                                    options={HANDOFF_OPTIONS}
                                    selected={answers.handoff}
                                    onToggle={(v) => update({ handoff: toggle(answers.handoff, v) })}
                                />
                            </Field>
                        </>
                    )}

                    {step.id === 'details' && (
                        <>
                            <Field label="Facts the agent should know" htmlFor="knowledge">
                                <Textarea
                                    id="knowledge"
                                    autoFocus
                                    placeholder={'e.g. Open Sun–Thu 9:00–18:00. Office at 12 Herzl St, Haifa.\n3-room apartments start at ₪1.9M.'}
                                    value={answers.knowledge}
                                    onChange={(e) => update({ knowledge: e.target.value })}
                                    className="min-h-28"
                                />
                            </Field>
                            <Field label="Things it must never say or do" htmlFor="never-do">
                                <Input
                                    id="never-do"
                                    placeholder="e.g. Promise discounts, give legal advice"
                                    value={answers.neverDo}
                                    onChange={(e) => update({ neverDo: e.target.value })}
                                />
                            </Field>
                            <Field label="Call length">
                                <div role="radiogroup" aria-label="Call length" className="grid grid-cols-3 gap-2">
                                    {LENGTH_OPTIONS.map((l) => (
                                        <button
                                            key={l.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={answers.length === l.value}
                                            onClick={() => update({ length: answers.length === l.value ? '' : l.value })}
                                            className={cn(
                                                'rounded-xl border p-3 text-left transition-all',
                                                answers.length === l.value
                                                    ? 'border-ai bg-ai/[0.07] ring-1 ring-ai'
                                                    : 'border-border/70 bg-card hover:border-ai/50 active:bg-accent',
                                            )}
                                        >
                                            <span className="block text-sm font-medium">{l.label}</span>
                                            <span className="block text-xs text-muted-foreground">{l.hint}</span>
                                        </button>
                                    ))}
                                </div>
                            </Field>
                        </>
                    )}

                    {step.id === 'review' && (
                        <ReviewStep
                            answers={answers}
                            brief={brief}
                            briefEdited={briefEdited}
                            onBriefChange={(v) => {
                                setBrief(v);
                                setBriefEdited(true);
                            }}
                            onRegenerate={() => {
                                setBriefEdited(false);
                                setBrief(generatedBrief);
                            }}
                            onEdit={(id) => goTo(STEPS.findIndex((s) => s.id === id))}
                            onUseCaseChange={(v) => update({ goal: OTHER_GOAL, goalOther: v })}
                        />
                    )}
                </div>
            </div>

            {error && <p className="mt-5 text-sm text-destructive">{error}</p>}

            {/* Navigation */}
            <div className="mt-8 flex items-center gap-3 border-t border-border/60 pt-5 max-md:mt-6">
                {stepIndex > 0 && (
                    <Button type="button" variant="ghost" onClick={back} disabled={isSubmitting} className="gap-1.5">
                        <ArrowLeft className="size-4" />
                        Back
                    </Button>
                )}
                <div className="flex-1" />
                {isReview ? (
                    <Button
                        type="button"
                        onClick={submit}
                        disabled={isSubmitting || !brief.trim() || !answers.callType || !resolveUseCase(answers)}
                        className="h-11 gap-2 rounded-xl bg-ai px-6 text-ai-foreground hover:bg-ai/90 max-md:flex-1"
                    >
                        <Wand2 className="size-4" />
                        {isSubmitting ? 'Building…' : 'Build my agent'}
                    </Button>
                ) : (
                    <Button
                        type="button"
                        onClick={next}
                        disabled={!valid}
                        className="h-11 gap-1.5 rounded-xl bg-ai px-6 text-ai-foreground hover:bg-ai/90 max-md:flex-1"
                    >
                        {step.optional && isStepEmpty(step.id, answers) ? 'Skip' : 'Continue'}
                        <ArrowRight className="size-4" />
                    </Button>
                )}
            </div>
        </div>
    );
}

function isStepEmpty(id: StepId, a: QuestionnaireAnswers): boolean {
    switch (id) {
        case 'business':
            return !a.businessName.trim() && !a.industry && !a.offering.trim() && !a.goalDetails.trim();
        case 'persona':
            return !a.agentName.trim() && !a.tone && a.voice === 'any';
        case 'collect':
            return a.collect.length === 0 && !a.mustAsk.trim();
        case 'details':
            return !a.knowledge.trim() && !a.neverDo.trim() && !a.length;
        default:
            return false;
    }
}

function ReviewStep({
    answers,
    brief,
    briefEdited,
    onBriefChange,
    onRegenerate,
    onEdit,
    onUseCaseChange,
}: {
    answers: QuestionnaireAnswers;
    brief: string;
    briefEdited: boolean;
    onBriefChange: (v: string) => void;
    onRegenerate: () => void;
    onEdit: (id: StepId) => void;
    onUseCaseChange: (v: string) => void;
}) {
    const goal = findGoal(answers.goal);
    const rows: { id: StepId; label: string; value: string }[] = [
        {
            id: 'direction',
            label: 'Call type',
            value: answers.callType === 'outbound' ? 'Agent calls people' : answers.callType === 'inbound' ? 'People call the agent' : '',
        },
        { id: 'goal', label: 'Job', value: goal?.label ?? resolveUseCase(answers) },
        { id: 'business', label: 'Business', value: [answers.businessName, answers.industry].filter(Boolean).join(' · ') },
        { id: 'audience', label: 'Languages', value: answers.languages.join(', ') },
        {
            id: 'persona',
            label: 'Persona',
            value: [answers.agentName, TONE_OPTIONS.find((t) => t.value === answers.tone)?.label].filter(Boolean).join(' · '),
        },
        { id: 'outcome', label: 'Outcome', value: OUTCOME_OPTIONS.find((o) => o.value === answers.outcome)?.label ?? '' },
    ];

    return (
        <>
            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
                {rows.map((row) => (
                    <li key={row.id} className="flex items-center gap-3 px-4 py-3 max-md:px-3.5">
                        <span className="w-24 shrink-0 text-xs text-muted-foreground">{row.label}</span>
                        <span className={cn('min-w-0 flex-1 truncate text-sm', !row.value && 'text-muted-foreground/60')}>
                            {row.value || 'Not set'}
                        </span>
                        <button
                            type="button"
                            onClick={() => onEdit(row.id)}
                            className="shrink-0 text-xs font-medium text-ai hover:underline"
                        >
                            Edit
                        </button>
                    </li>
                ))}
            </ul>

            {answers.goal === OTHER_GOAL && (
                <Field label="Agent use case" htmlFor="use-case">
                    <Input id="use-case" value={answers.goalOther} onChange={(e) => onUseCaseChange(e.target.value)} />
                </Field>
            )}

            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="agent-brief" className="text-sm font-medium">
                        Agent brief
                    </Label>
                    {briefEdited && (
                        <button
                            type="button"
                            onClick={onRegenerate}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                            <RotateCcw className="size-3" />
                            Rebuild from answers
                        </button>
                    )}
                </div>
                <div className="rounded-xl bg-gradient-to-br from-ai/40 via-ai/10 to-transparent p-px">
                    <Textarea
                        id="agent-brief"
                        value={brief}
                        onChange={(e) => onBriefChange(e.target.value)}
                        className="min-h-56 rounded-[11px] border-0 bg-card text-sm leading-relaxed"
                    />
                </div>
                <p className="text-xs text-muted-foreground">
                    You can change the prompts, voice and call flow in the editor after the agent is built.
                </p>
            </div>
        </>
    );
}
