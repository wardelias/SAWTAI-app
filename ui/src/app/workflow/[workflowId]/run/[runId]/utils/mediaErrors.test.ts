import { afterEach, describe, expect, it, vi } from 'vitest';

import { canCaptureAudio, describeMediaError, MEDIA_UNSUPPORTED_MESSAGE } from './mediaErrors';

const domError = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('describeMediaError', () => {
    it('explains a blocked microphone permission', () => {
        expect(describeMediaError(domError('NotAllowedError'))).toMatch(/blocked/);
    });

    it('explains a microphone held by another app', () => {
        expect(describeMediaError(domError('NotReadableError'))).toMatch(/another app/);
    });

    it('explains a missing microphone', () => {
        expect(describeMediaError(domError('NotFoundError'))).toMatch(/No microphone/);
    });

    it('treats a TypeError as an unsupported browser', () => {
        expect(describeMediaError(new TypeError('undefined is not an object'))).toBe(MEDIA_UNSUPPORTED_MESSAGE);
    });

    it('keeps the browser message for unknown errors', () => {
        expect(describeMediaError(domError('WeirdError', 'boom'))).toBe('Could not access the microphone: boom');
        expect(describeMediaError(null)).toBe('Could not access the microphone.');
    });
});

describe('canCaptureAudio', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('is false when the browser exposes no mediaDevices', () => {
        vi.stubGlobal('navigator', {});
        expect(canCaptureAudio()).toBe(false);
    });

    it('is true when getUserMedia is available', () => {
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => undefined } });
        expect(canCaptureAudio()).toBe(true);
    });
});
