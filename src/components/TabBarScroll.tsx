import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useMotion } from '@/components/Motion';
import { scaleSpring } from '@/lib/motion';

const SETTLE_SPRING = { damping: 22, stiffness: 210, mass: 0.7 };

// Scroll distance for a full expand<->collapse traversal.
const COLLAPSE_RANGE = 70;

type ScrollHandler = (event: NativeSyntheticEvent<NativeScrollEvent>) => void;

type TabBarScrollApi = {
    /** 0 = expanded, 1 = collapsed. Read this from an animated style. */
    collapse: SharedValue<number>;
    /** Spread onto a scrollable screen's FlatList/ScrollView `onScroll`. */
    onScroll: ScrollHandler;
    /**
     * Spread all three onto the same list -- they work as a set. A drag can
     * end with (`onMomentumScrollBegin`/`onMomentumScrollEnd` follow) or
     * without (neither fires) a following momentum phase, and only settling
     * once either way needs all three wired together.
     */
    settleHandlers: {
        onScrollBeginDrag: ScrollHandler;
        onScrollEndDrag: ScrollHandler;
        onMomentumScrollBegin: ScrollHandler;
        onMomentumScrollEnd: ScrollHandler;
    };
};

const TabBarScrollContext = createContext<TabBarScrollApi | null>(null);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// Mounted once around the tab navigator (see app/(tabs)/_layout.tsx) so every
// screen's scroll feeds the same shared value the tab bar animates from.
export function TabBarScrollProvider({ children }: { children: ReactNode }) {
    const collapse = useSharedValue(0);
    const lastY = useRef(0);
    const nearTop = useRef(true);
    const pendingSettle = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { scale } = useMotion();

    const api = useMemo<TabBarScrollApi>(() => {
        const settleTo = (value: number) => {
            collapse.value =
                scale === 0 ? value : withSpring(value, scaleSpring(scale, SETTLE_SPRING));
        };
        const settleNearest = (y: number) => settleTo(y < 24 ? 0 : collapse.value > 0.5 ? 1 : 0);
        const clearPending = () => {
            if (pendingSettle.current) {
                clearTimeout(pendingSettle.current);
                pendingSettle.current = null;
            }
        };

        return {
            collapse,
            onScroll: (event) => {
                const y = event.nativeEvent.contentOffset.y;
                const delta = y - lastY.current;
                lastY.current = y;

                if (y < 24) {
                    // Edge-triggered so the spring doesn't restart every frame.
                    if (!nearTop.current) settleTo(0);
                    nearTop.current = true;
                    return;
                }
                nearTop.current = false;

                if (Math.abs(delta) > 250) return; // elastic overscroll spike

                collapse.value = clamp01(collapse.value + delta / COLLAPSE_RANGE);
            },
            settleHandlers: {
                // A new drag starting before a deferred settle below has
                // fired (e.g. a quick second flick) should cancel it -- it's
                // about to be overtaken by fresh onScroll writes anyway.
                onScrollBeginDrag: clearPending,
                // A drag that's about to hand off to momentum shouldn't
                // settle yet -- momentum's own onScroll frames would fight
                // this spring. But momentum doesn't always follow a drag, so
                // defer briefly and let onMomentumScrollBegin cancel it if
                // momentum does show up; otherwise it fires for us.
                onScrollEndDrag: (event) => {
                    const y = event.nativeEvent.contentOffset.y;
                    clearPending();
                    pendingSettle.current = setTimeout(() => {
                        pendingSettle.current = null;
                        settleNearest(y);
                    }, 50);
                },
                onMomentumScrollBegin: clearPending,
                onMomentumScrollEnd: (event) => {
                    clearPending();
                    settleNearest(event.nativeEvent.contentOffset.y);
                },
            },
        };
    }, [collapse, scale]);

    // A deferred settle firing after this provider unmounts (e.g. the tab
    // group unmounts mid-gesture, on sign-out) would write to a collapse
    // value nothing is reading anymore.
    useEffect(() => {
        return () => {
            if (pendingSettle.current) clearTimeout(pendingSettle.current);
        };
    }, []);

    return <TabBarScrollContext.Provider value={api}>{children}</TabBarScrollContext.Provider>;
}

export function useTabBarScroll(): TabBarScrollApi {
    const api = useContext(TabBarScrollContext);
    if (!api) throw new Error('useTabBarScroll must be used inside TabBarScrollProvider');
    return api;
}
