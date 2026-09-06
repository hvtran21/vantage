import { createContext, useContext, type ReactNode } from 'react';

// Single palette today, but every screen now reads it through this hook
// instead of a static import -- StyleSheet.create calls are memoized per
// component on `theme` so a future mode switch only has to change this file.
export const theme = {
    bg: '#050505',
    surface: '#0e0e0e',
    elevated: '#161616',
    accent: '#06B6D4',
    accent_soft: 'rgba(6, 182, 212, 0.10)',
    accent_border: 'rgba(6, 182, 212, 0.22)',
    text: 'rgba(255, 255, 255, 0.90)',
    text_secondary: 'rgba(255, 255, 255, 0.50)',
    text_tertiary: 'rgba(255, 255, 255, 0.28)',
    border: 'rgba(255, 255, 255, 0.06)',
    danger: '#EF4444',
};

export type Theme = typeof theme;

const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
    const value = useContext(ThemeContext);
    if (!value) throw new Error('useTheme must be used inside ThemeProvider');
    return value;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const topicColors: Record<string, { color: string; bg: string }> = {
    'Artificial Intelligence': { color: '#60A5FA', bg: 'rgba(96, 165, 250, 0.10)' },
    'Machine Learning': { color: '#A78BFA', bg: 'rgba(167, 139, 250, 0.10)' },
    Apple: { color: '#F472B6', bg: 'rgba(244, 114, 182, 0.10)' },
    Microsoft: { color: '#34D399', bg: 'rgba(52, 211, 153, 0.10)' },
    Amazon: { color: '#FBBF24', bg: 'rgba(251, 191, 36, 0.10)' },
    Google: { color: '#4ADE80', bg: 'rgba(74, 222, 128, 0.10)' },
    Gaming: { color: '#FB923C', bg: 'rgba(251, 146, 60, 0.10)' },
    Cybersecurity: { color: '#F87171', bg: 'rgba(248, 113, 113, 0.10)' },
    'Game development': { color: '#C084FC', bg: 'rgba(192, 132, 252, 0.10)' },
    Nintendo: { color: '#E879F9', bg: 'rgba(232, 121, 249, 0.10)' },
    'Space Tech': { color: '#818CF8', bg: 'rgba(129, 140, 248, 0.10)' },
    Startups: { color: '#FB7185', bg: 'rgba(251, 113, 133, 0.10)' },
    Blockchain: { color: '#FACC15', bg: 'rgba(250, 204, 21, 0.10)' },
    Robotics: { color: '#22D3EE', bg: 'rgba(34, 211, 238, 0.10)' },
    Technology: { color: '#2DD4BF', bg: 'rgba(45, 212, 191, 0.10)' },
    Top: { color: '#2DD4BF', bg: 'rgba(45, 212, 191, 0.10)' },
};

export function getTopicColor(topic: string, theme: Theme) {
    return topicColors[topic] ?? { color: theme.accent, bg: theme.accent_soft };
}

export default ThemeProvider;
