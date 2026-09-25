export function focusStrategyChart(): void {
    requestAnimationFrame(() => {
        document.getElementById('strategy-chart')?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });
    });
}
