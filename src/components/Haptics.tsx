import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoHaptics from 'expo-haptics';

const STORAGE_KEY = 'hapticsEnabled';

type HapticsApi = {
    enabled: boolean;
    setEnabled: (next: boolean) => void;
    /** Light bump -- taps that just navigate or open something (a card, a row). */
    light: () => void;
    /** Firmer bump -- a toggle with real weight to it (save/unsave). */
    medium: () => void;
    /** Discrete tick -- picking one of several options (a chip, a segmented control). */
    selection: () => void;
    /** A more serious action (block, report). */
    warning: () => void;
};

const HapticsContext = createContext<HapticsApi | null>(null);

export function useHaptics(): HapticsApi {
    const api = useContext(HapticsContext);
    if (!api) throw new Error('useHaptics must be used inside HapticsProvider');
    return api;
}

export function HapticsProvider({ children }: { children: ReactNode }) {
    const [enabled, setEnabledState] = useState(true);

    useEffect(() => {
        AsyncStorage.getItem(STORAGE_KEY)
            .then((stored) => {
                if (stored === 'false') setEnabledState(false);
            })
            .catch(() => {});
    }, []);

    const setEnabled = useCallback((next: boolean) => {
        setEnabledState(next);
        AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => {});
    }, []);

    // Fire-and-forget: a missing vibration motor or a denied OS permission
    // should never throw into whatever onPress triggered it.
    const fire = useCallback(
        (run: () => Promise<void>) => {
            if (!enabled) return;
            run().catch(() => {});
        },
        [enabled],
    );

    const api = useMemo<HapticsApi>(
        () => ({
            enabled,
            setEnabled,
            light: () => fire(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light)),
            medium: () =>
                fire(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium)),
            selection: () => fire(() => ExpoHaptics.selectionAsync()),
            warning: () =>
                fire(() =>
                    ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning),
                ),
        }),
        [enabled, setEnabled, fire],
    );

    return <HapticsContext.Provider value={api}>{children}</HapticsContext.Provider>;
}

export default HapticsProvider;
