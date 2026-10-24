"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/** Apply the device preference to motion in every route and shared dialog. */
export function MotionProvider({ children }: { children: ReactNode }) {
    return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
