'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

export interface OverlayRect {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
}

export interface OverlayLine {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    width: number;
    dash?: string;
    opacity?: number;
}

export interface OverlayText {
    id: string;
    x: number;
    y: number;
    text: string;
    color: string;
    size?: number;
    weight?: number;
}

export interface OverlayCircle {
    id: string;
    x: number;
    y: number;
    radius: number;
    fill: string;
    stroke?: string;
}

export interface OverlayModel {
    width: number;
    height: number;
    rects: OverlayRect[];
    lines: OverlayLine[];
    texts: OverlayText[];
    circles: OverlayCircle[];
}

export interface OverlayHandle {
    setModel: (model: OverlayModel) => void;
}

const EMPTY_MODEL: OverlayModel = {
    width: 1,
    height: 1,
    rects: [],
    lines: [],
    texts: [],
    circles: [],
};

const ChartOverlaySvg = forwardRef<OverlayHandle>(function ChartOverlaySvg(_, ref) {
    const [overlay, setOverlay] = useState<OverlayModel>(EMPTY_MODEL);

    useImperativeHandle(ref, () => ({ setModel: setOverlay }), []);

    return (
        <svg
            className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
            viewBox={`0 0 ${Math.max(overlay.width, 1)} ${Math.max(overlay.height, 1)}`}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <defs>
                <pattern
                    id="chart-event-zone-hatch"
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                >
                    <path
                        d="M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6"
                        fill="none"
                        stroke="#cbd5e1"
                        strokeWidth="1"
                        strokeOpacity="0.32"
                    />
                </pattern>
            </defs>
            {overlay.rects.map((rect) => (
                <rect
                    key={rect.id}
                    data-overlay-id={rect.id}
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    fill={rect.fill}
                />
            ))}
            {overlay.lines.map((line) => (
                <line
                    key={line.id}
                    data-overlay-id={line.id}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke={line.color}
                    strokeWidth={line.width}
                    strokeDasharray={line.dash}
                    strokeOpacity={line.opacity}
                />
            ))}
            {overlay.texts.map((item) => (
                <text
                    key={item.id}
                    data-overlay-id={item.id}
                    data-chart-signal-level={item.id.startsWith('signal-') ? item.text : undefined}
                    x={item.x}
                    y={item.y}
                    fill={item.color}
                    fontSize={item.size ?? 10}
                    fontWeight={item.weight}
                >
                    {item.text}
                </text>
            ))}
            {overlay.circles.map((circle) => (
                <circle
                    key={circle.id}
                    data-overlay-id={circle.id}
                    cx={circle.x}
                    cy={circle.y}
                    r={circle.radius}
                    fill={circle.fill}
                    stroke={circle.stroke}
                    strokeWidth={circle.stroke ? 1 : 0}
                />
            ))}
        </svg>
    );
});

export default ChartOverlaySvg;
