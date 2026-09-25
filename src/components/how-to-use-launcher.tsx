'use client';

import { useState, useSyncExternalStore } from 'react';
import { HowToUseButton } from '@/components/how-to-use-button';
import { HowToUseDrawer } from '@/components/how-to-use-drawer';
import { useTradingStore } from '@/store/trading-store';

function subscribeToHydration(onStoreChange: () => void) {
    return useTradingStore.persist.onFinishHydration(onStoreChange);
}

function getHydrationSnapshot() {
    return useTradingStore.persist.hasHydrated();
}

function getServerHydrationSnapshot() {
    return false;
}

export function HowToUseLauncher() {
    const hasSeenGuide = useTradingStore((state) => state.hasSeenGuide);
    const markGuideSeen = useTradingStore((state) => state.markGuideSeen);
    const hasHydrated = useSyncExternalStore(
        subscribeToHydration,
        getHydrationSnapshot,
        getServerHydrationSnapshot
    );
    const [open, setOpen] = useState(false);

    const handleOpen = () => {
        markGuideSeen();
        setOpen(true);
    };

    return (
        <>
            <HowToUseButton
                onClick={handleOpen}
                showNudge={hasHydrated && !hasSeenGuide}
            />
            <HowToUseDrawer open={open} onClose={() => setOpen(false)} />
        </>
    );
}
