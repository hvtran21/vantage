import {
    ActivityIndicator,
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    useWindowDimensions,
    type LayoutChangeEvent,
} from 'react-native';
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
import { router } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faChevronRight, faXmark } from '@fortawesome/free-solid-svg-icons';
import type Article from '@/lib/constants';
import type { StoryPublisher } from '@/lib/constants';
import { fetchArticleStory } from '@/lib/stories';
import { getPublisherLabel } from '@/lib/publishers';
import { domainForArticle } from '@/lib/domain';
import { useTheme, type Theme } from '@/components/Theme';
import { useMotion } from '@/components/Motion';
import { useHaptics } from '@/components/Haptics';
import { scaleMs, scaleSpring } from '@/lib/motion';
import { relativeTime } from '@/components/NewsCard';

const POP = { damping: 20, stiffness: 300, mass: 0.5 };
const TIMELINE_INSET = 16;
// A 10pt dot inside a 3pt ring of the sheet's own color, so it cuts the line.
const DOT = 16;

export type StorySourcesRequest = {
    articleId: string;
    /** What the card already knows, so the header shows before the fetch lands. */
    publishers: StoryPublisher[];
};

type StorySourcesApi = {
    open: (request: StorySourcesRequest) => void;
    close: () => void;
};

const StorySourcesContext = createContext<StorySourcesApi | null>(null);

export function useStorySources(): StorySourcesApi {
    const api = useContext(StorySourcesContext);
    if (!api) throw new Error('useStorySources must be used inside StorySourcesProvider');
    return api;
}

/**
 * Each outlet's first report, oldest first, so a repost can't take the First
 * badge or the start of the timeline away from its own original.
 */
function outletRows(sources: Article[]): Article[] {
    const byOutlet = new Map<string, Article>();
    for (const article of sources) {
        const outlet = article.source ?? article.source_domain ?? article.id;
        const seen = byOutlet.get(outlet);
        if (!seen || Date.parse(article.published_at) < Date.parse(seen.published_at)) {
            byOutlet.set(outlet, article);
        }
    }
    return [...byOutlet.values()].sort(
        (a, b) => Date.parse(a.published_at) - Date.parse(b.published_at),
    );
}

function spanText(ms: number): string {
    const minutes = Math.round(ms / 60000);
    if (minutes < 1) return 'Covered within a minute';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const parts = [
        hours > 0 && `${hours} hour${hours === 1 ? '' : 's'}`,
        rest > 0 && `${rest} minute${rest === 1 ? '' : 's'}`,
    ].filter(Boolean);
    return `Covered within ${parts.join(' ')}`;
}

// With the weekday once a story runs past midnight, or 10:00 AM would read as
// earlier than the 11:35 AM it came after.
function clockTime(ms: number, withDay: boolean): string {
    const date = new Date(ms);
    try {
        const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return withDay ? `${date.toLocaleDateString([], { weekday: 'short' })} ${time}` : time;
    } catch {
        return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
}

function Timeline({ styles, times }: { styles: ReturnType<typeof makeStyles>; times: number[] }) {
    const [width, setWidth] = useState(0);
    const first = times[0];
    const span = times[times.length - 1] - first;
    const crossesDays = new Date(first).toDateString() !== new Date(first + span).toDateString();

    return (
        <View
            style={styles.timeline}
            onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
        >
            <View style={styles.timeline_line} />
            {width > 0 &&
                times.map((time, index) => {
                    const x =
                        TIMELINE_INSET + ((time - first) / span) * (width - TIMELINE_INSET * 2);
                    return (
                        <View
                            key={index}
                            style={[
                                styles.timeline_dot,
                                { left: x - DOT / 2 },
                                index === 0 && styles.timeline_dot_first,
                            ]}
                        />
                    );
                })}
            <Text style={[styles.timeline_time, styles.timeline_time_start]}>
                {clockTime(first, crossesDays)}
            </Text>
            <Text style={[styles.timeline_time, styles.timeline_time_end]}>
                {clockTime(first + span, crossesDays)}
            </Text>
        </View>
    );
}

function OutletRow({
    styles,
    theme,
    article,
    first,
    onPress,
}: {
    styles: ReturnType<typeof makeStyles>;
    theme: Theme;
    article: Article;
    first: boolean;
    onPress: () => void;
}) {
    const publisher = getPublisherLabel(domainForArticle(article), article.source);
    const name = publisher?.name ?? article.source ?? '';

    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.7}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`${name}${first ? ', first to report' : ''}: ${article.title}`}
        >
            <View style={styles.row_text}>
                <View style={styles.row_meta}>
                    <Text
                        style={publisher?.known ? styles.row_source_known : styles.row_source}
                        numberOfLines={1}
                    >
                        {name}
                    </Text>
                    {publisher?.known && (
                        <FontAwesomeIcon icon={faCheck} size={9} color={theme.accent} />
                    )}
                    <Text style={styles.row_time}>{relativeTime(article.published_at)}</Text>
                    {first && (
                        <View style={styles.first_badge}>
                            <Text style={styles.first_badge_text}>First</Text>
                        </View>
                    )}
                </View>
                <Text style={styles.row_title} numberOfLines={3}>
                    {article.title}
                </Text>
            </View>
            <FontAwesomeIcon icon={faChevronRight} size={12} color={theme.text_tertiary} />
        </TouchableOpacity>
    );
}

// Mounted at the app root, like FeedOptionsProvider, so the floating tab bar
// can't stack on top of it.
export function StorySourcesProvider({ children }: { children: ReactNode }) {
    const [request, setRequest] = useState<StorySourcesRequest | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [rows, setRows] = useState<Article[]>([]);
    const theme = useTheme();
    const { scale } = useMotion();
    const haptics = useHaptics();
    const { getToken } = useAuth();
    const { height: screenHeight } = useWindowDimensions();
    const styles = useMemo(() => makeStyles(theme), [theme]);

    // Clerk's getToken isn't referentially stable, and open() shouldn't be rebuilt per render.
    const getTokenRef = useRef(getToken);
    getTokenRef.current = getToken;
    // Only the newest open may publish its fetch; closing retires it too.
    const loadId = useRef(0);

    const progress = useSharedValue(0);
    const closing = useRef(false);

    const clear = useCallback(() => {
        closing.current = false;
        loadId.current++;
        setRequest(null);
        setRows([]);
    }, []);

    const close = useCallback(() => {
        if (closing.current) return;
        closing.current = true;
        progress.value = withTiming(0, { duration: scaleMs(scale, 200) }, (finished) => {
            if (finished) runOnJS(clear)();
        });
    }, [clear, progress, scale]);

    const open = useCallback(
        (next: StorySourcesRequest) => {
            closing.current = false;
            const id = ++loadId.current;
            setRequest(next);
            setRows([]);
            setStatus('loading');
            progress.value = scale === 0 ? 1 : withSpring(1, scaleSpring(scale, POP));

            (async () => {
                const token = (await getTokenRef.current()) ?? undefined;
                const story = await fetchArticleStory(next.articleId, token);
                if (id !== loadId.current) return;
                if (story) {
                    setRows(outletRows(story.sources));
                    setStatus('ready');
                } else {
                    setStatus('error');
                }
            })().catch((error) => {
                console.warn('[sources] could not load the story:', error);
                if (id === loadId.current) setStatus('error');
            });
        },
        [progress, scale],
    );

    const api = useMemo<StorySourcesApi>(() => ({ open, close }), [open, close]);

    useEffect(() => {
        if (!request) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            close();
            return true;
        });
        return () => sub.remove();
    }, [request, close]);

    const scrimStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
    }));

    const sheetStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ scale: interpolate(progress.value, [0, 1], [0.94, 1], Extrapolation.CLAMP) }],
    }));

    const openArticle = useCallback(
        (id: string) => {
            haptics.selection();
            close();
            // The fetch cached every row, so the article screen finds it locally.
            router.push({ pathname: '/article/[id]', params: { id } });
        },
        [close, haptics],
    );

    const count = status === 'ready' ? rows.length : (request?.publishers.length ?? 0);
    const times = rows.map((row) => Date.parse(row.published_at)).filter((t) => !isNaN(t));
    const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;

    return (
        <StorySourcesContext.Provider value={api}>
            {children}

            {request && (
                <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                    <Animated.View
                        style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
                        pointerEvents="none"
                    />
                    <Pressable style={StyleSheet.absoluteFill} onPress={close} />

                    <View style={styles.center} pointerEvents="box-none">
                        <Animated.View
                            style={[styles.sheet, sheetStyle]}
                            accessibilityViewIsModal
                            accessibilityLabel="Sources for this story"
                        >
                            <View style={styles.header}>
                                <View style={styles.header_text}>
                                    <Text style={styles.title}>
                                        {count} source{count === 1 ? '' : 's'}
                                    </Text>
                                    <Text style={styles.subtitle}>
                                        {status === 'ready' && times.length > 1
                                            ? spanText(span)
                                            : ''}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    onPress={close}
                                    hitSlop={8}
                                    style={styles.close}
                                    accessibilityRole="button"
                                    accessibilityLabel="Close"
                                >
                                    <FontAwesomeIcon
                                        icon={faXmark}
                                        size={16}
                                        color={theme.text_secondary}
                                    />
                                </TouchableOpacity>
                            </View>

                            {status === 'ready' && span > 0 && (
                                <Timeline styles={styles} times={times} />
                            )}

                            {status === 'loading' && (
                                <View style={styles.pending}>
                                    <ActivityIndicator color={theme.accent} />
                                </View>
                            )}
                            {status === 'error' && (
                                <Text style={styles.error}>
                                    Couldn’t load the sources. Check your connection and try again.
                                </Text>
                            )}
                            {status === 'ready' && (
                                <ScrollView
                                    style={{ maxHeight: screenHeight * 0.5 }}
                                    contentContainerStyle={styles.rows}
                                    showsVerticalScrollIndicator={false}
                                >
                                    {rows.map((row, index) => (
                                        <OutletRow
                                            key={row.id}
                                            styles={styles}
                                            theme={theme}
                                            article={row}
                                            first={index === 0 && rows.length > 1}
                                            onPress={() => openArticle(row.id)}
                                        />
                                    ))}
                                </ScrollView>
                            )}

                            <Text style={styles.note}>
                                Sources you’ve blocked aren’t shown or counted.
                            </Text>
                        </Animated.View>
                    </View>
                </View>
            )}
        </StorySourcesContext.Provider>
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
            paddingHorizontal: 16,
        },
        sheet: {
            width: '100%',
            maxWidth: 400,
            gap: 14,
            backgroundColor: theme.elevated,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: theme.border_strong,
            paddingTop: 18,
            paddingHorizontal: 16,
            paddingBottom: 16,
            ...(theme.card_shadow ?? {}),
        },
        header: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
        },
        header_text: {
            flex: 1,
            gap: 3,
        },
        title: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 20,
            lineHeight: 26,
            letterSpacing: -0.3,
            color: theme.text,
        },
        subtitle: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 13,
            lineHeight: 18,
            minHeight: 18,
            color: theme.text_tertiary,
        },
        close: {
            width: 44,
            height: 44,
            marginTop: -10,
            marginRight: -8,
            borderRadius: 22,
            justifyContent: 'center',
            alignItems: 'center',
        },
        timeline: {
            height: 34,
        },
        timeline_line: {
            position: 'absolute',
            left: TIMELINE_INSET,
            right: TIMELINE_INSET,
            top: 8,
            height: 2,
            borderRadius: 1,
            backgroundColor: theme.border_strong,
        },
        timeline_dot: {
            position: 'absolute',
            top: 9 - DOT / 2,
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            borderWidth: 3,
            borderColor: theme.elevated,
            backgroundColor: theme.text_secondary,
        },
        timeline_dot_first: {
            backgroundColor: theme.accent,
        },
        timeline_time: {
            position: 'absolute',
            top: 20,
            fontFamily: 'WorkSans-Regular',
            fontSize: 11,
            color: theme.text_tertiary,
        },
        timeline_time_start: {
            left: 4,
        },
        timeline_time_end: {
            right: 4,
        },
        pending: {
            height: 120,
            justifyContent: 'center',
            alignItems: 'center',
        },
        error: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 13,
            lineHeight: 19,
            color: theme.text_secondary,
        },
        rows: {
            gap: 8,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
        },
        row_text: {
            flex: 1,
            gap: 4,
        },
        row_meta: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        row_source_known: {
            flexShrink: 1,
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 12,
            color: theme.text_secondary,
        },
        row_source: {
            flexShrink: 1,
            fontFamily: 'WorkSans-Regular',
            fontSize: 12,
            color: theme.text_tertiary,
        },
        row_time: {
            fontFamily: 'WorkSans-Light',
            fontSize: 12,
            color: theme.text_tertiary,
        },
        first_badge: {
            marginLeft: 2,
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 6,
            backgroundColor: theme.accent_soft,
        },
        first_badge_text: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 10.5,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: theme.accent,
        },
        row_title: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 15,
            lineHeight: 21,
            letterSpacing: -0.1,
            color: theme.text,
        },
        note: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 12,
            lineHeight: 17,
            color: theme.text_tertiary,
        },
    });

export default StorySourcesProvider;
