import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useMotion } from '@/components/Motion';
import { scaleSpring } from '@/lib/motion';

const COLLAPSE_SPRING = { damping: 22, stiffness: 210, mass: 0.7 };

// Net scroll distance in one direction before the bar flips state -- keeps a
// single jittery frame (a momentum correction, a small overscroll wobble)
// from toggling it back and forth.
const THRESHOLD = 16;

type TabBarScrollApi = {
    /** 0 = expanded, 1 = collapsed. Read this from an animated style. */
    collapse: SharedValue<number>;
    /** Spread onto a scrollable screen's FlatList/ScrollView `onScroll`. */
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

const TabBarScrollContext = createContext<TabBarScrollApi | null>(null);

// Mounted once around the tab navigator (see app/(tabs)/_layout.tsx) so every
// screen's scroll feeds the same shared value the tab bar animates from.
export function TabBarScrollProvider({ children }: { children: ReactNode }) {
    const collapse = useSharedValue(0);
    const lastY = useRef(0);
    const accumulated = useRef(0);
    const { scale } = useMotion();

    const api = useMemo<TabBarScrollApi>(() => {
        // Motion "off" (scale 0) would divide COLLAPSE_SPRING's stiffness and
        // damping by zero -- jump straight to the target instead of animating.
        const setCollapse = (value: number) => {
            collapse.value =
                scale === 0 ? value : withSpring(value, scaleSpring(scale, COLLAPSE_SPRING));
        };

        return {
            collapse,
            onScroll: (event) => {
                const y = event.nativeEvent.contentOffset.y;
                const delta = y - lastY.current;
                lastY.current = y;

                // Always expanded near the top -- nothing to shrink away from
                // yet, and it shouldn't still be collapsed once you're back.
                if (y < 24) {
                    if (collapse.value !== 0) setCollapse(0);
                    accumulated.current = 0;
                    return;
                }

                // Elastic overscroll past the bottom reports huge single-frame
                // deltas; ignore anything outside a plausible per-frame scroll
                // (screens attach this at scrollEventThrottle={16}, ~60fps).
                if (Math.abs(delta) > 250) return;

                accumulated.current += delta;
                if (accumulated.current > THRESHOLD) {
                    setCollapse(1);
                    accumulated.current = 0;
                } else if (accumulated.current < -THRESHOLD) {
                    setCollapse(0);
                    accumulated.current = 0;
                }
            },
        };
    }, [collapse, scale]);

    return <TabBarScrollContext.Provider value={api}>{children}</TabBarScrollContext.Provider>;
}

export function useTabBarScroll(): TabBarScrollApi {
    const api = useContext(TabBarScrollContext);
    if (!api) throw new Error('useTabBarScroll must be used inside TabBarScrollProvider');
    return api;
}
