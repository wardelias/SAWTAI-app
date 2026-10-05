import { describe, expect, it } from 'vitest';

import type { BuilderQuestion } from '@/lib/agentCopilot';

import {
    answersKey,
    answersUpTo,
    answerText,
    chooseOption,
    interviewProgress,
    newEntry,
    typeCustom,
} from './aiInterview';

const question = (kind: BuilderQuestion['kind'], text = 'Which languages?'): BuilderQuestion => ({
    section: 'Languages',
    question: text,
    helper: '',
    kind,
    options:
        kind === 'text'
            ? []
            : [
                  { label: 'Arabic', hint: '' },
                  { label: 'Hebrew', hint: '' },
              ],
    allow_custom: true,
    placeholder: '',
});

describe('chooseOption', () => {
    it('keeps one choice for a single-choice question and clears a typed answer', () => {
        let entry = typeCustom(newEntry(question('single'), '', 2), 'Russian');
        entry = chooseOption(entry, 'Arabic');
        expect(entry.selected).toEqual(['Arabic']);
        expect(entry.custom).toBe('');

        entry = chooseOption(entry, 'Hebrew');
        expect(entry.selected).toEqual(['Hebrew']);
        // Tapping the chosen option again clears it.
        expect(chooseOption(entry, 'Hebrew').selected).toEqual([]);
    });

    it('toggles options for a multi-choice question', () => {
        let entry = newEntry(question('multi'), '', 2);
        entry = chooseOption(chooseOption(entry, 'Arabic'), 'Hebrew');
        expect(entry.selected).toEqual(['Arabic', 'Hebrew']);
        expect(chooseOption(entry, 'Arabic').selected).toEqual(['Hebrew']);
    });
});

describe('answerText', () => {
    it('joins chosen options with the custom answer', () => {
        let entry = chooseOption(newEntry(question('multi'), '', 0), 'Arabic');
        entry = typeCustom(entry, ' Russian ');
        expect(answerText(entry)).toBe('Arabic, Russian');
    });

    it('typing an answer to a single choice replaces the option', () => {
        const entry = typeCustom(chooseOption(newEntry(question('single'), '', 0), 'Arabic'), 'French');
        expect(answerText(entry)).toBe('French');
    });

    it('is empty for a skipped question', () => {
        expect(answerText(newEntry(question('text'), '', 0))).toBe('');
    });
});

describe('answersUpTo / answersKey', () => {
    it('collects answers up to an index and keys them by content', () => {
        const entries = [
            typeCustom(newEntry(question('text', 'Business name?'), '', 3), 'Haddad'),
            chooseOption(newEntry(question('single'), '', 2), 'Hebrew'),
            newEntry(question('text', 'Hours?'), '', 1),
        ];

        expect(answersUpTo(entries, 1)).toEqual([
            { question: 'Business name?', answer: 'Haddad' },
            { question: 'Which languages?', answer: 'Hebrew' },
        ]);
        expect(answersKey(answersUpTo(entries, 1))).toBe(answersKey(answersUpTo(entries, 1)));
        expect(answersKey(answersUpTo(entries, 0))).not.toBe(answersKey(answersUpTo(entries, 1)));
    });
});

describe('interviewProgress', () => {
    it('grows with answers and the estimate of what is left', () => {
        expect(interviewProgress(0, 5)).toBe(0);
        expect(interviewProgress(2, 1)).toBe(0.5);
        expect(interviewProgress(4, -3)).toBe(0.8);
    });
});
