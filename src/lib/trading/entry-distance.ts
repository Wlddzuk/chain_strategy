/**
 * Returns the signed percentage move price must make from its current value
 * to reach the planned entry. A negative value means price must fall.
 */
export function getMoveToEntryPercent(
    currentPrice: number,
    entryPrice: number
): number {
    if (
        !Number.isFinite(currentPrice) ||
        !Number.isFinite(entryPrice) ||
        currentPrice <= 0 ||
        entryPrice <= 0
    ) {
        return Number.POSITIVE_INFINITY;
    }

    return ((entryPrice - currentPrice) / currentPrice) * 100;
}
