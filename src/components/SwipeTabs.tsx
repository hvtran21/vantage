import { Gesture } from 'react-native-gesture-handler';
import { useNavigation } from 'expo-router';
import { useHaptics } from '@/components/Haptics';

// Matches the Tabs.Screen order in app/(tabs)/_layout.tsx, which is also
// the tab bar's left-to-right order.
const TAB_ORDER = ['index', 'profile', 'saved'] as const;
export type TabName = (typeof TAB_ORDER)[number];

// A slow, deliberate drag past the distance threshold works the same as a
// quick flick that never travels far enough to trip it.
const DISTANCE_THRESHOLD = 60;
const VELOCITY_THRESHOLD = 800;

/**
 * Horizontal swipe-to-switch-tabs, mirroring the tab bar's own tap-to-navigate
 * (navigation.navigate, not router.push, so it switches focus instead of
 * stacking a new history entry).
 */
export function useSwipeTabGesture(current: TabName) {
    const navigation = useNavigation();
    const haptics = useHaptics();
    const index = TAB_ORDER.indexOf(current);

    return (
        Gesture.Pan()
            // Only claims the gesture once it's clearly horizontal, so vertical
            // list scrolling underneath it still works normally.
            .activeOffsetX([-20, 20])
            .failOffsetY([-15, 15])
            .runOnJS(true)
            .onEnd((event) => {
                const passedThreshold =
                    Math.abs(event.translationX) > DISTANCE_THRESHOLD ||
                    Math.abs(event.velocityX) > VELOCITY_THRESHOLD;
                if (!passedThreshold) return;

                const next = TAB_ORDER[event.translationX < 0 ? index + 1 : index - 1];
                if (!next) return;

                haptics.selection();
                navigation.navigate(next as never);
            })
    );
}
