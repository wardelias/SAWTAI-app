// Readable explanations for the ways a browser test call fails before or while
// connecting. Phones hit these far more often than desktops (in-app browsers
// without microphone access, mics held by another app, carrier NATs).

/** True when this browser can capture audio at all (secure context + API present). */
export function canCaptureAudio(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function'
    );
}

export const MEDIA_UNSUPPORTED_MESSAGE =
    "This browser can't use your microphone. If you opened this link inside another app " +
    "(WhatsApp, Instagram, Gmail…), open it in Safari or Chrome instead, and make sure the address starts with https://.";

export function describeMediaError(error: unknown): string {
    const name = (error as { name?: unknown } | null)?.name;
    switch (name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
        case 'SecurityError':
            return 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then tap Retry Call.';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return 'No microphone was found on this device.';
        case 'NotReadableError':
        case 'TrackStartError':
        case 'AbortError':
            return 'Your microphone is being used by another app (a phone call, voice note or another tab). Close it and tap Retry Call.';
        case 'OverconstrainedError':
            return 'The selected microphone is not available. Pick another microphone and try again.';
        case 'TypeError':
            return MEDIA_UNSUPPORTED_MESSAGE;
        default: {
            const message = (error as { message?: unknown } | null)?.message;
            return typeof message === 'string' && message
                ? `Could not access the microphone: ${message}`
                : 'Could not access the microphone.';
        }
    }
}

export const ICE_FAILED_MESSAGE =
    "Couldn't open an audio connection to the agent. Mobile data networks often block direct audio — " +
    'try again on Wi-Fi, or ask your admin to configure a TURN server for browser calls.';
