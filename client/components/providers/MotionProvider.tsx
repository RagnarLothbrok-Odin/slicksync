'use client';

import { MotionConfig } from 'framer-motion';
import { ReactNode } from 'react';

/** Apply the device preference to motion in every route and shared dialog. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ type: 'spring', bounce: 0, duration: 0.3 }}>{children}</MotionConfig>;
}
