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

// Appearance can report 'unspecified' (no OS-level preference set) alongside
// null/undefined; all three fall back to dark the same way, so this is the
// single place that decides what "no real preference" resolves to.
function toResolvedScheme(scheme: ReturnType<typeof Appearance.getColorScheme>): ResolvedScheme {
    return scheme === 'light' ? 'light' : 'dark';
}

const STORAGE_KEY = 'themeMode';
const PRESET_STORAGE_KEY = 'themePreset';
const CUSTOM_THEMES_ENABLED_KEY = 'customThemesEnabled';

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

// Warm reading light, not a cool mirror of dark: a soft paper-cream page
// (not stark white) and warm ink instead of blue-gray, closer to a reading
// app than a dashboard. Every alpha step here is contrast-checked against the
// surface it actually renders on (4.5:1+ for text; see the design canvas
// this was picked from for the worked-out ratios) rather than reused from
// the old cool palette.
const lightTheme = {
    dark: false as const,
    bg: '#FAF6F0',
    surface: '#FFFDF9',
    elevated: '#FFFDF9',
    border: 'rgba(60, 40, 20, 0.09)',
    border_strong: 'rgba(60, 40, 20, 0.16)',
    text: 'rgba(35, 25, 16, 0.95)',
    text_secondary: 'rgba(41, 30, 20, 0.70)',
    // Was 0.55 (~3.7:1, fails 4.5:1 on the warm cream surface); 0.63 clears it.
    text_tertiary: 'rgba(41, 30, 20, 0.63)',
    // Amber-700, picked from the design canvas's accent-option pass -- warm,
    // reads like a reading lamp against the cream page. 4.9:1 on the card.
    accent: '#B45309',
    accent_soft: 'rgba(180, 83, 9, 0.10)',
    accent_border: 'rgba(180, 83, 9, 0.24)',
    on_accent: '#FFFFFF',
    // red-500 is 3.3:1 on white; red-600 clears it.
    danger: '#DC2626',
    danger_soft: 'rgba(220, 38, 38, 0.09)',
    card_shadow: {
        shadowColor: '#231910',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 24,
        elevation: 6,
    } as ShadowStyle,
    card_top: 'transparent',
    scrim: 'rgba(250, 246, 240, 0.88)',
    tab_bg: 'rgba(255, 253, 249, 0.90)',
    tab_border: 'rgba(60, 40, 20, 0.12)',
    tab_glint: 'rgba(255, 253, 249, 0.70)',
    tab_shadow_opacity: 0.16,
};

export type Theme = Omit<typeof darkTheme, 'dark'> & { dark: boolean };

// Gruvbox, warm and paper-like rather than a cool "hacker" dark -- picked
// for readers who want a book-app feel. Same contrast bar as the two themes
// above: every text/surface pairing here is checked at 4.5:1+.
const gruvboxDark = {
    dark: true as const,
    bg: '#282828',
    surface: '#3C3836',
    elevated: '#504945',
    border: 'rgba(235, 219, 178, 0.09)',
    border_strong: 'rgba(235, 219, 178, 0.16)',
    text: 'rgba(235, 219, 178, 0.92)',
    text_secondary: '#BDAE93',
    text_tertiary: '#A89984',
    accent: '#83A598',
    accent_soft: 'rgba(131, 165, 152, 0.14)',
    accent_border: 'rgba(131, 165, 152, 0.28)',
    on_accent: '#1D2021',
    danger: '#FB4934',
    danger_soft: 'rgba(251, 73, 52, 0.13)',
    card_shadow: null as ShadowStyle,
    card_top: 'rgba(235, 219, 178, 0.05)',
    scrim: 'rgba(40, 40, 40, 0.86)',
    tab_bg: 'rgba(80, 73, 69, 0.72)',
    tab_border: 'rgba(235, 219, 178, 0.16)',
    tab_glint: 'rgba(235, 219, 178, 0.07)',
    tab_shadow_opacity: 0.45,
};

const gruvboxLight = {
    dark: false as const,
    bg: '#FBF1C7',
    surface: '#F9F5D7',
    elevated: '#F9F5D7',
    border: 'rgba(60, 56, 54, 0.12)',
    border_strong: 'rgba(60, 56, 54, 0.20)',
    text: 'rgba(60, 56, 54, 0.95)',
    text_secondary: '#504945',
    text_tertiary: '#71655A',
    accent: '#076678',
    accent_soft: 'rgba(7, 102, 120, 0.12)',
    accent_border: 'rgba(7, 102, 120, 0.26)',
    on_accent: '#FBF1C7',
    danger: '#9D0006',
    danger_soft: 'rgba(157, 0, 6, 0.10)',
    card_shadow: {
        shadowColor: '#3C3836',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 24,
        elevation: 6,
    } as ShadowStyle,
    card_top: 'transparent',
    scrim: 'rgba(251, 241, 199, 0.88)',
    tab_bg: 'rgba(249, 245, 215, 0.90)',
    tab_border: 'rgba(60, 56, 54, 0.15)',
    tab_glint: 'rgba(249, 245, 215, 0.70)',
    tab_shadow_opacity: 0.16,
};

export type ThemePreset = 'default' | 'gruvbox';

// Additive layer on top of the light/dark resolution above: a preset picks
// which pair of Theme objects 'light'/'dark' resolve to. Exported whole so
// Profile's swatch picker can read each preset's dark.bg/light.bg directly.
export const THEME_PRESETS: Record<ThemePreset, { dark: Theme; light: Theme }> = {
    default: { dark: darkTheme, light: lightTheme },
    gruvbox: { dark: gruvboxDark, light: gruvboxLight },
};

export const THEME_PRESET_META: { id: ThemePreset; label: string }[] = [
    { id: 'default', label: 'Default' },
    { id: 'gruvbox', label: 'Gruvbox' },
];

type ThemeApi = {
    mode: ThemeMode;
    theme: Theme;
    setMode: (next: ThemeMode) => void;
    preset: ThemePreset;
    setPreset: (next: ThemePreset) => void;
    customThemesEnabled: boolean;
    setCustomThemesEnabled: (next: boolean) => void;
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

/** Same split as useThemeMode() above, for the preset gate + picker. */
export function useThemePreset(): {
    preset: ThemePreset;
    setPreset: (next: ThemePreset) => void;
    customThemesEnabled: boolean;
    setCustomThemesEnabled: (next: boolean) => void;
} {
    const api = useContext(ThemeContext);
    if (!api) throw new Error('useThemePreset must be used inside ThemeProvider');
    return {
        preset: api.preset,
        setPreset: api.setPreset,
        customThemesEnabled: api.customThemesEnabled,
        setCustomThemesEnabled: api.setCustomThemesEnabled,
    };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    // Dark is the default for both a fresh install and an existing one --
    // the app has only ever been dark, so "system" would silently flip it
    // light for anyone whose phone happens to be in light mode.
    const [mode, setModeState] = useState<ThemeMode>('dark');
    const [systemScheme, setSystemScheme] = useState<ResolvedScheme>(() =>
        toResolvedScheme(Appearance.getColorScheme()),
    );
    // 'default' until proven otherwise -- casual users never see anything
    // but today's dark/light/system, since resolution below falls back to
    // 'default' whenever the gate is off regardless of the stored preset.
    const [preset, setPresetState] = useState<ThemePreset>('default');
    const [customThemesEnabled, setCustomThemesEnabledState] = useState(false);

    useEffect(() => {
        (async () => {
            const stored = await AsyncStorage.getItem(STORAGE_KEY);
            if (stored === 'light' || stored === 'dark' || stored === 'system') {
                setModeState(stored);
            }
            const storedPreset = await AsyncStorage.getItem(PRESET_STORAGE_KEY);
            if (storedPreset === 'default' || storedPreset === 'gruvbox') {
                setPresetState(storedPreset);
            }
            const storedEnabled = await AsyncStorage.getItem(CUSTOM_THEMES_ENABLED_KEY);
            if (storedEnabled !== null) {
                setCustomThemesEnabledState(storedEnabled === 'true');
            }
        })();
    }, []);

    // Only matters in 'system' mode, but cheap enough to keep subscribed
    // always rather than mount/unmount the listener as mode changes.
    useEffect(() => {
        const sub = Appearance.addChangeListener(({ colorScheme }) => {
            setSystemScheme(toResolvedScheme(colorScheme));
        });
        return () => sub.remove();
    }, []);

    const setMode = useCallback((next: ThemeMode) => {
        setModeState(next);
        AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    }, []);

    const setPreset = useCallback((next: ThemePreset) => {
        setPresetState(next);
        AsyncStorage.setItem(PRESET_STORAGE_KEY, next).catch(() => {});
    }, []);

    const setCustomThemesEnabled = useCallback((next: boolean) => {
        setCustomThemesEnabledState(next);
        AsyncStorage.setItem(CUSTOM_THEMES_ENABLED_KEY, next ? 'true' : 'false').catch(() => {});
    }, []);

    const resolved: ResolvedScheme = mode === 'system' ? systemScheme : mode;
    // Turning the gate off always reverts to 'default' immediately, without
    // losing the user's stored preset choice for whenever they re-enable it.
    const resolvedPreset: ThemePreset = customThemesEnabled ? preset : 'default';
    const theme = THEME_PRESETS[resolvedPreset][resolved];

    const api = useMemo<ThemeApi>(
        () => ({
            mode,
            theme,
            setMode,
            preset,
            setPreset,
            customThemesEnabled,
            setCustomThemesEnabled,
        }),
        [mode, theme, setMode, preset, setPreset, customThemesEnabled, setCustomThemesEnabled],
    );

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

/** A darker step of the same hue: scaling all three channels holds the hue. */
export function shadeHex(hex: string, factor: number): string {
    const h = hex.replace('#', '');
    const channel = (start: number) =>
        Math.max(0, Math.min(255, Math.round(parseInt(h.slice(start, start + 2), 16) * factor)))
            .toString(16)
            .padStart(2, '0');
    return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** The accent gradient the primary buttons paint themselves with. */
export function accentGradient(theme: Theme): [string, string] {
    return [theme.accent, shadeHex(theme.accent, 0.82)];
}

export function getTopicColor(topic: string, theme: Theme) {
    const hue = TOPIC_HUES[topic];
    const color = hue ? (theme.dark ? hue.dark : hue.light) : theme.accent;
    // Light pills read a touch washed out at the old 0.1 against the warm
    // cream surface; 0.14 gives them the same visual weight as dark's 0.13.
    return { color, bg: hexToRgba(color, theme.dark ? 0.13 : 0.14) };
}
