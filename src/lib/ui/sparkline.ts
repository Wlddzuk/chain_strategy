/**
 * SVG path for a sparkline that fills a width x height box. Returns null when
 * there are fewer than two finite values to connect.
 */
export function buildSparklinePath(
    values: readonly number[],
    width: number,
    height: number
): string | null {
    const points = values.filter(Number.isFinite);
    if (points.length < 2 || width <= 0 || height <= 0) return null;

    const minimum = Math.min(...points);
    const range = Math.max(...points) - minimum;
    const step = width / (points.length - 1);

    return points
        .map((value, index) => {
            // A flat series sits on the midline instead of dividing by zero.
            const y = range === 0 ? height / 2 : height - ((value - minimum) / range) * height;
            return `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' ');
}
