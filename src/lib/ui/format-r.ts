export function formatRMultiple(value: number): string {
    if (value > 0) return `+${value.toFixed(1)}`;
    if (value < 0) return `−${Math.abs(value).toFixed(1)}`;
    return '0.0';
}

export function getRToneClass(value: number): string {
    if (value > 0) return 'text-[var(--long-green)]';
    if (value < 0) return 'text-[var(--short-red)]';
    return '';
}
