import type { ChainSignal } from '@/lib/trading/types';
import { isActiveSignal } from '@/lib/ui/signal-display';

export function selectActiveSignals(
    signals: readonly ChainSignal[]
): ChainSignal[] {
    return signals.filter(isActiveSignal);
}

export function selectActiveSignalCount(
    signals: readonly ChainSignal[]
): number {
    return selectActiveSignals(signals).length;
}
