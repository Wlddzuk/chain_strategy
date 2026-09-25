// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SettingsPanel from './settings-panel';

vi.mock('@/lib/alerts/trade-alert-audio', () => ({
    requestTradeAlertAudioTest: vi.fn(), requestVoiceAlertTest: vi.fn(),
    subscribeToAvailableEnglishVoices: () => () => undefined,
}));
afterEach(cleanup);

it('keeps keyboard focus inside Settings and restores focus on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(createElement(SettingsPanel, { onClose: vi.fn() }));
    const first = screen.getByRole('button', { name: 'Close settings' });
    const last = screen.getByRole('button', { name: 'Save Settings' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
});

it('rejects an invalid public wallet address and keeps the optional empty value usable', () => {
    render(createElement(SettingsPanel, { onClose: vi.fn() }));
    const address = screen.getByRole('textbox', { name: 'Hyperliquid Wallet Address' });
    fireEvent.change(address, { target: { value: 'not-a-wallet' } });
    expect(screen.getByRole('button', { name: 'Save Settings' }).hasAttribute('disabled')).toBe(true);
    expect(address.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(address, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save Settings' }).hasAttribute('disabled')).toBe(false);
});
