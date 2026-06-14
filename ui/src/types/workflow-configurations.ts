import type { OrganizationAiModelConfigurationV2 } from "@/client/types.gen";

export interface AmbientNoiseConfiguration {
    enabled: boolean;
    volume: number;
    storage_key?: string;
    storage_backend?: string;
    original_filename?: string;
}

export type TurnStopStrategy = 'transcription' | 'turn_analyzer';

export interface VoicemailDetectionConfiguration {
    enabled: boolean;
    use_workflow_llm: boolean;
    provider?: string;
    model?: string;
    api_key?: string;
    system_prompt?: string;
    long_speech_timeout: number;  // seconds cutoff for long speech detection
}

export const DEFAULT_VOICEMAIL_DETECTION_CONFIGURATION: VoicemailDetectionConfiguration = {
    enabled: false,
    use_workflow_llm: true,
    long_speech_timeout: 8.0,
};

// "ecapa" = neural ECAPA-TDNN classifier (more accurate, default).
// "f0" = lightweight pitch-based classifier (no model, telephony-robust fallback).
export type VoiceGenderBackend = 'ecapa' | 'f0';

export interface VoiceGenderDetectionConfiguration {
    enabled: boolean;
    backend?: VoiceGenderBackend;
}

// Detection runs by default on the backend (VOICE_GENDER_DETECTION_ENABLED) with
// the neural "ecapa" classifier, so the UI treats an absent config as enabled/ecapa.
export const DEFAULT_VOICE_GENDER_DETECTION_CONFIGURATION: VoiceGenderDetectionConfiguration = {
    enabled: true,
    backend: 'ecapa',
};

// Pins the agent to a single spoken language. The directive is injected at the
// top of every node's system prompt so all prompts and behaviors are conducted
// in this language. Unset leaves existing (prompt-driven) behavior unchanged.
export type AgentLanguage = 'english' | 'arabic' | 'hebrew';

export const AGENT_LANGUAGE_OPTIONS: { value: AgentLanguage; label: string }[] = [
    { value: 'english', label: 'English' },
    { value: 'arabic', label: 'Arabic (العربية)' },
    { value: 'hebrew', label: 'Hebrew (עברית)' },
];

export interface ModelOverrides {
    llm?: {
        provider?: string;
        model?: string;
        api_key?: string;
        [key: string]: unknown;
    };
    tts?: {
        provider?: string;
        model?: string;
        voice?: string;
        api_key?: string;
        [key: string]: unknown;
    };
    stt?: {
        provider?: string;
        model?: string;
        api_key?: string;
        [key: string]: unknown;
    };
    realtime?: {
        provider?: string;
        model?: string;
        voice?: string;
        api_key?: string;
        [key: string]: unknown;
    };
    is_realtime?: boolean;
}

export interface WorkflowConfigurations {
    ambient_noise_configuration: AmbientNoiseConfiguration;
    max_call_duration: number;  // Maximum call duration in seconds
    max_user_idle_timeout: number;  // Maximum user idle time in seconds
    smart_turn_stop_secs: number;  // Timeout in seconds for incomplete turn detection
    turn_stop_strategy: TurnStopStrategy;  // Strategy for detecting end of user turn
    dictionary?: string;  // Comma-separated words for voice agent to listen for
    voicemail_detection?: VoicemailDetectionConfiguration;
    voice_gender_detection?: VoiceGenderDetectionConfiguration;  // Estimate caller gender from voice pitch for gendered-language adaptation
    behaviors?: string[];  // tool_uuids of Behavior tools enabled globally for the whole agent
    language?: AgentLanguage;  // Pin all prompts/behaviors to a single spoken language (Arabic, Hebrew, English)
    context_compaction_enabled?: boolean;  // Summarize context on node transitions to remove stale tool calls
    model_overrides?: ModelOverrides;  // Per-workflow model configuration overrides
    model_configuration_v2_override?: OrganizationAiModelConfigurationV2;  // Full v2 model configuration override
    [key: string]: unknown;  // Allow additional properties for future configurations
}

export const DEFAULT_WORKFLOW_CONFIGURATIONS: WorkflowConfigurations = {
    ambient_noise_configuration: {
        enabled: false,
        volume: 0.3
    },
    max_call_duration: 600,  // 10 minutes
    max_user_idle_timeout: 10,  // 10 seconds
    smart_turn_stop_secs: 2,  // 2 seconds
    turn_stop_strategy: 'transcription',  // Default to transcription-based detection
    dictionary: ''
};
