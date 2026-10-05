import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BuilderQuestion, BuilderStep } from '@/lib/agentCopilot';

const { nextQuestionMock } = vi.hoisted(() => ({ nextQuestionMock: vi.fn() }));

vi.mock('@/lib/agentCopilot', () => ({
    BUILDER_MAX_QUESTIONS: 10,
    fetchNextBuilderQuestion: nextQuestionMock,
}));

vi.mock('@/lib/auth', () => ({
    useAuth: () => ({ getAccessToken: async () => 'token' }),
}));

import { AIInterview } from './AIInterview';

const languages: BuilderQuestion = {
    section: 'Languages',
    question: 'Which languages do callers speak?',
    helper: 'Include the dialect.',
    kind: 'single',
    options: [
        { label: 'Arabic (Levantine)', hint: '' },
        { label: 'Hebrew', hint: 'Most callers' },
    ],
    allow_custom: true,
    placeholder: '',
};
const hours: BuilderQuestion = {
    section: 'Opening hours',
    question: 'When is the office open?',
    helper: '',
    kind: 'text',
    options: [],
    allow_custom: false,
    placeholder: 'Sun–Thu 9:00–18:00',
};

const ask = (question: BuilderQuestion, remaining = 3): BuilderStep => ({ done: false, question, remaining, brief: '' });
const finished = (brief: string): BuilderStep => ({ done: true, question: null, remaining: 0, brief });

function renderInterview(overrides: Partial<React.ComponentProps<typeof AIInterview>> = {}) {
    const props = {
        callType: 'outbound' as const,
        useCase: 'Lead qualification',
        description: 'Book viewings.',
        questionOffset: 2,
        onBack: vi.fn(),
        onUseStandard: vi.fn(),
        onSubmit: vi.fn(),
        isSubmitting: false,
        submitError: null,
        ...overrides,
    };
    render(<AIInterview {...props} />);
    return props;
}

const sentAnswers = (call: number) => nextQuestionMock.mock.calls[call][1].answers;

describe('AIInterview', () => {
    beforeEach(() => {
        nextQuestionMock.mockReset();
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('asks AI-written questions, sends each answer, and builds from the brief', async () => {
        nextQuestionMock
            .mockResolvedValueOnce(ask(languages))
            .mockResolvedValueOnce(ask(hours, 0))
            .mockResolvedValueOnce(finished('Speak Hebrew. Open Sun–Thu.'));
        const props = renderInterview();

        expect(await screen.findByText('Which languages do callers speak?')).toBeTruthy();
        expect(nextQuestionMock).toHaveBeenCalledWith('token', {
            call_type: 'outbound',
            use_case: 'Lead qualification',
            description: 'Book viewings.',
            answers: [],
            finish: false,
        });
        expect(screen.getByText(/Question 3 · about 3 more/)).toBeTruthy();

        fireEvent.click(screen.getByRole('radio', { name: /Hebrew/ }));
        fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

        expect(await screen.findByText('When is the office open?')).toBeTruthy();
        expect(sentAnswers(1)).toEqual([{ question: 'Which languages do callers speak?', answer: 'Hebrew' }]);

        fireEvent.change(screen.getByRole('textbox', { name: 'When is the office open?' }), {
            target: { value: 'Sun–Thu' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

        const brief = await screen.findByLabelText('Agent brief');
        expect((brief as HTMLTextAreaElement).value).toBe('Speak Hebrew. Open Sun–Thu.');
        // The answers are listed for review.
        expect(screen.getByText('Sun–Thu')).toBeTruthy();

        fireEvent.change(brief, { target: { value: 'Speak Hebrew only.' } });
        fireEvent.click(screen.getByRole('button', { name: /Build my agent/ }));
        expect(props.onSubmit).toHaveBeenCalledWith({
            callType: 'outbound',
            useCase: 'Lead qualification',
            description: 'Speak Hebrew only.',
        });
    });

    it('reuses the next question when an earlier answer is unchanged, and re-asks when it changes', async () => {
        nextQuestionMock.mockResolvedValueOnce(ask(languages)).mockResolvedValueOnce(ask(hours));
        renderInterview();

        fireEvent.click(await screen.findByRole('radio', { name: /Hebrew/ }));
        fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
        await screen.findByText('When is the office open?');

        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        fireEvent.click(await screen.findByRole('button', { name: /Continue/ }));
        expect(await screen.findByText('When is the office open?')).toBeTruthy();
        expect(nextQuestionMock).toHaveBeenCalledTimes(2);

        nextQuestionMock.mockResolvedValueOnce(ask(hours));
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        fireEvent.click(await screen.findByRole('radio', { name: /Arabic/ }));
        fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
        await waitFor(() => expect(nextQuestionMock).toHaveBeenCalledTimes(3));
        expect(sentAnswers(2)).toEqual([{ question: 'Which languages do callers speak?', answer: 'Arabic (Levantine)' }]);
    });

    it('leaves the first AI question for the previous screen', async () => {
        nextQuestionMock.mockResolvedValueOnce(ask(languages));
        const props = renderInterview();
        await screen.findByText('Which languages do callers speak?');

        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(props.onBack).toHaveBeenCalled();
    });

    it('can finish early with the answers so far', async () => {
        nextQuestionMock.mockResolvedValueOnce(ask(languages)).mockResolvedValueOnce(finished('Brief.'));
        renderInterview();

        fireEvent.click(await screen.findByRole('radio', { name: /Hebrew/ }));
        fireEvent.click(screen.getByRole('button', { name: /Finish now/ }));

        expect(await screen.findByLabelText('Agent brief')).toBeTruthy();
        expect(nextQuestionMock.mock.calls[1][1]).toMatchObject({
            finish: true,
            answers: [{ question: 'Which languages do callers speak?', answer: 'Hebrew' }],
        });
    });

    it('offers a retry or the standard questions when the AI fails', async () => {
        nextQuestionMock
            .mockRejectedValueOnce(new Error("Your organization has reached today's AI Assistant limit."))
            .mockResolvedValueOnce(ask(languages));
        const props = renderInterview();

        expect(await screen.findByText(/reached today's AI Assistant limit/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Use standard questions/ }));
        expect(props.onUseStandard).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
        expect(await screen.findByText('Which languages do callers speak?')).toBeTruthy();
    });
});
