import { Text, View, StyleSheet, TouchableOpacity, Keyboard } from 'react-native';
import { Image } from 'expo-image';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faEllipsisVertical, faEllipsis, faCheck } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useMemo, useRef, useState, type ElementRef, type ReactNode } from 'react';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { getTopicColor, useTheme, type Theme } from '@/components/Theme';
import { useMotion } from '@/components/Motion';
import { useHaptics } from '@/components/Haptics';
import { scaleMs, withMotion } from '@/lib/motion';
import { domainForArticle } from '@/lib/domain';
import { getPublisherLabel } from '@/lib/publishers';
import { initialOf, stackLabel, storyPublishers } from '@/lib/stories';
import type Article from '@/lib/constants';
import type { StoryPublisher } from '@/lib/constants';
import type { AnchorRect } from '@/components/ArticleActionSheet';

function formatDate(date: Date): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return '';
    }

    const months: string[] = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ];

    const month: string = months[date.getMonth()];
    const day: number = date.getDate();

    function getOrdinalSuffix(day: number): string {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1:
                return 'st';
            case 2:
                return 'nd';
            case 3:
                return 'rd';
            default:
                return 'th';
        }
    }

    return `${month} ${day}${getOrdinalSuffix(day)}`;
}

function relativeTime(dateString: string): string {
    const now = Date.now();
    const then = new Date(dateString).getTime();
    if (isNaN(then)) return '';

    const diff = now - then;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return formatDate(new Date(dateString));
}

export { formatDate, relativeTime };

interface CardFrontProps {
    title: string;
    url_to_image: string;
    published_at: string;
    genre: string;
    id: string;
    handleEllipsisPress: (id: string, anchor: AnchorRect) => void;
    source?: string | null;
    source_domain?: string | null;
    url?: string | null;
    /** The first card in a feed gets a bigger photo and title; everything else is the standard row. */
    variant?: 'standard' | 'lead';
    read?: boolean;
    story_sources?: Article['story_sources'];
    /** Lists the story's outlets. Without it, a story shows its plain source row. */
    onSourcesPress?: (id: string, publishers: StoryPublisher[]) => void;
}

const fallBackImage = require('@/assets/images/computer_2.jpg');

function SourceRow({ theme, styles, source, source_domain, url }: SourceRowProps) {
    const domain = domainForArticle({ source_domain, url: url ?? null });
    const publisher = getPublisherLabel(domain, source);
    const label = publisher?.name ?? source;
    if (!label) return null;

    return (
        <View style={styles.source_row}>
            <Text
                style={publisher?.known ? styles.source_known : styles.source_unknown}
                numberOfLines={1}
            >
                {label}
            </Text>
            {publisher?.known && <FontAwesomeIcon icon={faCheck} size={9} color={theme.accent} />}
        </View>
    );
}

type SourceRowProps = {
    theme: Theme;
    styles: ReturnType<typeof makeCardStyle>;
    source?: string | null;
    source_domain?: string | null;
    url?: string | null;
};

// Stands in for the source row once a story has a second outlet.
function PublisherStack({
    styles,
    names,
    onPress,
}: {
    styles: ReturnType<typeof makeCardStyle>;
    names: string[];
    onPress: () => void;
}) {
    const haptics = useHaptics();

    return (
        <TouchableOpacity
            onPress={() => {
                haptics.light();
                Keyboard.dismiss();
                onPress();
            }}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10 }}
            style={styles.stack_row}
            accessibilityRole="button"
            accessibilityLabel={`${names.length} sources covered this story. Show them.`}
        >
            <View style={styles.stack_discs}>
                {names.slice(0, 3).map((name, index) => (
                    <View
                        key={`${index}-${name}`}
                        style={[styles.stack_disc, index > 0 && styles.stack_disc_overlap]}
                    >
                        <Text style={styles.stack_initial}>{initialOf(name)}</Text>
                    </View>
                ))}
            </View>
            <Text style={styles.stack_label} numberOfLines={1}>
                {stackLabel(names)}
            </Text>
        </TouchableOpacity>
    );
}

function TagRow({
    styles,
    theme,
    topicColor,
    label,
    time,
    read,
    trailing,
}: {
    styles: ReturnType<typeof makeCardStyle>;
    theme: Theme;
    topicColor: { color: string; bg: string };
    label: string;
    time: string;
    read?: boolean;
    trailing?: ReactNode;
}) {
    return (
        <View style={styles.tag_row}>
            <View style={[styles.tag_pill, { backgroundColor: topicColor.bg }]}>
                <Text style={[styles.tag_text, { color: topicColor.color }]}>{label}</Text>
            </View>
            <Text style={styles.time_text}>{time}</Text>
            {read && (
                <View style={styles.read_marker}>
                    <FontAwesomeIcon icon={faCheck} size={8} color={theme.text_tertiary} />
                    <Text style={styles.read_marker_text}>Read</Text>
                </View>
            )}
            {trailing && (
                <>
                    <View style={styles.tag_row_spacer} />
                    {trailing}
                </>
            )}
        </View>
    );
}

function EllipsisButton({
    theme,
    style,
    size = 14,
    icon = faEllipsisVertical,
    onPress,
}: {
    theme: Theme;
    style?: object;
    size?: number;
    icon?: typeof faEllipsisVertical;
    onPress: (anchor: AnchorRect) => void;
}) {
    const ref = useRef<ElementRef<typeof TouchableOpacity>>(null);
    const haptics = useHaptics();

    const handlePress = () => {
        haptics.light();
        Keyboard.dismiss();
        // The menu anchors to wherever this button actually is on screen, not a
        // fixed spot, so it has to ask the native view for its own position.
        ref.current?.measureInWindow((x: number, y: number, width: number, height: number) => {
            onPress({ x, y, width, height });
        });
    };

    return (
        <TouchableOpacity
            ref={ref}
            onPress={handlePress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={style}
        >
            <FontAwesomeIcon icon={icon} size={size} color={theme.text_tertiary} />
        </TouchableOpacity>
    );
}

export const NewsCard = ({
    title,
    url_to_image,
    published_at,
    genre,
    id,
    handleEllipsisPress,
    source,
    source_domain,
    url,
    variant = 'standard',
    read = false,
    story_sources,
    onSourcesPress,
}: CardFrontProps) => {
    const [imageError, setImageError] = useState(false);
    const { scale } = useMotion();
    const haptics = useHaptics();
    const theme = useTheme();
    const styles = useMemo(() => makeCardStyle(theme), [theme]);
    const publishers = useMemo(
        () => storyPublishers({ source: source ?? '', source_domain, story_sources }),
        [source, source_domain, story_sources],
    );
    // Through the same labels as SourceRow, so an outlet reads alike either way.
    const publisherNames = useMemo(
        () =>
            publishers.map(
                (publisher) =>
                    getPublisherLabel(publisher.source_domain, publisher.source)?.name ??
                    publisher.source,
            ),
        [publishers],
    );

    const sourceLine =
        onSourcesPress && publishers.length > 1 ? (
            <PublisherStack
                styles={styles}
                names={publisherNames}
                onPress={() => onSourcesPress(id, publishers)}
            />
        ) : (
            <SourceRow
                theme={theme}
                styles={styles}
                source={source}
                source_domain={source_domain}
                url={url}
            />
        );

    const time = relativeTime(published_at);
    const imageSource = url_to_image && !imageError ? { uri: url_to_image } : fallBackImage;
    const label = genre === '' ? 'Top' : genre;
    const topicColor = getTopicColor(label, theme);

    useEffect(() => {
        if (url_to_image) {
            Image.prefetch(url_to_image, 'disk');
        }
    }, [url_to_image]);

    const handleCardPress = () => {
        haptics.light();
        Keyboard.dismiss();
        router.push({ pathname: '/article/[id]', params: { id } });
    };

    if (variant === 'lead') {
        return (
            <Animated.View
                entering={withMotion(scale, () => FadeIn.duration(scaleMs(scale, 300)))}
                style={styles.card}
            >
                <View style={styles.card_top} />
                <TouchableOpacity onPress={handleCardPress} activeOpacity={0.85}>
                    <View style={[styles.lead_photo_frame, read && styles.photo_read]}>
                        <Image
                            source={imageSource}
                            alt="Article thumbnail"
                            style={styles.lead_photo}
                            contentFit="cover"
                            onError={() => setImageError(true)}
                            transition={200}
                        />
                    </View>
                    <View style={styles.lead_body}>
                        <TagRow
                            styles={styles}
                            theme={theme}
                            topicColor={topicColor}
                            label={label}
                            time={time}
                            read={read}
                            trailing={
                                <EllipsisButton
                                    theme={theme}
                                    style={styles.ellipsis_btn}
                                    onPress={(anchor) => handleEllipsisPress(id, anchor)}
                                />
                            }
                        />
                        <Text
                            style={[styles.lead_title, read && styles.title_read]}
                            numberOfLines={3}
                        >
                            {title}
                        </Text>
                        {sourceLine}
                    </View>
                </TouchableOpacity>
            </Animated.View>
        );
    }

    return (
        <Animated.View
            entering={withMotion(scale, () => FadeIn.duration(scaleMs(scale, 300)))}
            style={styles.card}
        >
            <View style={styles.card_top} />
            <TouchableOpacity onPress={handleCardPress} activeOpacity={0.85} style={styles.row}>
                <View style={styles.col}>
                    <TagRow
                        styles={styles}
                        theme={theme}
                        topicColor={topicColor}
                        label={label}
                        time={time}
                        read={read}
                    />
                    <Text style={[styles.card_title, read && styles.title_read]} numberOfLines={3}>
                        {title}
                    </Text>
                    {sourceLine}
                </View>

                <View style={[styles.thumbnail_frame, read && styles.photo_read]}>
                    <Image
                        source={imageSource}
                        alt="Article thumbnail"
                        style={styles.thumbnail_image}
                        contentFit="cover"
                        onError={() => setImageError(true)}
                        transition={200}
                    />
                </View>
            </TouchableOpacity>

            <EllipsisButton
                theme={theme}
                style={styles.row_ellipsis_btn}
                icon={faEllipsis}
                onPress={(anchor) => handleEllipsisPress(id, anchor)}
            />
        </Animated.View>
    );
};

const makeCardStyle = (theme: Theme) =>
    StyleSheet.create({
        card: {
            marginHorizontal: 16,
            marginBottom: 12,
            backgroundColor: theme.surface,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.border,
            overflow: 'hidden',
            ...(theme.card_shadow ?? {}),
        },
        // The 1px top highlight dark cards get instead of a shadow; transparent on light.
        card_top: {
            position: 'absolute',
            top: 0,
            left: 14,
            right: 14,
            height: 1,
            backgroundColor: theme.card_top,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: 14,
            gap: 14,
        },
        col: {
            flex: 1,
        },
        tag_row: {
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 8,
            marginLeft: -1,
            gap: 8,
        },
        tag_row_spacer: {
            flex: 1,
        },
        tag_pill: {
            backgroundColor: theme.accent_soft,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
        },
        tag_text: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 11,
            color: theme.accent,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
        },
        time_text: {
            fontFamily: 'WorkSans-Light',
            fontSize: 12,
            color: theme.text_tertiary,
        },
        // Read cards step back instead of vanishing; hiding them outright is the
        // separate opt-in in the feed options.
        title_read: {
            color: theme.text_tertiary,
        },
        photo_read: {
            opacity: 0.45,
        },
        read_marker: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
        },
        read_marker_text: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 11,
            letterSpacing: 0.2,
            color: theme.text_tertiary,
        },
        card_title: {
            color: theme.text,
            fontSize: 17,
            fontFamily: 'WorkSans-Regular',
            lineHeight: 24,
            letterSpacing: -0.2,
        },
        source_row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            marginTop: 10,
        },
        source_known: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 12,
            color: theme.text_secondary,
        },
        source_unknown: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 12,
            color: theme.text_tertiary,
        },
        stack_row: {
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            maxWidth: '100%',
            gap: 8,
            marginTop: 10,
            minHeight: 22,
        },
        stack_discs: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        // The surface-colored ring is what separates each disc from the one it overlaps.
        stack_disc: {
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 1.5,
            borderColor: theme.surface,
            backgroundColor: theme.source_disc,
            justifyContent: 'center',
            alignItems: 'center',
        },
        stack_disc_overlap: {
            marginLeft: -6,
        },
        stack_initial: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 9.5,
            lineHeight: 12,
            color: theme.text_secondary,
            includeFontPadding: false,
        },
        stack_label: {
            flexShrink: 1,
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 12,
            color: theme.text_secondary,
        },
        // Standard row's ellipsis is horizontal (faEllipsis), whose ink sits in
        // a thin band across the middle of its 14px box rather than filling
        // it top-to-bottom, so a short marginTop keeps `row`'s normal
        // alignItems: 'center' behavior while still clearing that band even
        // when a short title leaves this the tallest thing in the row.
        thumbnail_frame: {
            width: 96,
            height: 96,
            marginTop: 10,
        },
        thumbnail_image: {
            width: '100%',
            height: '100%',
            borderRadius: 14,
        },
        // Icon-only and in the header row rather than pinned to the thumbnail --
        // it reads as a property of the card, not a control stuck on the photo.
        ellipsis_btn: {
            marginLeft: 4,
        },
        // Standard rows: the card's own top-right corner -- above the thumbnail
        // in the padding most cards have there -- rather than crammed into the
        // (narrower) text column or pinned to the photo itself.
        row_ellipsis_btn: {
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 1,
        },
        // Matches `card`'s own borderRadius: `card`'s overflow:hidden clips
        // plain Views reliably, but not always expo-image's native view once
        // elevation is in play, so the top corners are rounded here too.
        lead_photo_frame: {
            width: '100%',
            height: 168,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            overflow: 'hidden',
        },
        lead_photo: {
            width: '100%',
            height: '100%',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
        },
        lead_body: {
            paddingTop: 14,
            paddingHorizontal: 16,
            paddingBottom: 16,
        },
        lead_title: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 20,
            lineHeight: 27,
            letterSpacing: -0.3,
            color: theme.text,
        },
    });

export default NewsCard;
