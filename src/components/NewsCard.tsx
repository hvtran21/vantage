import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faEllipsisVertical, faCheck } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { getTopicColor, useTheme, type Theme } from '@/components/Theme';
import { useMotion } from '@/components/Motion';
import { scaleMs, withMotion } from '@/lib/motion';
import { domainForArticle } from '@/lib/domain';
import { getPublisherLabel } from '@/lib/publishers';

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
    handleEllipsisPress: (id: string) => void;
    source?: string | null;
    source_domain?: string | null;
    url?: string | null;
    /** The first card in a feed gets a bigger photo and title; everything else is the standard row. */
    variant?: 'standard' | 'lead';
}

const fallBackImage = require('@/assets/images/computer_2.jpg');

function SourceRow({ theme, styles, source, source_domain, url }: SourceRowProps) {
    const domain = domainForArticle({ source_domain, url: url ?? null });
    const publisher = getPublisherLabel(domain);
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

function TagRow({
    styles,
    topicColor,
    label,
    time,
    trailing,
}: {
    styles: ReturnType<typeof makeCardStyle>;
    topicColor: { color: string; bg: string };
    label: string;
    time: string;
    trailing?: ReactNode;
}) {
    return (
        <View style={styles.tag_row}>
            <View style={[styles.tag_pill, { backgroundColor: topicColor.bg }]}>
                <Text style={[styles.tag_text, { color: topicColor.color }]}>{label}</Text>
            </View>
            <Text style={styles.time_text}>{time}</Text>
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
    onPress,
}: {
    theme: Theme;
    style?: object;
    size?: number;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            onPress={onPress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={style}
        >
            <FontAwesomeIcon icon={faEllipsisVertical} size={size} color={theme.text_tertiary} />
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
}: CardFrontProps) => {
    const [imageError, setImageError] = useState(false);
    const { scale } = useMotion();
    const theme = useTheme();
    const styles = useMemo(() => makeCardStyle(theme), [theme]);

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
                    <View style={styles.lead_photo_frame}>
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
                            topicColor={topicColor}
                            label={label}
                            time={time}
                            trailing={
                                <EllipsisButton
                                    theme={theme}
                                    style={styles.ellipsis_btn}
                                    onPress={() => handleEllipsisPress(id)}
                                />
                            }
                        />
                        <Text style={styles.lead_title} numberOfLines={3}>
                            {title}
                        </Text>
                        <SourceRow
                            theme={theme}
                            styles={styles}
                            source={source}
                            source_domain={source_domain}
                            url={url}
                        />
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
                    <TagRow styles={styles} topicColor={topicColor} label={label} time={time} />
                    <Text style={styles.card_title} numberOfLines={3}>
                        {title}
                    </Text>
                    <SourceRow
                        theme={theme}
                        styles={styles}
                        source={source}
                        source_domain={source_domain}
                        url={url}
                    />
                </View>

                <View style={styles.thumbnail_frame}>
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

            {/* The card's own top-right corner, not the tag row -- that row is
                only as wide as the text column, so pushing it to that row's
                end stranded it in the gap before the thumbnail. */}
            <EllipsisButton
                theme={theme}
                style={styles.row_ellipsis_btn}
                onPress={() => handleEllipsisPress(id)}
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
        thumbnail_frame: {
            width: 96,
            height: 96,
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
        lead_photo_frame: {
            width: '100%',
            height: 168,
        },
        lead_photo: {
            width: '100%',
            height: '100%',
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
