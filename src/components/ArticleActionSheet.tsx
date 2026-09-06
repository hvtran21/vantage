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
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Pressable,
    BackHandler,
    Dimensions,
    type LayoutChangeEvent,
} from 'react-native';
import Animated, {
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import type { IconProp } from '@fortawesome/fontawesome-svg-core';
import {
    faUpRightFromSquare,
    faBan,
    faFlag,
    faBookmark as faBookmarkSolid,
} from '@fortawesome/free-solid-svg-icons';
import { faBookmark as faBookmarkOutline } from '@fortawesome/free-regular-svg-icons';
import { useAuth } from '@clerk/expo';
import Article from '@/lib/constants';
import { domainForArticle } from '@/lib/domain';
import { blockSource, reportSource } from '@/lib/sources';
import { getTopicColor, useTheme, type Theme } from '@/components/Theme';
import { useMotion } from '@/components/Motion';
import { scaleMs, scaleSpring } from '@/lib/motion';

const POPOVER_WIDTH = 232;
const GAP = 8;
const MARGIN = 12;
const POP = { damping: 20, stiffness: 300, mass: 0.5 };
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/** Where the ellipsis that opened the menu actually sits, from measureInWindow. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

export type ActionSheetRequest = {
    article: Article;
    saved: boolean;
    anchor: AnchorRect;
    onToggleSave: (next: boolean) => void;
    onOpenInBrowser: () => void;
    /** Lets the calling list drop the publisher's rows without a reload. */
    onBlocked?: (domain: string) => void;
};

type ActionSheetApi = {
    open: (request: ActionSheetRequest) => void;
    close: () => void;
};

const ActionSheetContext = createContext<ActionSheetApi | null>(null);

export function useActionSheet(): ActionSheetApi {
    const api = useContext(ActionSheetContext);
    if (!api) throw new Error('useActionSheet must be used inside ActionSheetProvider');
    return api;
}

interface ActionRowProps {
    icon: IconProp;
    label: string;
    onPress: () => void;
    tone?: 'default' | 'active' | 'danger';
}

function ActionRow({ icon, label, onPress, tone = 'default' }: ActionRowProps) {
    const theme = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const color = tone === 'danger' ? theme.danger : tone === 'active' ? theme.accent : theme.text;
    return (
        <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.6}>
            <View
                style={[
                    styles.icon_chip,
                    tone === 'active' && styles.icon_chip_active,
                    tone === 'danger' && styles.icon_chip_danger,
                ]}
            >
                <FontAwesomeIcon icon={icon} size={14} color={color} />
            </View>
            <Text style={[styles.row_label, { color }]}>{label}</Text>
        </TouchableOpacity>
    );
}

type Position = { top: number; left: number };

// The floating tab bar (app/(tabs)/_layout.tsx) sits at `bottom: insets.bottom
// + 16` and is 72 tall -- a menu opening downward near the last visible card
// needs to clear that too, not just the safe-area inset.
const TAB_BAR_ZONE = 16 + 72;

/**
 * Right-aligns to the ellipsis by default (it sits at a card's top-right or in
 * a header row) and flips to open upward when there isn't room below -- a card
 * near the bottom of the feed would otherwise push the menu under the tab bar.
 */
function computePosition(
    anchor: AnchorRect,
    menuHeight: number,
    insets: { top: number; bottom: number },
): Position {
    // measureInWindow reports y within the safe-content area (below the status
    // bar), but this overlay is mounted above the per-screen SafeAreaView and
    // positions itself from the true top of the screen -- without adding the
    // inset back, the popover renders a whole status-bar-height too high.
    const anchorTop = anchor.y + insets.top;

    let left = anchor.x + anchor.width - POPOVER_WIDTH;
    left = Math.min(Math.max(left, MARGIN), SCREEN_WIDTH - POPOVER_WIDTH - MARGIN);

    const bottomObstruction = insets.bottom + TAB_BAR_ZONE + MARGIN;
    const spaceBelow = SCREEN_HEIGHT - bottomObstruction - (anchorTop + anchor.height + GAP);
    const opensUpward = spaceBelow < menuHeight;
    const top = opensUpward ? anchorTop - GAP - menuHeight : anchorTop + anchor.height + GAP;

    return { top: Math.max(top, insets.top + MARGIN), left };
}

// Hosted at the root rather than in a react-native Modal: Modal builds a native
// Dialog window on Android, which measured ~470ms from tap to visible no matter
// what animationType was set to.
//
// Anchored to the ellipsis that opened it (a small popover that pops in near the
// tap point) rather than a full-screen sheet rising from the bottom -- the
// distance a bottom sheet travels reads as a much bigger event than "show me
// three actions for this one article."
export function ActionSheetProvider({ children }: { children: ReactNode }) {
    const [request, setRequest] = useState<ActionSheetRequest | null>(null);
    const [saved, setSaved] = useState(false);
    const [position, setPosition] = useState<Position | null>(null);
    const insets = useSafeAreaInsets();
    const { scale } = useMotion();
    const { isSignedIn, getToken } = useAuth();
    const theme = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);

    const progress = useSharedValue(0);
    const closing = useRef(false);

    const clear = useCallback(() => {
        closing.current = false;
        setRequest(null);
        setPosition(null);
    }, []);

    const close = useCallback(() => {
        if (closing.current) return;
        closing.current = true;
        progress.value = withTiming(0, { duration: scaleMs(scale, 120) }, (finished) => {
            if (finished) runOnJS(clear)();
        });
    }, [clear, progress, scale]);

    const open = useCallback(
        (next: ActionSheetRequest) => {
            closing.current = false;
            setSaved(next.saved);
            setRequest(next);
            setPosition(null);
            progress.value = 0;
        },
        [progress],
    );

    const api = useMemo<ActionSheetApi>(() => ({ open, close }), [open, close]);

    // Modal gave us onRequestClose for free; an overlay has to claim back itself.
    useEffect(() => {
        if (!request) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            close();
            return true;
        });
        return () => sub.remove();
    }, [request, close]);

    // Fires once the invisible measuring pass below reports the menu's real
    // height, which is what decides whether it opens above or below the anchor.
    const onMeasured = useCallback(
        (event: LayoutChangeEvent) => {
            if (!request) return;
            setPosition(computePosition(request.anchor, event.nativeEvent.layout.height, insets));
            progress.value = scale === 0 ? 1 : withSpring(1, scaleSpring(scale, POP));
        },
        [request, insets, scale, progress],
    );

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ scale: interpolate(progress.value, [0, 1], [0.92, 1], Extrapolation.CLAMP) }],
    }));

    const article = request?.article;
    // Naming the publisher makes it obvious the action is about the source, not
    // this one article.
    const domain = article ? domainForArticle(article) : null;

    const handleBlock = useCallback(
        (target: string) => {
            const notify = request?.onBlocked;
            (async () => {
                // Signed in, the block belongs to the account, so it has to carry
                // the token rather than falling back to the device id.
                const token = isSignedIn ? await getToken() : null;
                await blockSource(target, token);
                notify?.(target);
            })().catch((error) => console.warn('[sheet] block failed:', error));
        },
        [request, isSignedIn, getToken],
    );

    const handleReport = useCallback(
        (target: string) => {
            const notify = request?.onBlocked;
            (async () => {
                const token = await getToken();
                if (!token) return;
                await reportSource(target, token, article?.id);
                notify?.(target);
            })().catch((error) => console.warn('[sheet] report failed:', error));
        },
        [request, getToken, article],
    );

    const menuBody = request && (
        <>
            <View style={styles.group}>
                <ActionRow
                    icon={saved ? faBookmarkSolid : faBookmarkOutline}
                    label={saved ? 'Unsave' : 'Save'}
                    tone={saved ? 'active' : 'default'}
                    onPress={() => {
                        const next = !saved;
                        setSaved(next);
                        request.onToggleSave(next);
                        close();
                    }}
                />
                <ActionRow
                    icon={faUpRightFromSquare}
                    label="Open in browser"
                    onPress={() => {
                        request.onOpenInBrowser();
                        close();
                    }}
                />
                {domain && (
                    <ActionRow
                        icon={faBan}
                        label={`Block ${domain}`}
                        onPress={() => {
                            handleBlock(domain);
                            close();
                        }}
                    />
                )}
            </View>

            {domain && isSignedIn && (
                <>
                    <View style={styles.divider} />
                    <View style={styles.group}>
                        <ActionRow
                            icon={faFlag}
                            label={`Report ${domain}`}
                            tone="danger"
                            onPress={() => {
                                handleReport(domain);
                                close();
                            }}
                        />
                    </View>
                </>
            )}
        </>
    );

    return (
        <ActionSheetContext.Provider value={api}>
            <View style={styles.root}>
                {children}

                {request && !position && (
                    // Invisible: only here to learn the menu's real height before
                    // computing where it should sit and animating it in.
                    <View
                        style={[styles.popover, styles.measuring, { width: POPOVER_WIDTH }]}
                        onLayout={onMeasured}
                        pointerEvents="none"
                    >
                        {menuBody}
                    </View>
                )}

                {request && position && (
                    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
                        <Animated.View
                            style={[
                                styles.popover,
                                { top: position.top, left: position.left, width: POPOVER_WIDTH },
                                animatedStyle,
                            ]}
                        >
                            {menuBody}
                        </Animated.View>
                    </View>
                )}
            </View>
        </ActionSheetContext.Provider>
    );
}

const makeStyles = (theme: Theme) =>
    StyleSheet.create({
        root: {
            flex: 1,
        },
        popover: {
            position: 'absolute',
            backgroundColor: theme.elevated,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.border,
            paddingVertical: 6,
            overflow: 'hidden',
            ...(theme.card_shadow ?? {}),
        },
        measuring: {
            top: 0,
            left: -9999,
            opacity: 0,
        },
        divider: {
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.border,
        },
        group: {
            paddingVertical: 4,
            paddingHorizontal: 8,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 9,
            paddingHorizontal: 8,
        },
        icon_chip: {
            width: 28,
            height: 28,
            borderRadius: 9,
            backgroundColor: theme.surface,
            justifyContent: 'center',
            alignItems: 'center',
        },
        icon_chip_active: {
            backgroundColor: theme.accent_soft,
        },
        icon_chip_danger: {
            backgroundColor: 'rgba(239, 68, 68, 0.10)',
        },
        row_label: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 15,
            flexShrink: 1,
        },
    });

export default ActionSheetProvider;
