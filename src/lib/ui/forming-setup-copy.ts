import type { Zone } from '@/lib/trading/types';
import { formatPrice } from '@/lib/ui/format-price';
import type { ZonePriceRelation } from '@/lib/ui/setup-forming';

const ZONE_EDGE_THRESHOLD_PERCENT = 0.05;

export function getZoneBreakSignalDirection(
    zoneType: Zone['type']
): 'LONG' | 'SHORT' {
    return zoneType === 'SUPPLY' ? 'LONG' : 'SHORT';
}

export function formatFormingSetupConsequence(zone: Zone): string {
    const lowerBound = Math.min(zone.proximalLine, zone.distalLine);
    const upperBound = Math.max(zone.proximalLine, zone.distalLine);
    const direction = getZoneBreakSignalDirection(zone.type);

    return `${zone.type} ${formatPrice(lowerBound)}–${formatPrice(upperBound)} — candle close beyond it fires a ${direction} signal`;
}

export function formatFormingSetupPricePosition(
    distancePercent: number,
    priceRelation: ZonePriceRelation
): string {
    if (priceRelation === 'inside') return 'price inside zone';
    if (Math.abs(distancePercent) < ZONE_EDGE_THRESHOLD_PERCENT) {
        return 'price at zone edge';
    }

    return `price ${Math.abs(distancePercent).toFixed(1)}% ${priceRelation}`;
}
