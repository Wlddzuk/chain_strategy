export const TRADE_TICKET_HIGHLIGHT_MS = 1500;

export function getOpenPlanButtonState(isOpen: boolean): {
    disabled: boolean;
    label: 'Open Plan' | 'Plan open ✓';
} {
    return {
        disabled: isOpen,
        label: isOpen ? 'Plan open ✓' : 'Open Plan',
    };
}
