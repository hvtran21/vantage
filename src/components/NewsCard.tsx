import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { theme, getTopicColor } from '@/components/styles';
import { useMotion } from '@/components/Motion';
import { scaleMs, withMotion } from '@/lib/motion';

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

export { formatDate };

interface CardFrontProps {
    title: string;
    url_to_image: string;
    published_at: string;
    genre: string;
    id: string;
    handleEllipsisPress: (id: string) => void;
}

const fallBackImage = require('@/assets/images/computer_2.jpg');

export const NewsCard = ({
    title,
    url_to_image,
    published_at,
    genre,
    id,
    handleEllipsisPress,
}: CardFrontProps) => {
    const [imageError, setImageError] = useState(false);
    const { scale } = useMotion();

    const time = relativeTime(published_at);
    const imageSource = url_to_image && !imageError ? { uri: url_to_image } : fallBackImage;
    const label = genre === '' ? 'Top' : genre;
    const topicColor = getTopicColor(label);

    useEffect(() => {
        if (url_to_image) {
            Image.prefetch(url_to_image, 'disk');
        }
    }, [url_to_image]);

    const handleCardPress = () => {
        router.push({ pathname: '/article/[id]', params: { id } });
    };

    return (
        <Animated.View
            entering={withMotion(scale, () => FadeIn.duration(scaleMs(scale, 300)))}
            style={card_style.main_card}
        >
            <TouchableOpacity
                onPress={handleCardPress}
                activeOpacity={0.65}
                style={card_style.card_touchable}
            >
                <View style={card_style.text_column}>
                    <View style={card_style.tag_row}>
                        <View style={[card_style.tag_pill, { backgroundColor: topicColor.bg }]}>
                            <Text style={[card_style.tag_text, { color: topicColor.color }]}>
                                {label}
                            </Text>
                        </View>
                        <Text style={card_style.time_text}>{time}</Text>
                    </View>

                    <Text style={card_style.card_title} numberOfLines={3}>
                        {title}
                    </Text>
                </View>

                <View style={card_style.thumbnail_frame}>
                    <Image
                        source={imageSource}
                        alt="Article thumbnail"
                        style={card_style.thumbnail_image}
                        contentFit="cover"
                        onError={() => setImageError(true)}
                        transition={200}
                    />
                    <TouchableOpacity
                        onPress={() => handleEllipsisPress(id)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        style={card_style.ellipsis_btn}
                    >
                        <FontAwesomeIcon icon={faEllipsisVertical} color="white" size={10} />
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
};

export const card_style = StyleSheet.create({
    main_card: {
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    card_touchable: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    text_column: {
        flex: 1,
        paddingRight: 16,
    },
    tag_row: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        marginLeft: -1,
        gap: 8,
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
    thumbnail_frame: {
        width: 96,
        height: 96,
    },
    thumbnail_image: {
        width: '100%',
        height: '100%',
        borderRadius: 14,
    },
    ellipsis_btn: {
        position: 'absolute',
        bottom: 5,
        right: 5,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        justifyContent: 'center',
        alignItems: 'center',
    },
});

export default NewsCard;
