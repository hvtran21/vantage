import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOTION_SCALE, type MotionPreference } from '@/lib/motion';

const STORAGE_KEY = 'motionPreference';

type MotionApi = {
    preference: MotionPreference;
    scale: number;
    setPreference: (next: MotionPreference) => void;
};

const MotionContext = createContext<MotionApi | null>(null);

export function useMotion(): MotionApi {
    const api = useContext(MotionContext);
    if (!api) throw new Error('useMotion must be used inside MotionProvider');
    return api;
}

export function MotionProvider({ children }: { children: ReactNode }) {
    const [preference, setPreferenceState] = useState<MotionPreference>('default');

    // A stored preference always wins. Only a first launch -- nothing in
    // AsyncStorage yet -- falls back to the OS-level reduce-motion setting.
    useEffect(() => {
        (async () => {
            const stored = await AsyncStorage.getItem(STORAGE_KEY);
            if (stored === 'snappy' || stored === 'default' || stored === 'off') {
                setPreferenceState(stored);
                return;
            }
            const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
            setPreferenceState(reduceMotion ? 'off' : 'default');
        })();
    }, []);

    const setPreference = useCallback((next: MotionPreference) => {
        setPreferenceState(next);
        AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    }, []);

    const api = useMemo<MotionApi>(
        () => ({ preference, scale: MOTION_SCALE[preference], setPreference }),
        [preference, setPreference],
    );

    return <MotionContext.Provider value={api}>{children}</MotionContext.Provider>;
}

export default MotionProvider;
