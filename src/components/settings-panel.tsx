'use client';

import { useState } from 'react';
import { useTradingStore } from '@/store/trading-store';

interface SettingsPanelProps {
    onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
    const { settings, updateSettings } = useTradingStore();

    const [localSettings, setLocalSettings] = useState({
        riskPercent: settings.riskPercent,
        leverage: settings.leverage,
        walletAddress: settings.walletAddress,
    });

    const handleSave = () => {
        updateSettings(localSettings);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl w-full max-w-md p-6 animate-fade-in">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold">Settings</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-[var(--card-hover)] rounded-lg transition-colors"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Risk Settings */}
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">
                            Risk per Trade (%)
                        </label>
                        <input
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
                        <label className="block text-sm font-medium mb-2">
                            Default Leverage
                        </label>
                        <input
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
                            Higher leverage increases both potential gains and losses
                        </p>
                    </div>

                    <div className="pt-4 border-t border-[var(--card-border)]">
                        <label className="block text-sm font-medium mb-2">
                            Hyperliquid Wallet Address
                        </label>
                        <input
                            type="text"
                            value={localSettings.walletAddress}
                            onChange={(e) => setLocalSettings({
                                ...localSettings,
                                walletAddress: e.target.value,
                            })}
                            placeholder="0x..."
                            className="input w-full font-mono text-sm"
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Your Hyperliquid trading wallet address
                        </p>
                    </div>

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
                    <button onClick={onClose} className="btn btn-outline flex-1">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="btn btn-primary flex-1">
                        Save Settings
                    </button>
                </div>
            </div>
        </div>
    );
}
