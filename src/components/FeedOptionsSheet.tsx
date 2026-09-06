import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import Animated, {
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import type { IconProp } from '@fortawesome/fontawesome-svg-core';
import {
    faHouse,
    faClock,
    faBolt,
    faBan,
    faArrowsRotate,
    faCheck,
    faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
import { useTheme, useThemeMode, type Theme, type ThemeMode } from '@/components/Theme';
import { useMotion } from '@/components/Motion';
import { scaleMs, scaleSpring } from '@/lib/motion';
import { getLastQueryTime } from '@/lib/utilities';
import { relativeTime } from '@/components/NewsCard';

const POP = { damping: 20, stiffness: 300, mass: 0.5 };

const SHOW_OPTIONS = [
    { key: 'Home', icon: faHouse, hint: 'The topics you picked' },
    { key: 'Recent', icon: faClock, hint: 'Newest first, every topic' },
    { key: 'Top', icon: faBolt, hint: 'Across all of tech' },
];

const APPEARANCE_OPTIONS: { key: ThemeMode; label: string }[] = [
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
    { key: 'system', label: 'System' },
];

export type FeedOptionsRequest = {
    filter: string;
    onSelectFilter: (filter: string) => void;
    onBlockedSourcesPress: () => void;
    onRefreshPress: () => void;
};

type FeedOptionsApi = {
    open: (request: FeedOptionsRequest) => void;
    close: () => void;
};

const FeedOptionsContext = createContext<FeedOptionsApi | null>(null);

export function useFeedOptionsSheet(): FeedOptionsApi {
    const api = useContext(FeedOptionsContext);
    if (!api) throw new Error('useFeedOptionsSheet must be used inside FeedOptionsProvider');
    return api;
}

function OptionRow({
    styles,
    theme,
    icon,
    name,
    hint,
    selected,
    onPress,
}: {
    styles: ReturnType<typeof makeStyles>;
    theme: Theme;
    icon: IconProp;
    name: string;
    hint?: string;
    selected?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable onPress={onPress} style={styles.opt_row}>
            <View style={[styles.opt_icon, selected && styles.opt_icon_on]}>
                <FontAwesomeIcon
                    icon={icon}
                    size={15}
                    color={selected ? theme.accent : theme.text_secondary}
                />
            </View>
            <View style={styles.opt_text_block}>
                <Text style={[styles.opt_name, selected && styles.opt_name_on]}>{name}</Text>
                {hint && <Text style={styles.opt_hint}>{hint}</Text>}
            </View>
            {selected && <FontAwesomeIcon icon={faCheck} size={15} color={theme.accent} />}
            {!selected && hint === undefined && (
                <FontAwesomeIcon icon={faChevronRight} size={13} color={theme.text_tertiary} />
            )}
        </Pressable>
    );
}

// Mounted at the app root (see app/_layout.tsx), same reasoning as
// ActionSheetProvider: hosted inside the screen tree, the floating tab bar
// (rendered by the tab navigator above the screen) would stack on top of it.
export function FeedOptionsProvider({ children }: { children: ReactNode }) {
    const [request, setRequest] = useState<FeedOptionsRequest | null>(null);
    const [mounted, setMounted] = useState(false);
    const theme = useTheme();
    const { mode, setMode } = useThemeMode();
    const { scale } = useMotion();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const [refreshHint, setRefreshHint] = useState('');

    const progress = useSharedValue(0);
    const closing = useRef(false);

    const clear = useCallback(() => {
        closing.current = false;
        setMounted(false);
        setRequest(null);
    }, []);

    const close = useCallback(() => {
        if (closing.current) return;
        closing.current = true;
        progress.value = withTiming(0, { duration: scaleMs(scale, 150) }, (finished) => {
            if (finished) runOnJS(clear)();
        });
    }, [clear, progress, scale]);

    const open = useCallback(
        (next: FeedOptionsRequest) => {
            closing.current = false;
            setRequest(next);
            setMounted(true);
            progress.value = scale === 0 ? 1 : withSpring(1, scaleSpring(scale, POP));
        },
        [progress, scale],
    );

    const api = useMemo<FeedOptionsApi>(() => ({ open, close }), [open, close]);

    useEffect(() => {
        if (!mounted) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            close();
            return true;
        });
        return () => sub.remove();
    }, [mounted, close]);

    useEffect(() => {
        if (!request) return;
        getLastQueryTime()
            .then((iso) => setRefreshHint(iso ? `Last updated ${relativeTime(iso)}` : ''))
            .catch(() => setRefreshHint(''));
    }, [request]);

    const scrimStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
    }));

    const sheetStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ scale: interpolate(progress.value, [0, 1], [0.94, 1], Extrapolation.CLAMP) }],
    }));

    return (
        <FeedOptionsContext.Provider value={api}>
            {children}

            {mounted && request && (
                <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                    <Animated.View
                        style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
                        pointerEvents="none"
                    />
                    <Pressable style={StyleSheet.absoluteFill} onPress={close} />

                    <View style={styles.center} pointerEvents="box-none">
                        <Animated.View style={[styles.sheet, sheetStyle]}>
                            <Text style={styles.seclabel}>Show</Text>
                            {SHOW_OPTIONS.map((option) => (
                                <OptionRow
                                    key={option.key}
                                    styles={styles}
                                    theme={theme}
                                    icon={option.icon}
                                    name={option.key}
                                    hint={option.hint}
                                    selected={request.filter === option.key}
                                    onPress={() => {
                                        request.onSelectFilter(option.key);
                                        close();
                                    }}
                                />
                            ))}

                            <View style={styles.divide} />
                            <Text style={styles.seclabel}>Appearance</Text>
                            <View style={styles.segment}>
                                {APPEARANCE_OPTIONS.map((option) => (
                                    <Pressable
                                        key={option.key}
                                        onPress={() => setMode(option.key)}
                                        style={[styles.seg, mode === option.key && styles.seg_on]}
                                    >
                                        <Text
                                            style={[
                                                styles.seg_text,
                                                mode === option.key && styles.seg_text_on,
                                            ]}
                                        >
                                            {option.label}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>

                            <View style={styles.divide} />
                            <OptionRow
                                styles={styles}
                                theme={theme}
                                icon={faBan}
                                name="Blocked sources"
                                onPress={() => {
                                    close();
                                    request.onBlockedSourcesPress();
                                }}
                            />
                            <OptionRow
                                styles={styles}
                                theme={theme}
                                icon={faArrowsRotate}
                                name="Refresh now"
                                hint={refreshHint}
                                onPress={() => {
                                    close();
                                    request.onRefreshPress();
                                }}
                            />
                        </Animated.View>
                    </View>
                </View>
            )}
        </FeedOptionsContext.Provider>
    );
}

const makeStyles = (theme: Theme) =>
    StyleSheet.create({
        scrim: {
            backgroundColor: theme.scrim,
        },
        center: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 24,
        },
        sheet: {
            width: '100%',
            maxWidth: 400,
            backgroundColor: theme.elevated,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: theme.border,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 20,
            ...(theme.card_shadow ?? {}),
        },
        seclabel: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 10,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: theme.text_tertiary,
            marginBottom: 6,
            marginLeft: 2,
        },
        opt_row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            paddingVertical: 11,
        },
        opt_icon: {
            width: 34,
            height: 34,
            borderRadius: 11,
            backgroundColor: theme.border,
            justifyContent: 'center',
            alignItems: 'center',
        },
        opt_icon_on: {
            backgroundColor: theme.accent_soft,
        },
        opt_text_block: {
            flex: 1,
        },
        opt_name: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 16,
            lineHeight: 20,
            color: theme.text,
        },
        opt_name_on: {
            fontFamily: 'WorkSans-SemiBold',
        },
        opt_hint: {
            fontFamily: 'WorkSans-Light',
            fontSize: 12,
            color: theme.text_tertiary,
            marginTop: 1,
        },
        segment: {
            flexDirection: 'row',
            gap: 4,
            padding: 4,
            borderRadius: 14,
            backgroundColor: theme.border,
            marginBottom: 4,
        },
        seg: {
            flex: 1,
            alignItems: 'center',
            paddingVertical: 9,
            borderRadius: 11,
        },
        seg_on: {
            backgroundColor: theme.surface,
            ...(theme.card_shadow ?? {}),
        },
        seg_text: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 13,
            color: theme.text_secondary,
        },
        seg_text_on: {
            fontFamily: 'WorkSans-SemiBold',
            color: theme.text,
        },
        divide: {
            height: 1,
            backgroundColor: theme.border,
            marginVertical: 12,
        },
    });

export default FeedOptionsProvider;
