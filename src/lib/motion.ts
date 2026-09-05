export type MotionPreference = 'snappy' | 'default' | 'off';

export const MOTION_SCALE: Record<MotionPreference, number> = {
    snappy: 0.5,
    default: 1,
    off: 0,
};

export function scaleMs(scale: number, base: number): number {
    return Math.round(base * scale);
}

// Reanimated's entering builders don't treat duration(0) as "instant, skip
// it" -- they still register the animation. Omitting `entering` entirely is
// the only way to get a true no-op, so callers branch on this at zero scale.
export function withMotion<T>(scale: number, build: () => T): T | undefined {
    return scale === 0 ? undefined : build();
}

type SpringConfig = { damping: number; stiffness: number; mass?: number };

// Scales a physical spring's settling time by `scale` while holding its
// damping ratio (and therefore its overshoot/feel) constant:
// stiffness sets the natural frequency (omega0 = sqrt(stiffness/mass)), so
// dividing it by scale^2 divides the settling time by scale; dividing
// damping by scale keeps the damping ratio -- and so the shape of the
// curve -- unchanged.
export function scaleSpring(scale: number, config: SpringConfig): SpringConfig {
    return {
        ...config,
        stiffness: config.stiffness / (scale * scale),
        damping: config.damping / scale,
    };
}
