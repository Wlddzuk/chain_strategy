const FALLBACK_SIGNIFICANT_DIGITS = 4;
const MAX_SUPPORTED_DECIMALS = 323;

export interface RoundedQuantity {
    roundedValue: number;
    displayValue: string;
    copyValue: string;
    decimalPlaces: number;
}

function isSupportedDecimalCount(value: number | undefined): value is number {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= MAX_SUPPORTED_DECIMALS;
}

export function getQuantityDecimalPlaces(
    quantity: number,
    sizeDecimals?: number
): number {
    if (isSupportedDecimalCount(sizeDecimals)) return sizeDecimals;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 1000) return 0;
    if (quantity >= 1) return 2;

    const magnitude = Math.floor(Math.log10(quantity));
    return Math.min(
        MAX_SUPPORTED_DECIMALS,
        Math.max(0, FALLBACK_SIGNIFICANT_DIGITS - magnitude - 1)
    );
}

function toPlainDecimal(value: number): string {
    const raw = String(value);
    if (!/[eE]/.test(raw)) return raw;

    const [coefficient, exponentText] = raw.toLowerCase().split('e');
    const exponent = Number(exponentText);
    const [whole, fraction = ''] = coefficient.split('.');
    const digits = `${whole}${fraction}`;
    const decimalIndex = whole.length + exponent;

    if (decimalIndex <= 0) {
        return `0.${'0'.repeat(-decimalIndex)}${digits}`;
    }
    if (decimalIndex >= digits.length) {
        return `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
    }
    return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function truncateDecimal(value: number, decimalPlaces: number): string {
    const [integerPart, fraction = ''] = toPlainDecimal(value).split('.');
    if (decimalPlaces === 0) return integerPart;

    const truncatedFraction = fraction
        .padEnd(decimalPlaces, '0')
        .slice(0, decimalPlaces)
        .replace(/0+$/, '');
    return truncatedFraction.length > 0
        ? `${integerPart}.${truncatedFraction}`
        : integerPart;
}

export function getRoundedQuantity(
    quantity: number,
    sizeDecimals?: number
): RoundedQuantity {
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    const decimalPlaces = getQuantityDecimalPlaces(safeQuantity, sizeDecimals);
    const displayValue = truncateDecimal(safeQuantity, decimalPlaces);

    return {
        roundedValue: Number(displayValue),
        displayValue,
        copyValue: displayValue,
        decimalPlaces,
    };
}
