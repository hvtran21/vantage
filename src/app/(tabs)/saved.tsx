import { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Linking } from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faBookmark } from '@fortawesome/free-solid-svg-icons';
import Article from '@/lib/constants';
import { useActionSheet, type AnchorRect } from '@/components/ArticleActionSheet';
import { getSavedArticles } from '@/lib/services';
import { syncSavedArticles, unsaveArticle } from '@/lib/savedArticles';
import { NewsCard } from '@/components/NewsCard';
import { TabHeader, HeaderRule, TAB_BAR_INSET } from '@/components/styles';
import { useTheme, type Theme } from '@/components/Theme';
import { useMotion } from '@/components/Motion';
import { scaleMs, withMotion } from '@/lib/motion';
import { useTabBarScroll } from '@/components/TabBarScroll';
import Animated, { FadeIn } from 'react-native-reanimated';

function SavedEmptyState({
    scale,
    styles,
}: {
    scale: number;
    styles: ReturnType<typeof makeStyles>;
}) {
    return (
        <Animated.View
            entering={withMotion(scale, () => FadeIn.duration(scaleMs(scale, 500)))}
            style={styles.empty_container}
        >
            <View style={styles.empty_icon_circle}>
                <FontAwesomeIcon icon={faBookmark} size={28} color="white" style={{ opacity: 0.12 }} />
            </View>
            <Text style={styles.empty_title}>Nothing saved yet</Text>
            <Text style={styles.empty_subtitle}>
                Tap the bookmark on any article to save it for later.
            </Text>
        </Animated.View>
    );
}

export default function SavedScreen() {
    const [savedArticles, setSavedArticles] = useState<Article[]>([]);
    const actionSheet = useActionSheet();
    const { onScroll: tabBarOnScroll } = useTabBarScroll();
    const { scale } = useMotion();
    const { getToken } = useAuth();
    const theme = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);

    // Held in a ref so the focus effect has no dependencies. Clerk's getToken
    // is not referentially stable, so depending on it directly re-fired this
    // on every render -- and since the effect itself calls setState, that was
    // an unbounded request loop against the API.
    const getTokenRef = useRef(getToken);
    getTokenRef.current = getToken;

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            (async () => {
                // Pushes anything saved offline, pulls in whatever another
                // device saved, then reads back the merged local state.
                const token = (await getTokenRef.current()) ?? undefined;
                await syncSavedArticles(token);
                if (cancelled) return;
                setSavedArticles(await getSavedArticles());
            })().catch((error) => console.warn('[saved] could not load saved articles:', error));
            return () => {
                cancelled = true;
            };
        }, []),
    );

    const handleEllipsisPress = useCallback(
        (id: string, anchor: AnchorRect) => {
            // Already in state from rendering the row, so the sheet opens on this
            // tick. Everything in this list is saved by definition.
            const article = savedArticles.find((item) => item.id === id);
            if (!article) return;
            actionSheet.open({
                article,
                saved: true,
                anchor,
                onToggleSave: async () => {
                    const token = (await getToken()) ?? undefined;
                    await unsaveArticle(article.id, token);
                    setSavedArticles(await getSavedArticles());
                },
                onOpenInBrowser: async () => {
                    const supported = await Linking.canOpenURL(article.url);
                    if (supported) await Linking.openURL(article.url);
                },
            });
        },
        [savedArticles, actionSheet, getToken],
    );

    return (
        <SafeAreaProvider>
            <SafeAreaView style={styles.theme} edges={['top', 'left', 'right']}>
                <TabHeader
                    title="Saved"
                    subtitle="Your collection"
                    rightAccessory={
                        savedArticles.length > 0 ? (
                            <View style={styles.count_badge}>
                                <Text style={styles.count_text}>{savedArticles.length}</Text>
                            </View>
                        ) : undefined
                    }
                />
                <HeaderRule />

                <FlatList
                    showsVerticalScrollIndicator={false}
                    onScroll={tabBarOnScroll}
                    scrollEventThrottle={16}
                    data={savedArticles}
                    contentContainerStyle={
                        savedArticles.length === 0
                            ? {
                                  flexGrow: 1,
                                  justifyContent: 'center',
                                  paddingBottom: TAB_BAR_INSET,
                              }
                            : { flexGrow: 1, paddingBottom: TAB_BAR_INSET }
                    }
                    ListEmptyComponent={<SavedEmptyState scale={scale} styles={styles} />}
                    renderItem={({ item }) => (
                        <NewsCard
                            title={item.title}
                            url_to_image={item.url_to_image}
                            published_at={item.published_at}
                            genre={item.genre ?? ''}
                            id={item.id}
                            source={item.source}
                            source_domain={item.source_domain}
                            url={item.url}
                            handleEllipsisPress={handleEllipsisPress}
                        />
                    )}
                    keyExtractor={(item) => item.id}
                />
            </SafeAreaView>
        </SafeAreaProvider>
    );
}

const makeStyles = (theme: Theme) =>
    StyleSheet.create({
        theme: {
            flex: 1,
            backgroundColor: theme.bg,
        },
        count_badge: {
            backgroundColor: theme.accent_soft,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 4,
        },
        count_text: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 13,
            color: theme.accent,
        },
        empty_container: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 48,
        },
        empty_icon_circle: {
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: theme.surface,
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: 20,
        },
        empty_title: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 18,
            color: theme.text_secondary,
            marginBottom: 8,
        },
        empty_subtitle: {
            fontFamily: 'WorkSans-Light',
            fontSize: 14,
            color: theme.text_tertiary,
            textAlign: 'center',
            lineHeight: 20,
        },
    });
