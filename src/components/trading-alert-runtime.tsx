'use client';

import { useEffect } from 'react';
import {
    TRADE_ALERT_EVENT,
    type TradeAlertEvent,
} from '@/lib/alerts/trade-alert-events';
import {
    TRADE_ALERT_AUDIO_TEST_EVENT,
    createBrowserSpeechQueue,
    getAlertAudioTestSample,
    getAlertAudioTestSpeechRequest,
    getAlertSpeechPhrase,
    getEarconForAlert,
    isAlertEarconEnabled,
    isUrgentSpeechAlert,
    playAlertEarcon,
    type AlertAudioTestRequest,
} from '@/lib/alerts/trade-alert-audio';
import {
    getTradeAlertBody,
    getTradeAlertTitle,
} from '@/lib/alerts/trade-alert-presentation';
import { useTradingStore } from '@/store/trading-store';

export default function TradingAlertRuntime() {
    useEffect(() => {
        const baseTitle = document.title.replace(/^\(\d+\)\s*/, '');
        const unseenAlerts = new Set<string>();
        let audioContext: AudioContext | null = null;
        let audioUnlocked = false;
        const speechQueue = createBrowserSpeechQueue();

        // With the dashboard open in several tabs (e.g. restored after a restart),
        // only the tab holding this lock speaks, beeps and notifies.
        let isAlertLeader = typeof navigator === 'undefined' || !navigator.locks;
        let releaseAlertLock: (() => void) | null = null;
        let disposed = false;
        const alertLockController = new AbortController();
        if (!isAlertLeader) {
            void navigator.locks.request(
                'chain-trader-alert-audio',
                { signal: alertLockController.signal },
                () => {
                    if (disposed) return Promise.resolve();
                    isAlertLeader = true;
                    return new Promise<void>((resolve) => { releaseAlertLock = resolve; });
                }
            ).catch((error: unknown) => {
                if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
                    isAlertLeader = true;
                }
            });
        }

        const clearUnseen = () => {
            unseenAlerts.clear();
            document.title = baseTitle;
        };

        const unlockAudio = () => {
            try {
                audioContext ??= new AudioContext();
                const resume = audioContext.resume();
                if (audioContext.state === 'running') {
                    audioUnlocked = true;
                    document.removeEventListener('click', unlockAudio, true);
                } else {
                    void resume.then(() => {
                        if (audioContext?.state === 'running') {
                            audioUnlocked = true;
                            document.removeEventListener('click', unlockAudio, true);
                        }
                    }).catch(() => undefined);
                }
            } catch {
                // Notifications and title alerts still work when audio is unavailable.
            }
        };

        const playEarcon = (event: TradeAlertEvent, volumePercent: number) => {
            if (!audioUnlocked || !audioContext || audioContext.state !== 'running') return;
            const earcon = getEarconForAlert(event);
            if (earcon) playAlertEarcon(audioContext, earcon, volumePercent);
        };

        const playTestEarcon = (event: TradeAlertEvent, volumePercent: number) => {
            const playWhenReady = () => {
                if (!audioContext || audioContext.state !== 'running') return;
                audioUnlocked = true;
                document.removeEventListener('click', unlockAudio, true);
                const earcon = getEarconForAlert(event);
                if (earcon) playAlertEarcon(audioContext, earcon, volumePercent);
            };

            try {
                audioContext ??= new AudioContext();
                if (audioContext.state === 'running') {
                    playWhenReady();
                    return;
                }
                void audioContext.resume().then(playWhenReady).catch(() => undefined);
            } catch {
                // Voice previews remain available when Web Audio is unavailable.
            }
        };

        const speakAlert = (
            event: TradeAlertEvent,
            volumePercent: number,
            preferredVoiceUri?: string
        ) => {
            const text = getAlertSpeechPhrase(event);
            if (!text) return;
            speechQueue?.enqueue({
                text,
                urgent: isUrgentSpeechAlert(event),
                volumePercent,
                preferredVoiceUri,
            });
        };

        const showNotification = (event: TradeAlertEvent) => {
            if (
                document.visibilityState === 'visible' ||
                typeof Notification === 'undefined' ||
                Notification.permission !== 'granted'
            ) return;

            const notification = new Notification(getTradeAlertTitle(event), {
                body: getTradeAlertBody(event),
                tag: `${event.kind}:${event.signalId ?? `${event.coin}:${event.timeframe}`}`,
                silent: (event.kind === 'MISSED' || event.kind === 'INVALIDATED') && !event.urgent,
            });
            notification.onclick = () => {
                window.focus();
                clearUnseen();
                notification.close();
            };
        };

        const handleTradeAlert = (domEvent: Event) => {
            const event = (domEvent as CustomEvent<TradeAlertEvent>).detail;
            const settings = useTradingStore.getState().settings;
            if (!settings.alertsEnabled) return;

            const flashesTitle = event.kind === 'NEW_SIGNAL' ||
                event.kind === 'TARGET_HIT' ||
                event.kind === 'STOP_HIT' ||
                event.kind === 'MISSED' ||
                event.kind === 'INVALIDATED';
            if (flashesTitle && document.visibilityState !== 'visible') {
                unseenAlerts.add(`${event.kind}:${event.signalId ?? `${event.coin}:${event.timeframe}`}`);
                document.title = `(${unseenAlerts.size}) ${baseTitle}`;
            }
            if (!isAlertLeader) return;
            if (settings.soundEnabled && isAlertEarconEnabled(event, settings)) {
                playEarcon(event, settings.soundVolume);
            }
            // Browser speech does not require the Web Audio unlock gesture.
            if (settings.voiceAlertsEnabled) {
                speakAlert(
                    event,
                    settings.soundVolume,
                    settings.preferredVoiceUri
                );
            }
            if (settings.browserNotificationsEnabled) showNotification(event);
        };

        const handleAudioTest = (domEvent: Event) => {
            const request = (domEvent as CustomEvent<AlertAudioTestRequest>).detail;
            const settings = useTradingStore.getState().settings;
            if (!request || !(request.alertsEnabled ?? settings.alertsEnabled)) return;

            const volumePercent = request.volume ?? settings.soundVolume;
            const voiceEnabled = request.voiceEnabled ?? settings.voiceAlertsEnabled;
            const preferredVoiceUri = request.preferredVoiceUri ??
                settings.preferredVoiceUri;
            const sample = getAlertAudioTestSample(
                request.mode === 'SOUND' ? request.group : 'INFO'
            );

            if (request.mode === 'SOUND' && (request.soundEnabled ?? settings.soundEnabled)) {
                // Preview the requested category even when its staged sub-toggle is off.
                playTestEarcon(sample, volumePercent);
            }
            if (request.mode === 'SOUND') return;

            const speechRequest = getAlertAudioTestSpeechRequest(request, {
                voiceEnabled,
                volumePercent,
                preferredVoiceUri,
            });
            if (speechRequest) speechQueue?.enqueue(speechRequest);
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') clearUnseen();
        };

        document.addEventListener('click', unlockAudio, true);
        window.addEventListener(TRADE_ALERT_EVENT, handleTradeAlert);
        window.addEventListener(TRADE_ALERT_AUDIO_TEST_EVENT, handleAudioTest);
        window.addEventListener('focus', clearUnseen);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            document.removeEventListener('click', unlockAudio, true);
            window.removeEventListener(TRADE_ALERT_EVENT, handleTradeAlert);
            window.removeEventListener(TRADE_ALERT_AUDIO_TEST_EVENT, handleAudioTest);
            window.removeEventListener('focus', clearUnseen);
            document.removeEventListener('visibilitychange', handleVisibility);
            disposed = true;
            alertLockController.abort();
            releaseAlertLock?.();
            speechQueue?.dispose();
            clearUnseen();
            if (audioContext) void audioContext.close();
        };
    }, []);

    return null;
}
