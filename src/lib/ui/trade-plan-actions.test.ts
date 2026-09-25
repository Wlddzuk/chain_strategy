import { describe, expect, it } from 'vitest';
import {
    getOpenPlanButtonState,
    TRADE_TICKET_HIGHLIGHT_MS,
} from './trade-plan-actions';

describe('Open Plan feedback', () => {
    it('becomes a disabled confirmation while its ticket is open', () => {
        expect(getOpenPlanButtonState(false)).toEqual({
            disabled: false,
            label: 'Open Plan',
        });
        expect(getOpenPlanButtonState(true)).toEqual({
            disabled: true,
            label: 'Plan open ✓',
        });
        expect(TRADE_TICKET_HIGHLIGHT_MS).toBe(1500);
    });
});
