const TWO_DECIMAL_THRESHOLD = 10;
const FOUR_DECIMAL_THRESHOLD = 0.1;

const twoDecimalFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const fourDecimalFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
});

const subDollarFormatter = new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 5,
});

export function formatPrice(price: number): string {
    const absolutePrice = Math.abs(price);

    if (absolutePrice >= TWO_DECIMAL_THRESHOLD) {
        return twoDecimalFormatter.format(price);
    }

    if (absolutePrice >= FOUR_DECIMAL_THRESHOLD) {
        return fourDecimalFormatter.format(price);
    }

    return subDollarFormatter.format(price);
}
