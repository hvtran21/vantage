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

// dark(400)/light(700) per topic -- one rule instead of sixteen decisions.
// Each hue keeps its identity and just moves down the Tailwind scale for
// contrast on a white card.
const DEFAULT_HUES_DARK: Record<string, string> = {
    'Artificial Intelligence': '#60A5FA',
    'Machine Learning': '#A78BFA',
    Apple: '#F472B6',
    Microsoft: '#34D399',
    Amazon: '#FBBF24',
    Google: '#4ADE80',
    Gaming: '#FB923C',
    Cybersecurity: '#F87171',
    'Game development': '#C084FC',
    Nintendo: '#E879F9',
    'Space Tech': '#818CF8',
    Startups: '#FB7185',
    Blockchain: '#FACC15',
    Robotics: '#22D3EE',
    Technology: '#2DD4BF',
    Top: '#2DD4BF',
};

const DEFAULT_HUES_LIGHT: Record<string, string> = {
    'Artificial Intelligence': '#1D4ED8',
    'Machine Learning': '#6D28D9',
    Apple: '#BE185D',
    Microsoft: '#047857',
    Amazon: '#B45309',
    Google: '#15803D',
    Gaming: '#C2410C',
    Cybersecurity: '#B91C1C',
    'Game development': '#7E22CE',
    Nintendo: '#A21CAF',
    'Space Tech': '#4338CA',
    Startups: '#BE123C',
    Blockchain: '#A16207',
    Robotics: '#0E7490',
    Technology: '#0F766E',
    Top: '#0F766E',
};

// Gruvbox's own seven hues, cycled so no two neighbours in the genre picker
// match. Four are a step off canonical: on their own tinted pill they sat at
// 3.0-3.6:1, lifted (dark) or deepened (light) to clear 4:1. That's a lower bar
// than body text holds to -- gruvbox is low-contrast on purpose.
const GRUVBOX_HUES_DARK: Record<string, string> = {
    'Artificial Intelligence': '#93AF9E',
    'Machine Learning': '#D997A2',
    Apple: '#8EC07C',
    Microsoft: '#B8BB26',
    Amazon: '#FABD2F',
    Google: '#93AF9E',
    Gaming: '#FE8723',
    Cybersecurity: '#FB876A',
    'Game development': '#D997A2',
    Nintendo: '#FB876A',
    'Space Tech': '#93AF9E',
    Startups: '#8EC07C',
    Blockchain: '#FABD2F',
    Robotics: '#B8BB26',
    Technology: '#8EC07C',
    Top: '#8EC07C',
};

const GRUVBOX_HUES_LIGHT: Record<string, string> = {
    'Artificial Intelligence': '#076678',
    'Machine Learning': '#8F3F71',
    Apple: '#407655',
    Microsoft: '#736E10',
    Amazon: '#906219',
    Google: '#076678',
    Gaming: '#AF3A03',
    Cybersecurity: '#9D0006',
    'Game development': '#8F3F71',
    Nintendo: '#9D0006',
    'Space Tech': '#076678',
    Startups: '#407655',
    Blockchain: '#906219',
    Robotics: '#736E10',
    Technology: '#407655',
    Top: '#407655',
};

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
    topic_hues: DEFAULT_HUES_DARK,
    topic_tint: 0.13,
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
    topic_hues: DEFAULT_HUES_LIGHT,
    topic_tint: 0.14,
};

export type Theme = Omit<typeof darkTheme, 'dark'> & { dark: boolean };

// Gruvbox, warm and paper-like rather than a cool "hacker" dark -- picked
// for readers who want a book-app feel. Same contrast bar as the two themes
// above: every text/surface pairing here is checked at 4.5:1+.
const gruvboxDark = {
    dark: true as const,
    // bg0 / bg1 / bg2 -- gruvbox's own elevation ladder, unchanged.
    bg: '#282828',
    surface: '#3C3836',
    elevated: '#504945',
    border: 'rgba(235, 219, 178, 0.10)',
    border_strong: 'rgba(235, 219, 178, 0.18)',
    // fg1/fg2/fg3, opaque -- these mixed alpha and hex, and fg4 was 4.2:1 on a card.
    text: '#EBDBB2',
    text_secondary: '#D5C4A1',
    text_tertiary: '#BDAE93',
    // Orange, not the old sage: #83A598 at 14% left the selected tab invisible.
    accent: '#FE8019',
    accent_soft: 'rgba(254, 128, 25, 0.16)',
    accent_border: 'rgba(254, 128, 25, 0.34)',
    on_accent: '#282828',
    // Bright red is 3.4:1 on bg1; this lift clears 4.5 while staying in the hue.
    danger: '#FE7A68',
    danger_soft: 'rgba(254, 122, 104, 0.14)',
    card_shadow: null as ShadowStyle,
    card_top: 'rgba(235, 219, 178, 0.06)',
    scrim: 'rgba(29, 32, 33, 0.88)',
    tab_bg: 'rgba(60, 56, 54, 0.82)',
    tab_border: 'rgba(235, 219, 178, 0.18)',
    tab_glint: 'rgba(235, 219, 178, 0.06)',
    tab_shadow_opacity: 0.45,
    topic_hues: GRUVBOX_HUES_DARK,
    topic_tint: 0.1,
};

const gruvboxLight = {
    dark: false as const,
    // bg0_s / bg0 / bg0_h. The page was bg0 with cards on bg0_h -- two values
    // apart, so nothing but the shadow said "card".
    bg: '#F2E5BC',
    surface: '#FBF1C7',
    elevated: '#F9F5D7',
    border: 'rgba(60, 56, 54, 0.14)',
    border_strong: 'rgba(60, 56, 54, 0.22)',
    text: '#3C3836',
    text_secondary: '#504945',
    text_tertiary: '#665C54',
    accent: '#AF3A03',
    accent_soft: 'rgba(175, 58, 3, 0.12)',
    accent_border: 'rgba(175, 58, 3, 0.30)',
    on_accent: '#FBF1C7',
    danger: '#9D0006',
    danger_soft: 'rgba(157, 0, 6, 0.10)',
    card_shadow: {
        shadowColor: '#3C3836',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.14,
        shadowRadius: 24,
        elevation: 6,
    } as ShadowStyle,
    card_top: 'transparent',
    scrim: 'rgba(242, 229, 188, 0.90)',
    tab_bg: 'rgba(249, 245, 215, 0.92)',
    tab_border: 'rgba(60, 56, 54, 0.16)',
    tab_glint: 'rgba(249, 245, 215, 0.70)',
    tab_shadow_opacity: 0.16,
    topic_hues: GRUVBOX_HUES_LIGHT,
    topic_tint: 0.1,
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
    const color = theme.topic_hues[topic] ?? theme.accent;
    return { color, bg: hexToRgba(color, theme.topic_tint) };
}
