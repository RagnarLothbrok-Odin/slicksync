"use client";

// The Jellyfin mark: an outer and an inner rounded triangle in its purple
// (#AA5CC3) to blue (#00A4DC) gradient. Each copy gets its own gradient id,
// so several on one page don't share (or lose) theirs.

import { useId } from "react";

export function JellyfinLogo({ size = 26 }: { size?: number }) {
    const id = `jf-${useId().replace(/:/g, "")}`;
    return (
        <svg
            aria-hidden="true"
            height={size}
            viewBox="0 0 512 512"
            width={size}
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id={id} x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0" stopColor="#AA5CC3" />
                    <stop offset="1" stopColor="#00A4DC" />
                </linearGradient>
            </defs>
            <path
                d="M256 196.2c-22.4 0-94.8 131.3-83.8 153.4s156.8 21.9 167.7 0-61.3-153.4-83.9-153.4z"
                fill={`url(#${id})`}
            />
            <path
                d="M256 0C188.3 0-29.8 395.4 3.4 462.2s472.3 66 505.2 0S323.8 0 256 0zm165.6 404.3c-21.6 43.2-309.3 43.8-331.1 0S211.7 101.4 256 101.4 443.2 361 421.6 404.3z"
                fill={`url(#${id})`}
            />
        </svg>
    );
}
