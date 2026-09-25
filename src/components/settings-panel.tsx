'use client';

import { useEffect, useRef, useState } from 'react';
import {
    requestTradeAlertAudioTest,
    requestVoiceAlertTest,
    subscribeToAvailableEnglishVoices,
    type SpeechVoiceOption,
} from '@/lib/alerts/trade-alert-audio';
import { type Timeframe, useTradingStore } from '@/store/trading-store';

interface SettingsPanelProps {
    onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
    const settings = useTradingStore((state) => state.settings);
    const updateSettings = useTradingStore((state) => state.updateSettings);
    const accountInputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default');
    const [voiceOptions, setVoiceOptions] = useState<SpeechVoiceOption[]>([]);

    const [localSettings, setLocalSettings] = useState({
        accountEquity: settings.accountEquity,
        riskPercent: settings.riskPercent,
        leverage: settings.leverage,
        walletAddress: settings.walletAddress,
        alertsEnabled: settings.alertsEnabled,
        soundEnabled: settings.soundEnabled,
        voiceAlertsEnabled: settings.voiceAlertsEnabled,
        preferredVoiceUri: settings.preferredVoiceUri,
        soundVolume: settings.soundVolume,
        infoSoundsEnabled: settings.infoSoundsEnabled,
        headsUpSoundsEnabled: settings.headsUpSoundsEnabled,
        actionOutcomeSoundsEnabled: settings.actionOutcomeSoundsEnabled,
        browserNotificationsEnabled: settings.browserNotificationsEnabled,
        approachThresholdPercent: settings.approachThresholdPercent,
        minStopDistancePercent: settings.minStopDistancePercent,
        maxRiskRewardRatio: settings.maxRiskRewardRatio,
        feePercentPerSide: settings.feePercentPerSide,
        farFromEntryPercent: settings.farFromEntryPercent,
        scanTimeframes: settings.scanTimeframes,
        breakFormingAlertsEnabled: settings.breakFormingAlertsEnabled,
    });

    const isValidSettings =
        Number.isFinite(localSettings.accountEquity) && localSettings.accountEquity > 0 &&
        localSettings.riskPercent >= 0.1 &&
        localSettings.riskPercent <= 10 &&
        localSettings.leverage >= 1 &&
        localSettings.leverage <= 50 &&
        localSettings.soundVolume >= 0 &&
        localSettings.soundVolume <= 100 &&
        localSettings.approachThresholdPercent >= 0.05 &&
        localSettings.approachThresholdPercent <= 2 &&
        localSettings.minStopDistancePercent >= 0 &&
        localSettings.minStopDistancePercent <= 25 &&
        localSettings.maxRiskRewardRatio >= 2 &&
        localSettings.maxRiskRewardRatio <= 100 &&
        localSettings.feePercentPerSide >= 0 &&
        localSettings.feePercentPerSide <= 1 &&
        localSettings.farFromEntryPercent >= 0.1 &&
        localSettings.farFromEntryPercent <= 25 &&
        (localSettings.walletAddress.trim() === '' || /^0x[0-9a-fA-F]{40}$/.test(localSettings.walletAddress.trim()));

    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
            }
            if (event.key !== 'Tab' || !panelRef.current) return;
            const elements = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]'
            ));
            const first = elements[0];
            const last = elements.at(-1);
            if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
                event.preventDefault();
                first?.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        accountInputRef.current?.focus();
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const permission = 'Notification' in window
                ? Notification.permission
                : 'unsupported';

            setNotificationPermission(permission);
            if (permission === 'denied' || permission === 'unsupported') {
                setLocalSettings((current) => ({
                    ...current,
                    browserNotificationsEnabled: false,
                }));
            }
        }, 0);

        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => subscribeToAvailableEnglishVoices(setVoiceOptions), []);

    const handleBrowserNotificationsChange = async (enabled: boolean) => {
        if (!enabled) {
            setLocalSettings((current) => ({
                ...current,
                browserNotificationsEnabled: false,
            }));
            return;
        }

        if (!('Notification' in window)) {
            setNotificationPermission('unsupported');
            return;
        }

        const permission = Notification.permission === 'default'
            ? await Notification.requestPermission()
            : Notification.permission;

        setNotificationPermission(permission);
        setLocalSettings((current) => ({
            ...current,
            browserNotificationsEnabled: permission === 'granted',
        }));
    };

    const toggleScanTimeframe = (timeframe: Timeframe) => {
        setLocalSettings((current) => ({
            ...current,
            scanTimeframes: current.scanTimeframes.includes(timeframe)
                ? current.scanTimeframes.filter((value) => value !== timeframe)
                : [...current.scanTimeframes, timeframe],
        }));
    };

    const handleSave = () => {
        if (!isValidSettings) return;
        updateSettings({ ...localSettings, walletAddress: localSettings.walletAddress.trim() });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Modal */}
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                className="relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 animate-fade-in"
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 id="settings-title" className="text-lg font-semibold">Settings</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 hover:bg-[var(--card-hover)] rounded-lg transition-colors"
                        aria-label="Close settings"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Risk Settings */}
                <div className="space-y-4">
                    <div>
                        <label htmlFor="settings-equity" className="block text-sm font-medium mb-2">
                            Account Balance (USD)
                        </label>
                        <input
                            ref={accountInputRef}
                            id="settings-equity"
                            type="number"
                            value={localSettings.accountEquity}
                            onChange={(e) => setLocalSettings({
                                ...localSettings,
                                accountEquity: parseFloat(e.target.value) || 0,
                            })}
                            min={1}
                            step={100}
                            className="input w-full"
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Used for risk-capped position and margin calculations
                        </p>
                    </div>

                    <div>
                        <label htmlFor="settings-risk" className="block text-sm font-medium mb-2">
                            Risk per Trade (%)
                        </label>
                        <input
                            id="settings-risk"
                            type="number"
                            value={localSettings.riskPercent}
                            onChange={(e) => setLocalSettings({
                                ...localSettings,
                                riskPercent: parseFloat(e.target.value) || 0,
                            })}
                            min={0.1}
                            max={10}
                            step={0.1}
                            className="input w-full"
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Recommended: 1-2% for safe risk management
                        </p>
                    </div>

                    <div>
                        <label htmlFor="settings-leverage" className="block text-sm font-medium mb-2">
                            Default Leverage
                        </label>
                        <input
                            id="settings-leverage"
                            type="number"
                            value={localSettings.leverage}
                            onChange={(e) => setLocalSettings({
                                ...localSettings,
                                leverage: parseInt(e.target.value) || 1,
                            })}
                            min={1}
                            max={50}
                            step={1}
                            className="input w-full"
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Changes required margin; planned dollar risk stays the same
                        </p>
                    </div>

                    <div className="pt-4 border-t border-[var(--card-border)]">
                        <label htmlFor="settings-wallet" className="block text-sm font-medium mb-2">
                            Hyperliquid Wallet Address
                        </label>
                        <input
                            id="settings-wallet"
                            type="text"
                            value={localSettings.walletAddress}
                            onChange={(e) => setLocalSettings({
                                ...localSettings,
                                walletAddress: e.target.value,
                            })}
                            placeholder="0x..."
                            aria-invalid={localSettings.walletAddress.trim() !== '' && !/^0x[0-9a-fA-F]{40}$/.test(localSettings.walletAddress.trim())}
                            className="input w-full font-mono text-sm"
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Your Hyperliquid trading wallet address
                        </p>
                        {localSettings.walletAddress.trim() !== '' && !/^0x[0-9a-fA-F]{40}$/.test(localSettings.walletAddress.trim()) && (
                            <p role="alert" className="mt-1 text-xs text-[var(--short-red)]">
                                Enter a public wallet address: 0x followed by 40 hexadecimal characters.
                            </p>
                        )}
                    </div>

                    <section className="pt-4 border-t border-[var(--card-border)] space-y-4" aria-labelledby="setup-filter-settings-title">
                        <div>
                            <h3 id="setup-filter-settings-title" className="text-sm font-semibold">Setup filters</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                Reject new plans built from razor-thin zones or implausibly high reward ratios.
                            </p>
                        </div>

                        <div>
                            <label htmlFor="settings-min-stop" className="block text-sm font-medium mb-2">
                                Minimum stop distance (%)
                            </label>
                            <input
                                id="settings-min-stop"
                                type="number"
                                value={localSettings.minStopDistancePercent}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    minStopDistancePercent: parseFloat(event.target.value) || 0,
                                }))}
                                min={0}
                                max={25}
                                step={0.05}
                                className="input w-full"
                            />
                        </div>

                        <div>
                            <label htmlFor="settings-max-rr" className="block text-sm font-medium mb-2">
                                Maximum gross R:R
                            </label>
                            <input
                                id="settings-max-rr"
                                type="number"
                                value={localSettings.maxRiskRewardRatio}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    maxRiskRewardRatio: parseFloat(event.target.value) || 0,
                                }))}
                                min={2}
                                max={100}
                                step={0.5}
                                className="input w-full"
                            />
                        </div>

                        <div>
                            <label htmlFor="settings-fee" className="block text-sm font-medium mb-2">
                                Fee estimate per side (%)
                            </label>
                            <input
                                id="settings-fee"
                                type="number"
                                value={localSettings.feePercentPerSide}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    feePercentPerSide: parseFloat(event.target.value) || 0,
                                }))}
                                min={0}
                                max={1}
                                step={0.005}
                                className="input w-full"
                            />
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                Used only for the net R:R estimate; strategy targets remain unchanged.
                            </p>
                        </div>

                        <div>
                            <label htmlFor="settings-far-entry" className="block text-sm font-medium mb-2">
                                Far-from-entry badge (%)
                            </label>
                            <input
                                id="settings-far-entry"
                                type="number"
                                value={localSettings.farFromEntryPercent}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    farFromEntryPercent: parseFloat(event.target.value) || 0,
                                }))}
                                min={0.1}
                                max={25}
                                step={0.25}
                                className="input w-full"
                            />
                        </div>
                    </section>

                    <section className="pt-4 border-t border-[var(--card-border)] space-y-4" aria-labelledby="alert-settings-title">
                        <div>
                            <h3 id="alert-settings-title" className="text-sm font-semibold">Trade Alerts</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                Alerts are planning reminders only and never place an exchange order.
                            </p>
                        </div>

                        <label className="flex items-start justify-between gap-4 cursor-pointer">
                            <span>
                                <span className="block text-sm font-medium">Enable alerts</span>
                                <span className="block text-xs text-[var(--text-muted)] mt-1">
                                    New setups, approaching entries, and entry touches
                                </span>
                            </span>
                            <input
                                type="checkbox"
                                checked={localSettings.alertsEnabled}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    alertsEnabled: event.target.checked,
                                }))}
                                className="mt-1 h-4 w-4 accent-[var(--accent)]"
                            />
                        </label>

                        <label className="flex items-start justify-between gap-4 cursor-pointer">
                            <span>
                                <span className="block text-sm font-medium">Sound alerts</span>
                                <span className="block text-xs text-[var(--text-muted)] mt-1">
                                    Master switch for the distinct alert sounds below
                                </span>
                            </span>
                            <input
                                type="checkbox"
                                checked={localSettings.soundEnabled}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    soundEnabled: event.target.checked,
                                }))}
                                disabled={!localSettings.alertsEnabled}
                                className="mt-1 h-4 w-4 accent-[var(--accent)] disabled:opacity-50"
                            />
                        </label>

                        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-3 space-y-3">
                            <div>
                                <div className="flex items-center justify-between gap-3">
                                    <label htmlFor="settings-sound-volume" className="text-sm font-medium">
                                        Sound volume
                                    </label>
                                    <span className="font-mono text-xs text-[var(--text-muted)]">
                                        {localSettings.soundVolume}%
                                    </span>
                                </div>
                                <input
                                    id="settings-sound-volume"
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={localSettings.soundVolume}
                                    onChange={(event) => setLocalSettings((current) => ({
                                        ...current,
                                        soundVolume: Number(event.target.value),
                                    }))}
                                    disabled={!localSettings.alertsEnabled || !localSettings.soundEnabled}
                                    className="mt-2 w-full accent-[var(--accent)] disabled:opacity-50"
                                />
                            </div>

                            <SoundToggleRow
                                label="Info sounds"
                                description="A soft tick when there is nothing to do yet"
                                checked={localSettings.infoSoundsEnabled}
                                disabled={!localSettings.alertsEnabled || !localSettings.soundEnabled}
                                onChange={(checked) => setLocalSettings((current) => ({
                                    ...current,
                                    infoSoundsEnabled: checked,
                                }))}
                                onTest={() => requestTradeAlertAudioTest('INFO', {
                                    volume: localSettings.soundVolume,
                                    voiceEnabled: localSettings.voiceAlertsEnabled,
                                    alertsEnabled: localSettings.alertsEnabled,
                                    soundEnabled: localSettings.soundEnabled,
                                    preferredVoiceUri: localSettings.preferredVoiceUri,
                                })}
                            />
                            <SoundToggleRow
                                label="Heads-up sounds"
                                description="Two rising notes when price is near entry"
                                checked={localSettings.headsUpSoundsEnabled}
                                disabled={!localSettings.alertsEnabled || !localSettings.soundEnabled}
                                onChange={(checked) => setLocalSettings((current) => ({
                                    ...current,
                                    headsUpSoundsEnabled: checked,
                                }))}
                                onTest={() => requestTradeAlertAudioTest('HEADS_UP', {
                                    volume: localSettings.soundVolume,
                                    voiceEnabled: localSettings.voiceAlertsEnabled,
                                    alertsEnabled: localSettings.alertsEnabled,
                                    soundEnabled: localSettings.soundEnabled,
                                    preferredVoiceUri: localSettings.preferredVoiceUri,
                                })}
                            />
                            <SoundToggleRow
                                label="Action & outcome sounds"
                                description="Recommended: entry, cancel, target, and stop cues"
                                checked={localSettings.actionOutcomeSoundsEnabled}
                                disabled={!localSettings.alertsEnabled || !localSettings.soundEnabled}
                                onChange={(checked) => setLocalSettings((current) => ({
                                    ...current,
                                    actionOutcomeSoundsEnabled: checked,
                                }))}
                                onTest={() => requestTradeAlertAudioTest('ACTION_OUTCOME', {
                                    volume: localSettings.soundVolume,
                                    voiceEnabled: localSettings.voiceAlertsEnabled,
                                    alertsEnabled: localSettings.alertsEnabled,
                                    soundEnabled: localSettings.soundEnabled,
                                    preferredVoiceUri: localSettings.preferredVoiceUri,
                                })}
                            />
                        </div>

                        <label className="flex cursor-pointer items-start justify-between gap-4">
                            <span>
                                <span className="block text-sm font-medium">Voice alerts</span>
                                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                                    Speaks a short action phrase using your browser voice
                                </span>
                            </span>
                            <input
                                type="checkbox"
                                checked={localSettings.voiceAlertsEnabled}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    voiceAlertsEnabled: event.target.checked,
                                }))}
                                disabled={!localSettings.alertsEnabled}
                                className="mt-1 h-4 w-4 accent-[var(--accent)] disabled:opacity-50"
                            />
                        </label>

                        <div>
                            <label htmlFor="settings-alert-voice" className="block text-sm font-medium mb-2">
                                Alert voice
                            </label>
                            <div className="flex items-center gap-2">
                                <select
                                    id="settings-alert-voice"
                                    value={localSettings.preferredVoiceUri}
                                    onChange={(event) => setLocalSettings((current) => ({
                                        ...current,
                                        preferredVoiceUri: event.target.value,
                                    }))}
                                    disabled={!localSettings.alertsEnabled || !localSettings.voiceAlertsEnabled}
                                    className="input min-w-0 flex-1 disabled:opacity-50"
                                >
                                    <option value="">Auto (recommended)</option>
                                    {localSettings.preferredVoiceUri &&
                                        !voiceOptions.some((voice) => voice.voiceURI === localSettings.preferredVoiceUri) && (
                                        <option value={localSettings.preferredVoiceUri}>
                                            Auto (saved voice unavailable)
                                        </option>
                                    )}
                                    {voiceOptions.map((voice) => (
                                        <option key={voice.voiceURI} value={voice.voiceURI}>
                                            {voice.name} ({voice.lang})
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => requestVoiceAlertTest({
                                        volume: localSettings.soundVolume,
                                        voiceEnabled: localSettings.voiceAlertsEnabled,
                                        alertsEnabled: localSettings.alertsEnabled,
                                        preferredVoiceUri: localSettings.preferredVoiceUri,
                                    })}
                                    disabled={!localSettings.alertsEnabled || !localSettings.voiceAlertsEnabled}
                                    className="btn btn-outline shrink-0 px-3 py-2 text-xs disabled:opacity-50"
                                >
                                    Preview
                                </button>
                            </div>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                                Example phrase — not a real signal.
                            </p>
                        </div>

                        <label className={`flex items-start justify-between gap-4 ${
                            notificationPermission === 'denied' || notificationPermission === 'unsupported'
                                ? 'cursor-not-allowed opacity-60'
                                : 'cursor-pointer'
                        }`}>
                            <span>
                                <span className="block text-sm font-medium">Browser notifications</span>
                                <span className="block text-xs text-[var(--text-muted)] mt-1">
                                    Shown when this tab is not visible
                                </span>
                            </span>
                            <input
                                type="checkbox"
                                checked={localSettings.browserNotificationsEnabled}
                                onChange={(event) => void handleBrowserNotificationsChange(event.target.checked)}
                                disabled={
                                    !localSettings.alertsEnabled ||
                                    notificationPermission === 'denied' ||
                                    notificationPermission === 'unsupported'
                                }
                                className="mt-1 h-4 w-4 accent-[var(--accent)] disabled:opacity-50"
                            />
                        </label>

                        <label className="flex cursor-pointer items-start justify-between gap-4">
                            <span>
                                <span className="block text-sm font-medium">Break-forming alerts</span>
                                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                                    Optional early warning while a zone break is still waiting for candle-close confirmation
                                </span>
                            </span>
                            <input
                                type="checkbox"
                                checked={localSettings.breakFormingAlertsEnabled}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    breakFormingAlertsEnabled: event.target.checked,
                                }))}
                                disabled={!localSettings.alertsEnabled}
                                className="mt-1 h-4 w-4 accent-[var(--accent)] disabled:opacity-50"
                            />
                        </label>

                        {notificationPermission === 'denied' && (
                            <p role="status" className="text-xs text-[var(--short-red)]">
                                Browser notifications are blocked. Allow them in this site&apos;s browser settings to enable this option.
                            </p>
                        )}
                        {notificationPermission === 'unsupported' && (
                            <p role="status" className="text-xs text-[var(--text-muted)]">
                                This browser does not support desktop notifications. Sound and tab alerts still work.
                            </p>
                        )}

                        <div>
                            <label htmlFor="settings-approach-threshold" className="block text-sm font-medium mb-2">
                                Approaching-entry distance (%)
                            </label>
                            <input
                                id="settings-approach-threshold"
                                type="number"
                                value={localSettings.approachThresholdPercent}
                                onChange={(event) => setLocalSettings((current) => ({
                                    ...current,
                                    approachThresholdPercent: parseFloat(event.target.value) || 0,
                                }))}
                                min={0.05}
                                max={2}
                                step={0.05}
                                className="input w-full"
                            />
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                Alert once while price is moving toward an entry within this distance (0.05-2%).
                            </p>
                        </div>
                    </section>

                    <section className="pt-4 border-t border-[var(--card-border)] space-y-3" aria-labelledby="scanner-settings-title">
                        <div>
                            <h3 id="scanner-settings-title" className="text-sm font-semibold">Background Scanner</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                Scan every watchlist coin at these candle closes. The timeframe on screen is always included.
                            </p>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            {(['5m', '15m', '1h', '4h'] satisfies Timeframe[]).map((timeframe) => (
                                <label
                                    key={timeframe}
                                    className="flex items-center justify-center gap-2 rounded-lg border border-[var(--card-border)] px-2 py-2 text-sm cursor-pointer hover:bg-[var(--card-hover)]"
                                >
                                    <input
                                        type="checkbox"
                                        checked={localSettings.scanTimeframes.includes(timeframe)}
                                        onChange={() => toggleScanTimeframe(timeframe)}
                                        className="h-4 w-4 accent-[var(--accent)]"
                                    />
                                    {timeframe}
                                </label>
                            ))}
                        </div>
                    </section>

                    {!isValidSettings && (
                        <p role="alert" className="text-xs text-[var(--short-red)]">
                            Check the balance, risk, leverage, alert distance, and setup-filter ranges above.
                        </p>
                    )}

                    {/* Warning */}
                    <div className="bg-[var(--short-red-dim)] border border-[var(--short-red)] rounded-lg p-4 mt-4">
                        <div className="flex gap-3">
                            <svg className="w-5 h-5 text-[var(--short-red)] flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div>
                                <p className="text-sm font-medium text-[var(--short-red)]">Trading Risk Warning</p>
                                <p className="text-xs text-[var(--text-muted)] mt-1">
                                    Trading cryptocurrencies involves significant risk. Only trade with funds you can afford to lose.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={onClose} className="btn btn-outline flex-1">
                        Cancel
                    </button>
                    <button type="button" onClick={handleSave} disabled={!isValidSettings} className="btn btn-primary flex-1">
                        Save Settings
                    </button>
                </div>
            </div>
        </div>
    );
}

function SoundToggleRow({
    label,
    description,
    checked,
    disabled,
    onChange,
    onTest,
}: {
    label: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
    onTest: () => void;
}) {
    return (
        <div className="flex items-start justify-between gap-3 border-t border-[var(--card-border)] pt-3 first:border-t-0 first:pt-0">
            <label className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-3">
                <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-muted)]">
                        {description}
                    </span>
                </span>
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => onChange(event.target.checked)}
                    disabled={disabled}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)] disabled:opacity-50"
                />
            </label>
            <button
                type="button"
                onClick={onTest}
                disabled={disabled}
                className="btn btn-outline px-2 py-1 text-xs disabled:opacity-50"
            >
                Test
            </button>
        </div>
    );
}
