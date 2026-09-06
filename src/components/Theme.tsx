import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'themeMode';

type ShadowStyle = {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
} | null;

// Lifted dark, not OLED: a card can't lift off pure black. `elevated` is the
// sheet/tab-pill/chip layer (the design's `surface-2`) -- one step up from
// `surface`, which is the card itself.
const darkTheme = {
    dark: true as const,
    bg: '#12151B',
    surface: '#1A1E26',
    elevated: '#222732',
    border: 'rgba(255, 255, 255, 0.07)',
    border_strong: 'rgba(255, 255, 255, 0.13)',
    text: 'rgba(255, 255, 255, 0.93)',
    text_secondary: 'rgba(255, 255, 255, 0.58)',
    // Was 0.28 (2.3:1, fails 4.5:1); 0.46 clears it at 4.6:1.
    text_tertiary: 'rgba(255, 255, 255, 0.46)',
    accent: '#06B6D4',
    accent_soft: 'rgba(6, 182, 212, 0.13)',
    accent_border: 'rgba(6, 182, 212, 0.26)',
    // White text on the cyan fill is 2.4:1; dark ink clears it.
    on_accent: '#06222B',
    danger: '#EF4444',
    danger_soft: 'rgba(239, 68, 68, 0.13)',
    card_shadow: null as ShadowStyle,
    card_top: 'rgba(255, 255, 255, 0.05)',
    scrim: 'rgba(18, 21, 27, 0.86)',
    tab_bg: 'rgba(34, 39, 50, 0.72)',
    tab_border: 'rgba(255, 255, 255, 0.13)',
    tab_glint: 'rgba(255, 255, 255, 0.07)',
    tab_shadow_opacity: 0.45,
};

// Not a mirror of dark: the page has to sit behind white cards, and the
// tertiary text step gets *heavier* here (0.60) rather than lighter.
const lightTheme = {
    dark: false as const,
    bg: '#F4F6F8',
    surface: '#FFFFFF',
    elevated: '#FFFFFF',
    border: 'rgba(15, 23, 32, 0.08)',
    border_strong: 'rgba(15, 23, 32, 0.14)',
    text: 'rgba(15, 23, 32, 0.94)',
    text_secondary: 'rgba(15, 23, 32, 0.72)',
    text_tertiary: 'rgba(15, 23, 32, 0.60)',
    // #06B6D4 is 2.4:1 on white; cyan-700 clears it.
    accent: '#0E7490',
    accent_soft: 'rgba(14, 116, 144, 0.09)',
    accent_border: 'rgba(14, 116, 144, 0.20)',
    on_accent: '#FFFFFF',
    // red-500 is 3.3:1 on white; red-600 clears it.
    danger: '#DC2626',
    danger_soft: 'rgba(220, 38, 38, 0.09)',
    card_shadow: {
        shadowColor: '#0F1720',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 24,
        elevation: 6,
    } as ShadowStyle,
    card_top: 'transparent',
    scrim: 'rgba(244, 246, 248, 0.88)',
    tab_bg: 'rgba(255, 255, 255, 0.80)',
    tab_border: 'rgba(15, 23, 32, 0.10)',
    tab_glint: 'rgba(255, 255, 255, 0.85)',
    tab_shadow_opacity: 0.16,
};

export type Theme = Omit<typeof darkTheme, 'dark'> & { dark: boolean };

type ThemeApi = {
    mode: ThemeMode;
    theme: Theme;
    setMode: (next: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeApi | null>(null);

export function useTheme(): Theme {
    const api = useContext(ThemeContext);
    if (!api) throw new Error('useTheme must be used inside ThemeProvider');
    return api.theme;
}

/** Separate from useTheme() so the ~dozen screens that only read tokens don't
 * also re-render every time the mode itself is what's being edited (the
 * appearance picker in the feed-options sheet). */
export function useThemeMode(): { mode: ThemeMode; setMode: (next: ThemeMode) => void } {
    const api = useContext(ThemeContext);
    if (!api) throw new Error('useThemeMode must be used inside ThemeProvider');
    return { mode: api.mode, setMode: api.setMode };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    // Dark is the default for both a fresh install and an existing one --
    // the app has only ever been dark, so "system" would silently flip it
    // light for anyone whose phone happens to be in light mode.
    const [mode, setModeState] = useState<ThemeMode>('dark');
    const [systemScheme, setSystemScheme] = useState<ResolvedScheme>(
        () => Appearance.getColorScheme() ?? 'dark',
    );

    useEffect(() => {
        (async () => {
            const stored = await AsyncStorage.getItem(STORAGE_KEY);
            if (stored === 'light' || stored === 'dark' || stored === 'system') {
                setModeState(stored);
            }
        })();
    }, []);

    // Only matters in 'system' mode, but cheap enough to keep subscribed
    // always rather than mount/unmount the listener as mode changes.
    useEffect(() => {
        const sub = Appearance.addChangeListener(({ colorScheme }) => {
            setSystemScheme(colorScheme ?? 'dark');
        });
        return () => sub.remove();
    }, []);

    const setMode = useCallback((next: ThemeMode) => {
        setModeState(next);
        AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    }, []);

    const resolved: ResolvedScheme = mode === 'system' ? systemScheme : mode;
    const theme = resolved === 'light' ? lightTheme : darkTheme;

    const api = useMemo<ThemeApi>(() => ({ mode, theme, setMode }), [mode, theme, setMode]);

    return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

// dark(400)/light(700) per topic -- one rule instead of sixteen decisions.
// Each hue keeps its identity and just moves down the Tailwind scale for
// contrast on a white card.
const TOPIC_HUES: Record<string, { dark: string; light: string }> = {
    'Artificial Intelligence': { dark: '#60A5FA', light: '#1D4ED8' },
    'Machine Learning': { dark: '#A78BFA', light: '#6D28D9' },
    Apple: { dark: '#F472B6', light: '#BE185D' },
    Microsoft: { dark: '#34D399', light: '#047857' },
    Amazon: { dark: '#FBBF24', light: '#B45309' },
    Google: { dark: '#4ADE80', light: '#15803D' },
    Gaming: { dark: '#FB923C', light: '#C2410C' },
    Cybersecurity: { dark: '#F87171', light: '#B91C1C' },
    'Game development': { dark: '#C084FC', light: '#7E22CE' },
    Nintendo: { dark: '#E879F9', light: '#A21CAF' },
    'Space Tech': { dark: '#818CF8', light: '#4338CA' },
    Startups: { dark: '#FB7185', light: '#BE123C' },
    Blockchain: { dark: '#FACC15', light: '#A16207' },
    Robotics: { dark: '#22D3EE', light: '#0E7490' },
    Technology: { dark: '#2DD4BF', light: '#0F766E' },
    Top: { dark: '#2DD4BF', light: '#0F766E' },
};

export function hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getTopicColor(topic: string, theme: Theme) {
    const hue = TOPIC_HUES[topic];
    const color = hue ? (theme.dark ? hue.dark : hue.light) : theme.accent;
    return { color, bg: hexToRgba(color, theme.dark ? 0.13 : 0.1) };
}
