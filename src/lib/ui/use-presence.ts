'use client';

import { useEffect, useState } from 'react';

/**
 * Keeps an overlay mounted long enough to animate out along the same path it
 * came in. `visible` flips one painted frame after mount so CSS transitions
 * have a start state; flipping `open` mid-flight reverses from the current
 * on-screen value because CSS transitions retarget from the live value.
 */
export function usePresence(open: boolean, exitMs = 320) {
    const [mounted, setMounted] = useState(open);
    const [visible, setVisible] = useState(false);

    if (open && !mounted) setMounted(true);
    if (!open && visible) setVisible(false);

    useEffect(() => {
        if (open) {
            let second = 0;
            const first = window.requestAnimationFrame(() => {
                second = window.requestAnimationFrame(() => setVisible(true));
            });
            return () => {
                window.cancelAnimationFrame(first);
                window.cancelAnimationFrame(second);
            };
        }

        const timer = window.setTimeout(() => setMounted(false), exitMs);
        return () => window.clearTimeout(timer);
    }, [exitMs, open]);

    return { mounted, visible };
}
