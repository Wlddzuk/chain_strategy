import type { TradeAlertEvent } from './trade-alert-events';

export const TRADE_ALERT_AUDIO_TEST_EVENT = 'chain-trader:alert-audio-test';
export const VOICE_ALERT_TEST_PHRASE = 'This is a test. Entry hit. Long Bitcoin.';

export type AlertSoundGroup = 'INFO' | 'HEADS_UP' | 'ACTION_OUTCOME';
export type AlertEarcon =
    | 'INFO_TICK'
    | 'HEADS_UP'
    | 'ENTRY_HIT'
    | 'INVALIDATED'
    | 'TARGET_HIT'
    | 'STOP_HIT';

export interface AlertAudioTestOverrides {
    volume?: number;
    voiceEnabled?: boolean;
    alertsEnabled?: boolean;
    soundEnabled?: boolean;
    preferredVoiceUri?: string;
}

export type AlertAudioTestRequest = AlertAudioTestOverrides & (
    | { mode: 'SOUND'; group: AlertSoundGroup }
    | { mode: 'VOICE' }
);

export interface AlertAudioSettings {
    infoSoundsEnabled: boolean;
    headsUpSoundsEnabled: boolean;
    actionOutcomeSoundsEnabled: boolean;
    soundVolume: number;
}

interface EarconNote {
    frequency: number;
    startsAt: number;
    duration: number;
    gain: number;
    type: OscillatorType;
}

export interface EarconPattern {
    notes: readonly EarconNote[];
}

const EARCON_PATTERNS: Record<AlertEarcon, EarconPattern> = {
    INFO_TICK: {
        notes: [
            { frequency: 880, startsAt: 0, duration: 0.055, gain: 0.025, type: 'sine' },
        ],
    },
    HEADS_UP: {
        notes: [
            { frequency: 587, startsAt: 0, duration: 0.09, gain: 0.04, type: 'sine' },
            { frequency: 880, startsAt: 0.105, duration: 0.11, gain: 0.045, type: 'sine' },
        ],
    },
    ENTRY_HIT: {
        notes: [
            { frequency: 659, startsAt: 0, duration: 0.085, gain: 0.055, type: 'triangle' },
            { frequency: 784, startsAt: 0.09, duration: 0.085, gain: 0.06, type: 'triangle' },
            { frequency: 988, startsAt: 0.18, duration: 0.11, gain: 0.065, type: 'triangle' },
        ],
    },
    INVALIDATED: {
        notes: [
            { frequency: 880, startsAt: 0, duration: 0.085, gain: 0.06, type: 'triangle' },
            { frequency: 659, startsAt: 0.09, duration: 0.085, gain: 0.06, type: 'triangle' },
            { frequency: 440, startsAt: 0.18, duration: 0.12, gain: 0.065, type: 'triangle' },
        ],
    },
    TARGET_HIT: {
        notes: [
            { frequency: 523, startsAt: 0, duration: 0.1, gain: 0.045, type: 'sine' },
            { frequency: 659, startsAt: 0.085, duration: 0.11, gain: 0.05, type: 'sine' },
            { frequency: 784, startsAt: 0.17, duration: 0.14, gain: 0.055, type: 'sine' },
        ],
    },
    STOP_HIT: {
        notes: [
            { frequency: 392, startsAt: 0, duration: 0.13, gain: 0.065, type: 'sawtooth' },
            { frequency: 294, startsAt: 0.14, duration: 0.17, gain: 0.06, type: 'sawtooth' },
        ],
    },
};

const SPOKEN_COIN_NAMES: Readonly<Record<string, string>> = {
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    SOL: 'Solana',
    DOGE: 'Doge',
    XRP: 'X R P',
    AVAX: 'Avax',
    LINK: 'Link',
    ARB: 'Arb',
};

const SPOKEN_TIMEFRAMES: Readonly<Record<TradeAlertEvent['timeframe'], string>> = {
    '5m': '5 minute',
    '15m': '15 minute',
    '1h': '1 hour',
    '4h': '4 hour',
};

export interface SpeechUtteranceLike {
    text: string;
    volume: number;
    rate: number;
    pitch: number;
    lang: string;
    voice: SpeechVoiceLike | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
}

export interface SpeechVoiceLike {
    default: boolean;
    lang: string;
    name: string;
    voiceURI: string;
}

export type SpeechVoiceOption = SpeechVoiceLike;

export interface SpeechDriver {
    createUtterance: (text: string) => SpeechUtteranceLike;
    speak: (utterance: SpeechUtteranceLike) => void;
    cancel: () => void;
    getVoices?: () => readonly SpeechVoiceLike[];
}

export interface SpeechRequest {
    text: string;
    urgent: boolean;
    volumePercent: number;
    preferredVoiceUri?: string;
}

export interface AlertAudioTestSpeechOptions {
    voiceEnabled: boolean;
    volumePercent: number;
    preferredVoiceUri?: string;
}

export interface SpeechQueue {
    enqueue: (request: SpeechRequest) => void;
    dispose: () => void;
    getState: () => { speaking: boolean; queued: boolean };
}

export interface SpeechVoiceSource {
    getVoices: () => readonly SpeechVoiceLike[];
    addEventListener: (
        type: 'voiceschanged',
        listener: EventListener,
        options?: AddEventListenerOptions
    ) => void;
    removeEventListener: (
        type: 'voiceschanged',
        listener: EventListener
    ) => void;
}

const PREFERRED_VOICE_NAMES = [
    'Samantha',
    'Google US English',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Microsoft Jenny Online (Natural) - English (United States)',
] as const;

const PREMIUM_VOICE_NAME_PATTERN = /\b(?:natural|premium|enhanced)\b/i;

function normalizeVoiceLanguage(language: string): string {
    return language.replace('_', '-').toLowerCase();
}

function isEnglishVoice(voice: SpeechVoiceLike): boolean {
    return /^en(?:-|$)/.test(normalizeVoiceLanguage(voice.lang));
}

function isUsEnglishVoice(voice: SpeechVoiceLike): boolean {
    return normalizeVoiceLanguage(voice.lang) === 'en-us';
}

export function selectPreferredSpeechVoice(
    voices: readonly SpeechVoiceLike[],
    preferredVoiceUri?: string
): SpeechVoiceLike | null {
    if (preferredVoiceUri) {
        const persistedVoice = voices.find(
            (voice) => voice.voiceURI === preferredVoiceUri
        );
        if (persistedVoice) return persistedVoice;
    }

    for (const preferredName of PREFERRED_VOICE_NAMES) {
        const namedVoice = voices.find(
            (voice) => voice.name === preferredName
        );
        if (namedVoice) return namedVoice;
    }

    const premiumUsVoice = voices.find(
        (voice) => (
            isUsEnglishVoice(voice) &&
            PREMIUM_VOICE_NAME_PATTERN.test(voice.name)
        )
    );
    if (premiumUsVoice) return premiumUsVoice;

    const usVoice = voices.find(isUsEnglishVoice);
    if (usVoice) return usVoice;

    return voices.find((voice) => voice.default) ?? null;
}

function getBrowserVoiceSource(): SpeechVoiceSource | null {
    if (
        typeof window === 'undefined' ||
        !('speechSynthesis' in window)
    ) return null;

    return window.speechSynthesis as unknown as SpeechVoiceSource;
}

export function getAvailableEnglishVoices(
    source: SpeechVoiceSource | null = getBrowserVoiceSource()
): SpeechVoiceOption[] {
    if (!source) return [];

    try {
        return toEnglishVoiceOptions(source.getVoices());
    } catch {
        return [];
    }
}

function toEnglishVoiceOptions(
    voices: readonly SpeechVoiceLike[]
): SpeechVoiceOption[] {
    const seen = new Set<string>();
    return voices
        .filter(isEnglishVoice)
        .filter((voice) => {
            if (seen.has(voice.voiceURI)) return false;
            seen.add(voice.voiceURI);
            return true;
        })
        .map(({ default: isDefault, lang, name, voiceURI }) => ({
            default: isDefault,
            lang,
            name,
            voiceURI,
        }));
}

export function subscribeToAvailableEnglishVoices(
    listener: (voices: SpeechVoiceOption[]) => void,
    source: SpeechVoiceSource | null = getBrowserVoiceSource()
): () => void {
    if (!source) {
        listener([]);
        return () => undefined;
    }

    let initialVoices: readonly SpeechVoiceLike[];
    try {
        initialVoices = source.getVoices();
    } catch {
        listener([]);
        return () => undefined;
    }
    listener(toEnglishVoiceOptions(initialVoices));
    if (initialVoices.length > 0) return () => undefined;

    let active = true;
    const handleVoicesChanged: EventListener = () => {
        if (!active) return;
        active = false;
        source.removeEventListener('voiceschanged', handleVoicesChanged);
        listener(getAvailableEnglishVoices(source));
    };

    try {
        source.addEventListener(
            'voiceschanged',
            handleVoicesChanged,
            { once: true }
        );
    } catch {
        return () => undefined;
    }

    return () => {
        if (!active) return;
        active = false;
        source.removeEventListener('voiceschanged', handleVoicesChanged);
    };
}

export function getEarconForAlert(event: TradeAlertEvent): AlertEarcon | null {
    switch (event.kind) {
        case 'NEW_SIGNAL':
        case 'BREAK_FORMING':
            return 'INFO_TICK';
        case 'APPROACHING_ENTRY':
            return 'HEADS_UP';
        case 'ENTRY_HIT':
            return 'ENTRY_HIT';
        case 'TARGET_HIT':
            return 'TARGET_HIT';
        case 'STOP_HIT':
            return 'STOP_HIT';
        case 'INVALIDATED':
            return event.urgent ? 'INVALIDATED' : null;
        case 'MISSED':
            return null;
    }
}

export function getSoundGroupForEarcon(earcon: AlertEarcon): AlertSoundGroup {
    if (earcon === 'INFO_TICK') return 'INFO';
    if (earcon === 'HEADS_UP') return 'HEADS_UP';
    return 'ACTION_OUTCOME';
}

export function isAlertEarconEnabled(
    event: TradeAlertEvent,
    settings: AlertAudioSettings
): boolean {
    const earcon = getEarconForAlert(event);
    if (!earcon) return false;

    const group = getSoundGroupForEarcon(earcon);
    if (group === 'INFO') return settings.infoSoundsEnabled;
    if (group === 'HEADS_UP') return settings.headsUpSoundsEnabled;
    return settings.actionOutcomeSoundsEnabled;
}

export function getEarconPattern(earcon: AlertEarcon): EarconPattern {
    return EARCON_PATTERNS[earcon];
}

export function getEarconDuration(earcon: AlertEarcon): number {
    return Math.max(
        ...EARCON_PATTERNS[earcon].notes.map((note) => note.startsAt + note.duration)
    );
}

export function normalizeSoundVolume(volumePercent: number): number {
    if (!Number.isFinite(volumePercent)) return 0.6;
    return Math.min(1, Math.max(0, volumePercent / 100));
}

export function playAlertEarcon(
    context: AudioContext,
    earcon: AlertEarcon,
    volumePercent: number
): void {
    const volume = normalizeSoundVolume(volumePercent);
    if (volume === 0) return;

    const start = context.currentTime;
    for (const note of EARCON_PATTERNS[earcon].notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const noteStart = start + note.startsAt;
        const noteEnd = noteStart + note.duration;
        const attackEnd = Math.min(noteEnd, noteStart + 0.012);

        oscillator.type = note.type;
        oscillator.frequency.setValueAtTime(note.frequency, noteStart);
        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(note.gain * volume, attackEnd);
        gain.gain.linearRampToValueAtTime(0, noteEnd);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteEnd + 0.01);
    }
}

export function getSpokenCoinName(coin: string): string {
    const ticker = coin.toUpperCase();
    return SPOKEN_COIN_NAMES[ticker] ?? ticker;
}

export function getAlertSpeechPhrase(event: TradeAlertEvent): string | null {
    const coin = getSpokenCoinName(event.coin);
    const direction = event.direction === 'LONG' ? 'Long' : 'Short';

    switch (event.kind) {
        case 'NEW_SIGNAL':
            return `New setup. ${direction} ${coin} ${SPOKEN_TIMEFRAMES[event.timeframe]}.`;
        case 'APPROACHING_ENTRY':
            return `Get ready. ${coin} is near entry.`;
        case 'ENTRY_HIT':
            return `Entry hit. ${direction} ${coin}.`;
        case 'TARGET_HIT':
            return `Target hit. ${coin}.`;
        case 'STOP_HIT':
            return `Stop hit. ${coin}.`;
        case 'INVALIDATED':
            return event.urgent ? `Setup dead. ${coin}. Cancel your order.` : null;
        case 'MISSED':
        case 'BREAK_FORMING':
            return null;
    }
}

export function isUrgentSpeechAlert(event: TradeAlertEvent): boolean {
    return event.kind === 'ENTRY_HIT' ||
        event.kind === 'STOP_HIT' ||
        (event.kind === 'INVALIDATED' && event.urgent);
}

export function createSpeechQueue(driver: SpeechDriver): SpeechQueue {
    let speaking = false;
    let queuedRequest: SpeechRequest | null = null;
    let activeToken = 0;

    const start = (request: SpeechRequest) => {
        speaking = true;
        activeToken += 1;
        const token = activeToken;
        const utterance = driver.createUtterance(request.text);
        utterance.volume = normalizeSoundVolume(request.volumePercent);
        utterance.rate = 1;
        utterance.pitch = 1;
        let resolvedVoice: SpeechVoiceLike | null = null;
        try {
            resolvedVoice = selectPreferredSpeechVoice(
                driver.getVoices?.() ?? [],
                request.preferredVoiceUri
            );
        } catch {
            // Fall back to the browser's default voice and language.
        }
        utterance.voice = resolvedVoice;
        utterance.lang = resolvedVoice ? resolvedVoice.lang : 'en-US';

        const finish = () => {
            if (token !== activeToken) return;
            speaking = false;
            const next = queuedRequest;
            queuedRequest = null;
            if (next) start(next);
        };
        utterance.onend = finish;
        utterance.onerror = finish;

        try {
            driver.speak(utterance);
        } catch {
            finish();
        }
    };

    return {
        enqueue: (request) => {
            if (request.urgent) {
                queuedRequest = null;
                activeToken += 1;
                speaking = false;
                driver.cancel();
                start(request);
                return;
            }

            if (!speaking) {
                start(request);
                return;
            }

            // Keep only the newest waiting announcement so speech never backlogs.
            queuedRequest = request;
        },
        dispose: () => {
            queuedRequest = null;
            activeToken += 1;
            speaking = false;
            driver.cancel();
        },
        getState: () => ({
            speaking,
            queued: queuedRequest !== null,
        }),
    };
}

export function createBrowserSpeechQueue(): SpeechQueue | null {
    if (
        typeof window === 'undefined' ||
        !('speechSynthesis' in window) ||
        typeof SpeechSynthesisUtterance === 'undefined'
    ) return null;

    const synthesis = window.speechSynthesis;
    const voiceSource = synthesis as unknown as SpeechVoiceSource;
    let availableVoices: readonly SpeechVoiceLike[] = [];
    try {
        availableVoices = voiceSource.getVoices();
    } catch {
        // The browser default remains usable if its voice catalog is unavailable.
    }
    const handleVoicesChanged: EventListener = () => {
        try {
            availableVoices = voiceSource.getVoices();
        } catch {
            // Keep the prior catalog and fall back to the browser default.
        }
    };
    let listeningForVoices = false;
    if (availableVoices.length === 0) {
        try {
            voiceSource.addEventListener(
                'voiceschanged',
                handleVoicesChanged,
                { once: true }
            );
            listeningForVoices = true;
        } catch {
            // Some speech engines expose getVoices without EventTarget methods.
        }
    }

    const queue = createSpeechQueue({
        createUtterance: (text) => (
            new SpeechSynthesisUtterance(text) as unknown as SpeechUtteranceLike
        ),
        speak: (utterance) => synthesis.speak(
            utterance as unknown as SpeechSynthesisUtterance
        ),
        cancel: () => synthesis.cancel(),
        getVoices: () => {
            try {
                const currentVoices = voiceSource.getVoices();
                if (currentVoices.length > 0) availableVoices = currentVoices;
            } catch {
                // Use the most recently known catalog.
            }
            return availableVoices;
        },
    });

    return {
        ...queue,
        dispose: () => {
            if (listeningForVoices) {
                voiceSource.removeEventListener('voiceschanged', handleVoicesChanged);
            }
            queue.dispose();
        },
    };
}

export function getAlertAudioTestSample(group: AlertSoundGroup): TradeAlertEvent {
    const kind = group === 'INFO'
        ? 'NEW_SIGNAL'
        : group === 'HEADS_UP'
            ? 'APPROACHING_ENTRY'
            : 'ENTRY_HIT';

    return {
        kind,
        coin: 'BTC',
        timeframe: '1h',
        direction: 'LONG',
        entryPrice: 64000,
        currentPrice: 64200,
        distanceToEntryPercent: -0.31,
        occurredAt: Date.now(),
        urgent: kind === 'ENTRY_HIT',
    };
}

export function getAlertAudioTestSpeechRequest(
    request: AlertAudioTestRequest,
    options: AlertAudioTestSpeechOptions
): SpeechRequest | null {
    if (request.mode !== 'VOICE' || !options.voiceEnabled) return null;

    return {
        text: VOICE_ALERT_TEST_PHRASE,
        urgent: true,
        volumePercent: options.volumePercent,
        preferredVoiceUri: options.preferredVoiceUri,
    };
}

export function requestTradeAlertAudioTest(
    group: AlertSoundGroup,
    overrides: AlertAudioTestOverrides = {}
): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<AlertAudioTestRequest>(TRADE_ALERT_AUDIO_TEST_EVENT, {
        detail: { mode: 'SOUND', group, ...overrides },
    }));
}

export function requestVoiceAlertTest(overrides: AlertAudioTestOverrides = {}): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<AlertAudioTestRequest>(TRADE_ALERT_AUDIO_TEST_EVENT, {
        detail: { mode: 'VOICE', ...overrides },
    }));
}
