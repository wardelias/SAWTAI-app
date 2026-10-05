'use client';

import { AlertCircle, ArrowLeft, ArrowRight, Flag, ListChecks, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BUILDER_MAX_QUESTIONS, fetchNextBuilderQuestion } from '@/lib/agentCopilot';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

import type { AgentCallType } from './agentIdeas';
import type { AgentQuestionnaireResult } from './AgentQuestionnaire';
import {
    answersKey,
    answersUpTo,
    answerText,
    chooseOption,
    type InterviewEntry,
    interviewProgress,
    newEntry,
    typeCustom,
} from './aiInterview';
import { OptionCard } from './questionnaireControls';

interface AIInterviewProps {
    callType: AgentCallType;
    useCase: string;
    /** What the user already wrote about the agent, if anything. */
    description: string;
    /** Questions asked before the interview (call direction and job), for numbering. */
    questionOffset: number;
    /** Back from the first AI question. */
    onBack: () => void;
    /** Switch to the standard (non-AI) questions. */
    onUseStandard: () => void;
    onSubmit: (result: AgentQuestionnaireResult) => void;
    isSubmitting: boolean;
    submitError: string | null;
}

/**
 * The AI half of the agent-builder interview: each question is written by
 * the AI Assistant from the answers so far, then it writes the agent brief.
 */
export function AIInterview({
    callType,
    useCase,
    description,
    questionOffset,
    onBack,
    onUseStandard,
    onSubmit,
    isSubmitting,
    submitError,
}: AIInterviewProps) {
    const { getAccessToken } = useAuth();
    const [entries, setEntries] = useState<InterviewEntry[]>([]);
    // entries.length (with `brief` set) means the review screen.
    const [index, setIndex] = useState(0);
    const [brief, setBrief] = useState<string | null>(null);
    const [briefBasis, setBriefBasis] = useState('');
    const [loading, setLoading] = useState(false);
    // The pending request writes the brief rather than a question.
    const [finishing, setFinishing] = useState(false);
    const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
    const requestId = useRef(0);
    const topRef = useRef<HTMLDivElement>(null);

    const isReview = brief !== null && index === entries.length;
    const entry = isReview ? null : entries[index];

    // Ask for the step after `upTo` (-1 for the first question).
    const advance = useCallback(
        async (current: InterviewEntry[], upTo: number, finish = false) => {
            const answers = upTo >= 0 ? answersUpTo(current, upTo) : [];
            const basis = answersKey(answers);
            const kept = current.slice(0, upTo + 1);
            const id = ++requestId.current;
            setEntries(kept);
            setIndex(kept.length);
            setBrief(null);
            setLoading(true);
            setFinishing(finish || kept.length >= BUILDER_MAX_QUESTIONS);
            setError(null);
            topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            try {
                const step = await fetchNextBuilderQuestion(await getAccessToken(), {
                    call_type: callType,
                    use_case: useCase,
                    description,
                    answers,
                    finish,
                });
                if (id !== requestId.current) return;
                if (step.done || !step.question) {
                    setBrief(step.brief);
                    setBriefBasis(basis);
                } else {
                    setEntries([...kept, newEntry(step.question, basis, step.remaining)]);
                }
            } catch (e) {
                if (id !== requestId.current) return;
                setError({
                    message: e instanceof Error ? e.message : 'The AI Assistant could not write the next question.',
                    retry: () => void advance(current, upTo, finish),
                });
            } finally {
                if (id === requestId.current) setLoading(false);
            }
        },
        [callType, useCase, description, getAccessToken],
    );

    const started = useRef(false);
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        void advance([], -1);
    }, [advance]);

    const goTo = (i: number) => {
        setIndex(i);
        topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    const next = () => {
        const basis = answersKey(answersUpTo(entries, index));
        const following = entries[index + 1];
        // Reuse what was already written when the answers it came from haven't changed.
        if (following && following.basis === basis) return goTo(index + 1);
        if (!following && brief !== null && briefBasis === basis) return goTo(entries.length);
        void advance(entries, index);
    };

    const back = () => {
        if (index === 0) return onBack();
        goTo(index - 1);
    };

    const updateEntry = (update: (e: InterviewEntry) => InterviewEntry) =>
        setEntries((prev) => prev.map((e, i) => (i === index ? update(e) : e)));

    const answered = entry ? answerText(entry) !== '' : false;
    // While the next question loads, the last estimate (less the question on its way) stands in.
    const lastEstimate = entries[entries.length - 1]?.remaining;
    const remaining = entry?.remaining ?? (lastEstimate !== undefined ? Math.max(0, lastEstimate - 1) : 5);
    const progress = isReview ? 1 : interviewProgress(questionOffset + index, remaining);

    return (
        <div ref={topRef} className="scroll-mt-20">
            {/* Progress */}
            <div className="mb-6 max-md:mb-5">
                <div className="mb-2.5 flex items-center justify-between gap-3 text-xs font-medium">
                    <span className="inline-flex items-center gap-1.5 text-ai">
                        <Sparkles className="size-3.5" />
                        {isReview
                            ? 'Ready to build'
                            : `Question ${questionOffset + index + 1}${!loading && remaining > 0 ? ` · about ${remaining} more` : ''}`}
                    </span>
                    {!isReview && entries.length > 0 && (
                        <button
                            type="button"
                            disabled={loading}
                            onClick={() => void advance(entries, index, true)}
                            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                        >
                            <Flag className="size-3.5" />
                            Finish now
                        </button>
                    )}
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                        className="h-full rounded-full bg-ai transition-[width] duration-500"
                        style={{ width: `${Math.max(4, progress * 100)}%` }}
                    />
                </div>
            </div>

            {error ? (
                <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/[0.06] p-5">
                    <p className="flex items-start gap-2 text-sm font-medium">
                        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        {error.message}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 max-md:flex-col">
                        <Button type="button" onClick={error.retry} className="gap-1.5">
                            <RotateCcw className="size-4" />
                            Try again
                        </Button>
                        <Button type="button" variant="outline" onClick={onUseStandard} className="gap-1.5">
                            <ListChecks className="size-4" />
                            Use standard questions
                        </Button>
                    </div>
                </div>
            ) : loading || (!entry && !isReview) ? (
                <ThinkingCard first={entries.length === 0} finishing={finishing} />
            ) : isReview ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Review</p>
                    <h2 className="text-2xl font-semibold tracking-tight max-md:text-xl">Here is the brief for your agent</h2>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                        The AI wrote this from your answers. Edit anything before building.
                    </p>
                    <div className="mt-6 space-y-6 max-md:mt-5 max-md:space-y-5">
                        {entries.length > 0 && (
                            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
                                {entries.map((e, i) => {
                                    const answer = answerText(e);
                                    return (
                                        <li key={i} className="flex items-start gap-3 px-4 py-3 max-md:px-3.5">
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-xs text-muted-foreground">{e.question.question}</span>
                                                <span className={cn('mt-0.5 block text-sm', !answer && 'text-muted-foreground/60')}>
                                                    {answer || 'Skipped'}
                                                </span>
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => goTo(i)}
                                                className="shrink-0 pt-0.5 text-xs font-medium text-ai hover:underline"
                                            >
                                                Edit
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="ai-agent-brief" className="text-sm font-medium">
                                Agent brief
                            </Label>
                            <div className="rounded-xl bg-gradient-to-br from-ai/40 via-ai/10 to-transparent p-px">
                                <Textarea
                                    id="ai-agent-brief"
                                    value={brief ?? ''}
                                    onChange={(e) => setBrief(e.target.value)}
                                    className="min-h-64 rounded-[11px] border-0 bg-card text-sm leading-relaxed"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                You can change the prompts, voice and call flow in the editor after the agent is built.
                            </p>
                        </div>
                    </div>
                </div>
            ) : entry ? (
                <QuestionView
                    key={index}
                    entry={entry}
                    onChoose={(label) => updateEntry((e) => chooseOption(e, label))}
                    onType={(value) => updateEntry((e) => typeCustom(e, value))}
                    onSubmit={next}
                />
            ) : null}

            {submitError && <p className="mt-5 text-sm text-destructive">{submitError}</p>}

            {/* Navigation */}
            {!error && (
                <div className="mt-8 flex items-center gap-3 border-t border-border/60 pt-5 max-md:mt-6">
                    <Button type="button" variant="ghost" onClick={back} disabled={isSubmitting} className="gap-1.5">
                        <ArrowLeft className="size-4" />
                        Back
                    </Button>
                    <div className="flex-1" />
                    {isReview ? (
                        <Button
                            type="button"
                            onClick={() => onSubmit({ callType, useCase, description: (brief ?? '').trim() })}
                            disabled={isSubmitting || !brief?.trim()}
                            className="h-11 gap-2 rounded-xl bg-ai px-6 text-ai-foreground hover:bg-ai/90 max-md:flex-1"
                        >
                            <Wand2 className="size-4" />
                            {isSubmitting ? 'Building…' : 'Build my agent'}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            onClick={next}
                            disabled={loading || !entry}
                            className="h-11 gap-1.5 rounded-xl bg-ai px-6 text-ai-foreground hover:bg-ai/90 max-md:flex-1"
                        >
                            {answered ? 'Continue' : 'Skip'}
                            <ArrowRight className="size-4" />
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

function QuestionView({
    entry,
    onChoose,
    onType,
    onSubmit,
}: {
    entry: InterviewEntry;
    onChoose: (label: string) => void;
    onType: (value: string) => void;
    onSubmit: () => void;
}) {
    const { question } = entry;
    const isText = question.kind === 'text';
    const multiple = question.kind === 'multi';
    // Long answers (wording, FAQs) get a text area; short ones a single line.
    const longText = isText && (question.placeholder.length > 60 || question.placeholder.includes('\n'));

    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {question.section || 'Question'}
                <span className="inline-flex items-center gap-1 rounded-full bg-ai/12 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-ai">
                    <Sparkles className="size-2.5" />
                    AI
                </span>
            </p>
            <h2 className="text-2xl font-semibold tracking-tight max-md:text-xl">{question.question}</h2>
            {question.helper && <p className="mt-1.5 text-sm text-muted-foreground">{question.helper}</p>}

            <div className="mt-6 space-y-3 max-md:mt-5">
                {!isText && (
                    <div
                        role={multiple ? 'group' : 'radiogroup'}
                        aria-label={question.question}
                        className="grid gap-2.5 sm:grid-cols-2"
                    >
                        {question.options.map((o) => (
                            <OptionCard
                                key={o.label}
                                option={{ value: o.label, label: o.label, hint: o.hint }}
                                compact
                                multiple={multiple}
                                selected={entry.selected.includes(o.label)}
                                onSelect={() => onChoose(o.label)}
                            />
                        ))}
                    </div>
                )}
                {multiple && <p className="text-xs text-muted-foreground">Pick all that apply.</p>}

                {(isText || question.allow_custom) &&
                    (longText ? (
                        <Textarea
                            autoFocus
                            aria-label={question.question}
                            value={entry.custom}
                            placeholder={question.placeholder}
                            onChange={(e) => onType(e.target.value)}
                            className="min-h-28"
                        />
                    ) : (
                        <Input
                            autoFocus={isText}
                            aria-label={isText ? question.question : 'Your own answer'}
                            value={entry.custom}
                            placeholder={isText ? question.placeholder : multiple ? 'Add your own…' : 'Something else…'}
                            onChange={(e) => onType(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onSubmit();
                                }
                            }}
                        />
                    ))}
            </div>
        </div>
    );
}

function ThinkingCard({ first, finishing }: { first: boolean; finishing: boolean }) {
    return (
        <div role="status" aria-live="polite" className="animate-in fade-in duration-300">
            <div className="flex items-center gap-2 text-sm font-medium text-ai">
                <span className="relative flex size-7 items-center justify-center rounded-lg bg-ai/12">
                    <Sparkles className="size-4 animate-pulse" />
                </span>
                {first
                    ? 'Preparing questions for your business'
                    : finishing
                      ? 'Writing your agent brief'
                      : 'Thinking about your answer'}
                <span className="ai-typing ml-0.5 inline-flex items-center gap-1" aria-hidden>
                    <span />
                    <span />
                    <span />
                </span>
            </div>
            <div className="mt-5 space-y-3" aria-hidden>
                <div className="h-7 w-4/5 animate-pulse rounded-lg bg-muted" />
                <div className="h-4 w-3/5 animate-pulse rounded bg-muted/70" />
                <div className="grid gap-2.5 pt-3 sm:grid-cols-2">
                    {[0, 1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="h-14 animate-pulse rounded-xl border border-border/50 bg-muted/40"
                            style={{ animationDelay: `${i * 120}ms` }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
