import { describe, expect, it } from 'vitest';
import type { TradeAlertEvent, TradeAlertKind } from './trade-alert-events';
import {
    VOICE_ALERT_TEST_PHRASE,
    createSpeechQueue,
    getAvailableEnglishVoices,
    getAlertSpeechPhrase,
    getAlertAudioTestSpeechRequest,
    getEarconDuration,
    getEarconForAlert,
    getEarconPattern,
    getSpokenCoinName,
    isAlertEarconEnabled,
    isUrgentSpeechAlert,
    normalizeSoundVolume,
    selectPreferredSpeechVoice,
    subscribeToAvailableEnglishVoices,
    type AlertAudioSettings,
    type AlertEarcon,
    type SpeechDriver,
    type SpeechUtteranceLike,
    type SpeechVoiceLike,
    type SpeechVoiceSource,
} from './trade-alert-audio';

function alertEvent(
    kind: TradeAlertKind,
    overrides: Partial<TradeAlertEvent> = {}
): TradeAlertEvent {
    return {
        kind,
        signalId: 'btc-1h-long',
        coin: 'BTC',
        timeframe: '1h',
        direction: 'LONG',
        entryPrice: 64_000,
        currentPrice: 64_200,
        distanceToEntryPercent: -0.31,
        occurredAt: 1_000,
        urgent: false,
        ...overrides,
    };
}

const enabledAudioSettings: AlertAudioSettings = {
    infoSoundsEnabled: true,
    headsUpSoundsEnabled: true,
    actionOutcomeSoundsEnabled: true,
    soundVolume: 60,
};

class FakeSpeechDriver implements SpeechDriver {
    readonly spoken: SpeechUtteranceLike[] = [];
    cancelCalls = 0;

    constructor(private readonly voices: readonly SpeechVoiceLike[] = []) {}

    createUtterance(text: string): SpeechUtteranceLike {
        return {
            text,
            volume: 1,
            rate: 1,
            pitch: 1,
            lang: '',
            voice: null,
            onend: null,
            onerror: null,
        };
    }

    speak(utterance: SpeechUtteranceLike): void {
        this.spoken.push(utterance);
    }

    cancel(): void {
        this.cancelCalls += 1;
    }

    getVoices(): readonly SpeechVoiceLike[] {
        return this.voices;
    }
}

function voice(
    name: string,
    lang = 'en-US',
    voiceURI = name,
    isDefault = false
): SpeechVoiceLike {
    return {
        default: isDefault,
        lang,
        name,
        voiceURI,
    };
}

class FakeVoiceSource implements SpeechVoiceSource {
    listener: EventListener | null = null;
    addCalls = 0;
    removeCalls = 0;
    options: AddEventListenerOptions | undefined;

    constructor(public voices: readonly SpeechVoiceLike[]) {}

    getVoices(): readonly SpeechVoiceLike[] {
        return this.voices;
    }

    addEventListener(
        _type: 'voiceschanged',
        listener: EventListener,
        options?: AddEventListenerOptions
    ): void {
        this.addCalls += 1;
        this.listener = listener;
        this.options = options;
    }

    removeEventListener(
        _type: 'voiceschanged',
        listener: EventListener
    ): void {
        this.removeCalls += 1;
        if (this.listener === listener) this.listener = null;
    }

    emitVoicesChanged(): void {
        this.listener?.({} as Event);
    }
}

describe('trade alert earcons', () => {
    it.each([
        ['NEW_SIGNAL', false, 'INFO_TICK'],
        ['BREAK_FORMING', false, 'INFO_TICK'],
        ['APPROACHING_ENTRY', false, 'HEADS_UP'],
        ['ENTRY_HIT', true, 'ENTRY_HIT'],
        ['TARGET_HIT', false, 'TARGET_HIT'],
        ['STOP_HIT', true, 'STOP_HIT'],
        ['INVALIDATED', true, 'INVALIDATED'],
        ['INVALIDATED', false, null],
        ['MISSED', false, null],
    ] as const)('maps %s (urgent=%s) to %s', (kind, urgent, expected) => {
        expect(getEarconForAlert(alertEvent(kind, { urgent }))).toBe(expected);
    });

    it('keeps every distinct earcon under half a second', () => {
        const earcons: AlertEarcon[] = [
            'INFO_TICK',
            'HEADS_UP',
            'ENTRY_HIT',
            'INVALIDATED',
            'TARGET_HIT',
            'STOP_HIT',
        ];

        for (const earcon of earcons) {
            expect(getEarconDuration(earcon)).toBeLessThanOrEqual(0.5);
        }

        const signatures = earcons.map((earcon) => (
            getEarconPattern(earcon).notes
                .map((note) => `${note.frequency}:${note.startsAt}:${note.duration}`)
                .join('|')
        ));
        expect(new Set(signatures).size).toBe(earcons.length);
    });

    it('gates each category with its own settings toggle', () => {
        expect(isAlertEarconEnabled(
            alertEvent('NEW_SIGNAL'),
            { ...enabledAudioSettings, infoSoundsEnabled: false }
        )).toBe(false);
        expect(isAlertEarconEnabled(
            alertEvent('APPROACHING_ENTRY'),
            { ...enabledAudioSettings, headsUpSoundsEnabled: false }
        )).toBe(false);
        expect(isAlertEarconEnabled(
            alertEvent('ENTRY_HIT', { urgent: true }),
            { ...enabledAudioSettings, actionOutcomeSoundsEnabled: false }
        )).toBe(false);
        expect(isAlertEarconEnabled(
            alertEvent('MISSED'),
            enabledAudioSettings
        )).toBe(false);
    });

    it('normalizes the shared volume slider safely', () => {
        expect(normalizeSoundVolume(0)).toBe(0);
        expect(normalizeSoundVolume(60)).toBe(0.6);
        expect(normalizeSoundVolume(150)).toBe(1);
        expect(normalizeSoundVolume(-10)).toBe(0);
        expect(normalizeSoundVolume(Number.NaN)).toBe(0.6);
    });
});

describe('trade alert speech', () => {
    it('uses the exact selected-voice preview phrase', () => {
        expect(VOICE_ALERT_TEST_PHRASE).toBe(
            'This is a test. Entry hit. Long Bitcoin.'
        );
    });

    it('never creates speech for a sound-button test', () => {
        expect(getAlertAudioTestSpeechRequest(
            { mode: 'SOUND', group: 'ACTION_OUTCOME' },
            {
                voiceEnabled: true,
                volumePercent: 60,
                preferredVoiceUri: 'selected-uri',
            }
        )).toBeNull();
    });

    it('creates the exact marked-as-test phrase only for voice preview', () => {
        expect(getAlertAudioTestSpeechRequest(
            { mode: 'VOICE' },
            {
                voiceEnabled: true,
                volumePercent: 45,
                preferredVoiceUri: 'selected-uri',
            }
        )).toEqual({
            text: 'This is a test. Entry hit. Long Bitcoin.',
            urgent: true,
            volumePercent: 45,
            preferredVoiceUri: 'selected-uri',
        });
        expect(getAlertAudioTestSpeechRequest(
            { mode: 'VOICE' },
            {
                voiceEnabled: false,
                volumePercent: 45,
            }
        )).toBeNull();
    });

    it.each([
        ['BTC', 'Bitcoin'],
        ['eth', 'Ethereum'],
        ['SOL', 'Solana'],
        ['DOGE', 'Doge'],
        ['XRP', 'X R P'],
        ['AVAX', 'Avax'],
        ['LINK', 'Link'],
        ['ARB', 'Arb'],
        ['SUI', 'SUI'],
    ])('speaks %s as %s', (coin, expected) => {
        expect(getSpokenCoinName(coin)).toBe(expected);
    });

    it.each([
        ['NEW_SIGNAL', {}, 'New setup. Long Bitcoin 1 hour.'],
        ['NEW_SIGNAL', { direction: 'SHORT', timeframe: '15m' }, 'New setup. Short Bitcoin 15 minute.'],
        ['APPROACHING_ENTRY', {}, 'Get ready. Bitcoin is near entry.'],
        ['ENTRY_HIT', { direction: 'SHORT' }, 'Entry hit. Short Bitcoin.'],
        ['TARGET_HIT', {}, 'Target hit. Bitcoin.'],
        ['STOP_HIT', {}, 'Stop hit. Bitcoin.'],
        ['INVALIDATED', { urgent: true }, 'Setup dead. Bitcoin. Cancel your order.'],
        ['INVALIDATED', { urgent: false }, null],
        ['MISSED', {}, null],
        ['BREAK_FORMING', {}, null],
    ] as const)('builds the approved phrase for %s', (kind, overrides, expected) => {
        expect(getAlertSpeechPhrase(alertEvent(kind, overrides))).toBe(expected);
    });

    it('marks only action-critical announcements urgent', () => {
        expect(isUrgentSpeechAlert(alertEvent('ENTRY_HIT'))).toBe(true);
        expect(isUrgentSpeechAlert(alertEvent('STOP_HIT'))).toBe(true);
        expect(isUrgentSpeechAlert(alertEvent('INVALIDATED', { urgent: true }))).toBe(true);
        expect(isUrgentSpeechAlert(alertEvent('INVALIDATED'))).toBe(false);
        expect(isUrgentSpeechAlert(alertEvent('TARGET_HIT'))).toBe(false);
    });

    it('honors a persisted voice URI before the automatic preference order', () => {
        const persisted = voice('Custom Voice', 'en-GB', 'saved-uri');
        const samantha = voice('Samantha');

        expect(selectPreferredSpeechVoice(
            [samantha, persisted],
            'saved-uri'
        )).toBe(persisted);
    });

    it('falls back from a missing URI through the exact named preference order', () => {
        const samantha = voice('Samantha');
        const google = voice('Google US English');
        const aria = voice(
            'Microsoft Aria Online (Natural) - English (United States)'
        );
        const jenny = voice(
            'Microsoft Jenny Online (Natural) - English (United States)'
        );
        const voices = [jenny, aria, google, samantha];

        expect(selectPreferredSpeechVoice(voices, 'missing-uri')).toBe(samantha);
        expect(selectPreferredSpeechVoice(
            voices.filter((candidate) => candidate !== samantha)
        )).toBe(google);
        expect(selectPreferredSpeechVoice(
            voices.filter((candidate) => (
                candidate !== samantha && candidate !== google
            ))
        )).toBe(aria);
        expect(selectPreferredSpeechVoice([jenny])).toBe(jenny);
    });

    it('requires exact names before using the quality and language fallbacks', () => {
        const shortMicrosoftName = voice('Microsoft Aria');
        const exactJenny = voice(
            'Microsoft Jenny Online (Natural) - English (United States)'
        );

        expect(selectPreferredSpeechVoice([
            shortMicrosoftName,
            exactJenny,
        ])).toBe(exactJenny);
        expect(selectPreferredSpeechVoice([
            shortMicrosoftName,
        ])).toBe(shortMicrosoftName);
    });

    it('prefers enhanced US English, then any US English, then the default voice', () => {
        const defaultFrench = voice('System Default', 'fr-FR', 'default-fr', true);
        const genericUs = voice('Alex', 'en-US');
        const enhancedUs = voice('Ava Enhanced', 'en_US');

        expect(selectPreferredSpeechVoice([
            defaultFrench,
            genericUs,
            enhancedUs,
        ])).toBe(enhancedUs);
        expect(selectPreferredSpeechVoice([
            defaultFrench,
            genericUs,
        ])).toBe(genericUs);
        expect(selectPreferredSpeechVoice([defaultFrench])).toBe(defaultFrench);
        expect(selectPreferredSpeechVoice([])).toBeNull();
    });

    it('keeps only the newest single waiting announcement', () => {
        const samantha = voice('Samantha');
        const selected = voice('Selected Voice', 'en-GB', 'selected-uri');
        const driver = new FakeSpeechDriver([samantha, selected]);
        const queue = createSpeechQueue(driver);

        queue.enqueue({
            text: 'first',
            urgent: false,
            volumePercent: 25,
            preferredVoiceUri: 'selected-uri',
        });
        queue.enqueue({ text: 'discarded', urgent: false, volumePercent: 50 });
        queue.enqueue({ text: 'newest', urgent: false, volumePercent: 75 });

        expect(driver.spoken.map(({ text }) => text)).toEqual(['first']);
        expect(queue.getState()).toEqual({ speaking: true, queued: true });
        expect(driver.spoken[0]).toMatchObject({
            volume: 0.25,
            rate: 1,
            pitch: 1,
            lang: 'en-GB',
            voice: selected,
        });

        driver.spoken[0].onend?.();

        expect(driver.spoken.map(({ text }) => text)).toEqual(['first', 'newest']);
        expect(queue.getState()).toEqual({ speaking: true, queued: false });
    });

    it('uses en-US only when no voice can be resolved', () => {
        const driver = new FakeSpeechDriver();
        const queue = createSpeechQueue(driver);

        queue.enqueue({
            text: 'fallback',
            urgent: false,
            volumePercent: 60,
        });

        expect(driver.spoken[0]).toMatchObject({
            lang: 'en-US',
            voice: null,
        });
    });

    it('cancels current and waiting speech for an urgent announcement', () => {
        const driver = new FakeSpeechDriver();
        const queue = createSpeechQueue(driver);

        queue.enqueue({ text: 'current', urgent: false, volumePercent: 60 });
        const staleFinish = driver.spoken[0].onend;
        queue.enqueue({ text: 'waiting', urgent: false, volumePercent: 60 });
        queue.enqueue({ text: 'urgent', urgent: true, volumePercent: 60 });

        expect(driver.cancelCalls).toBe(1);
        expect(driver.spoken.map(({ text }) => text)).toEqual(['current', 'urgent']);
        expect(queue.getState()).toEqual({ speaking: true, queued: false });

        staleFinish?.();
        expect(queue.getState()).toEqual({ speaking: true, queued: false });
        expect(driver.spoken).toHaveLength(2);

        driver.spoken[1].onend?.();
        expect(queue.getState()).toEqual({ speaking: false, queued: false });
    });
});

describe('browser speech voice catalog', () => {
    it('returns only unique English voice options', () => {
        const english = voice('English', 'en-GB', 'english');
        const duplicate = voice('English duplicate', 'en-US', 'english');
        const american = voice('American', 'en_US', 'american', true);
        const french = voice('French', 'fr-FR', 'french');
        const source = new FakeVoiceSource([
            english,
            duplicate,
            american,
            french,
        ]);

        expect(getAvailableEnglishVoices(source)).toEqual([
            english,
            american,
        ]);
    });

    it('uses the immediate catalog without adding a voiceschanged listener', () => {
        const source = new FakeVoiceSource([voice('Samantha')]);
        const snapshots: SpeechVoiceLike[][] = [];

        const unsubscribe = subscribeToAvailableEnglishVoices(
            (voices) => snapshots.push(voices),
            source
        );

        expect(snapshots).toEqual([[voice('Samantha')]]);
        expect(source.addCalls).toBe(0);
        unsubscribe();
        expect(source.removeCalls).toBe(0);
    });

    it('refreshes an initially empty catalog on voiceschanged exactly once', () => {
        const source = new FakeVoiceSource([]);
        const snapshots: SpeechVoiceLike[][] = [];

        const unsubscribe = subscribeToAvailableEnglishVoices(
            (voices) => snapshots.push(voices),
            source
        );

        expect(snapshots).toEqual([[]]);
        expect(source.addCalls).toBe(1);
        expect(source.options).toEqual({ once: true });

        source.voices = [voice('Google US English')];
        source.emitVoicesChanged();
        source.voices = [voice('Samantha')];
        source.emitVoicesChanged();

        expect(snapshots).toEqual([
            [],
            [voice('Google US English')],
        ]);
        expect(source.removeCalls).toBe(1);

        unsubscribe();
        expect(source.removeCalls).toBe(1);
    });
});
