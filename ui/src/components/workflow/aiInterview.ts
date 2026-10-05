import type { BuilderAnswer, BuilderQuestion } from '@/lib/agentCopilot';

/** One AI-written question and the user's answer to it. */
export interface InterviewEntry {
    question: BuilderQuestion;
    /** The answers this question was written from (see `answersKey`). */
    basis: string;
    /** The AI's estimate of questions left after this one. */
    remaining: number;
    /** Chosen option labels (single or multi choice). */
    selected: string[];
    /** The "something else" answer for a choice, or the answer to a text question. */
    custom: string;
}

export function newEntry(question: BuilderQuestion, basis: string, remaining: number): InterviewEntry {
    return { question, basis, remaining, selected: [], custom: '' };
}

/** The entry's answer as one line of text; '' when skipped. */
export function answerText(entry: InterviewEntry): string {
    const custom = entry.custom.trim();
    if (entry.question.kind === 'text') return custom;
    return [...entry.selected, custom].filter(Boolean).join(', ');
}

/** The questions and answers up to and including `index`. */
export function answersUpTo(entries: InterviewEntry[], index: number): BuilderAnswer[] {
    return entries.slice(0, index + 1).map((e) => ({ question: e.question.question, answer: answerText(e) }));
}

/** A stable key for a set of answers, to tell whether a later question still applies. */
export function answersKey(answers: BuilderAnswer[]): string {
    return JSON.stringify(answers.map((a) => [a.question, a.answer]));
}

/** Choose an option: replaces the choice for single, toggles it for multi. */
export function chooseOption(entry: InterviewEntry, label: string): InterviewEntry {
    if (entry.question.kind === 'single') {
        const selected = entry.selected[0] === label ? [] : [label];
        // Picking an option replaces a typed answer to a single choice.
        return { ...entry, selected, custom: selected.length ? '' : entry.custom };
    }
    const selected = entry.selected.includes(label)
        ? entry.selected.filter((l) => l !== label)
        : [...entry.selected, label];
    return { ...entry, selected };
}

/** Type a custom answer; for a single choice it replaces the chosen option. */
export function typeCustom(entry: InterviewEntry, value: string): InterviewEntry {
    if (entry.question.kind === 'single' && value.trim()) return { ...entry, custom: value, selected: [] };
    return { ...entry, custom: value };
}

/** Progress through the interview, 0..1, from questions answered and the AI's estimate of what's left. */
export function interviewProgress(answered: number, remaining: number): number {
    const total = answered + 1 + Math.max(0, remaining);
    return Math.min(1, answered / total);
}
