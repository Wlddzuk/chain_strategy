'use client';

import { type KeyboardEvent, useRef } from 'react';

export interface SegmentedOption<Value extends string> {
    value: Value;
    label: string;
    count?: number;
}

interface SegmentedControlProps<Value extends string> {
    label: string;
    idPrefix: string;
    options: ReadonlyArray<SegmentedOption<Value>>;
    value: Value;
    onChange: (value: Value) => void;
}

/** iOS-style segmented tabs: one sliding thumb, arrow-key navigation, tab semantics. */
export function SegmentedControl<Value extends string>({
    label,
    idPrefix,
    options,
    value,
    onChange,
}: SegmentedControlProps<Value>) {
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const nextIndex = (selectedIndex + step + options.length) % options.length;
        onChange(options[nextIndex].value);
        buttonRefs.current[nextIndex]?.focus();
    };

    return (
        <div
            role="tablist"
            aria-label={label}
            onKeyDown={handleKeyDown}
            className="segmented"
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
            <span
                aria-hidden="true"
                className="segmented-thumb"
                style={{
                    width: `calc((100% - 8px) / ${options.length})`,
                    transform: `translateX(${selectedIndex * 100}%)`,
                }}
            />
            {options.map((option, index) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        ref={(element) => { buttonRefs.current[index] = element; }}
                        type="button"
                        role="tab"
                        id={`${idPrefix}-tab-${option.value}`}
                        aria-selected={selected}
                        aria-controls={`${idPrefix}-panel`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(option.value)}
                        className="segmented-item"
                    >
                        <span className="truncate">{option.label}</span>
                        {option.count !== undefined && option.count > 0 && (
                            <span className="segmented-count">{option.count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
