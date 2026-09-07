import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Animated,
    Linking,
    FlatList,
    RefreshControl,
    ActivityIndicator,
    TextInput,
    Keyboard,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useActionSheet, type AnchorRect } from '@/components/ArticleActionSheet';
import { useTabBarScroll } from '@/components/TabBarScroll';
import { getDb } from '@/lib/database';
import { saveArticle, unsaveArticle } from '@/lib/savedArticles';
import { NewsCard } from '@/components/NewsCard';
import { useFeedOptionsSheet } from '@/components/FeedOptionsSheet';
import { TabHeader, HeaderRule, TAB_BAR_INSET } from '@/components/styles';
import { useTheme, type Theme } from '@/components/Theme';
import { faCircleXmark, faMagnifyingGlass, faArrowUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Article from '@/lib/constants';
import getArticles, {
    syncArticles,
    getAllArticles,
    searchArticles,
    cursorAfter,
    type LocalCursor,
} from '@/lib/services';
import { deleteArticlesByAge, canRefreshArticles } from '@/lib/utilities';
import { domainForArticle } from '@/lib/domain';
import { useMotion } from '@/components/Motion';
import { scaleMs, withMotion } from '@/lib/motion';
import ReAnimated, { FadeIn } from 'react-native-reanimated';

type NetworkScope = { key: string; genre?: string; category?: string };

// Cursor pagination needs a single genre or category. CSV "Home" selections
// keep the existing first-batch-only behavior.
const getNetworkScope = (
    activeFilter: string,
    userPreferences: string | null,
): NetworkScope | null => {
    if (activeFilter === 'Top') {
        return { key: 'category:Technology', category: 'Technology' };
    }
    if (activeFilter === 'Home' && userPreferences && !userPreferences.includes(',')) {
        return { key: `genre:${userPreferences}`, genre: userPreferences };
    }
    return null;
};

export default function HomeFeed() {
    const { getToken } = useAuth();
    const theme = useTheme();
    const empty_styles = useMemo(() => makeEmptyStyles(theme), [theme]);
    const search_styles = useMemo(() => makeSearchStyles(theme), [theme]);
    const fab_styles = useMemo(() => makeFabStyles(theme), [theme]);
    const base_template = useMemo(() => makeBaseTemplate(theme), [theme]);
    const [articles, setArticles] = useState<Article[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('Home');

    const fadeAnimArticles = useRef(new Animated.Value(0)).current;
    const slideAnimArticles = useRef(new Animated.Value(12)).current;

    const actionSheet = useActionSheet();
    const feedOptions = useFeedOptionsSheet();
    const { scale } = useMotion();

    const [refreshing, setRefreshing] = useState(false);
    const initialLoadDone = useRef(false);

    // Pagination
    const PAGE_SIZE = 20;
    // Where the local feed left off, by value. A page index would drift the
    // moment blocking a publisher purged its cached rows.
    const [cursor, setCursor] = useState<LocalCursor | undefined>(undefined);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    // Cursor per scope (see getNetworkScope) so Home's and Top's don't clobber each other.
    const [networkCursors, setNetworkCursors] = useState<Record<string, string | null>>({});

    // Search -- always visible now, so "open" is just "has a query" rather
    // than a separate expand/collapse state.
    const [searchQuery, setSearchQuery] = useState('');
    const searchOpen = searchQuery.trim().length > 0;
    const searchInputRef = useRef<TextInput>(null);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const preSearchArticles = useRef<Article[] | null>(null);

    // Scroll-to-top
    const flatListRef = useRef<FlatList>(null);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const scrollTopAnim = useRef(new Animated.Value(0)).current;

    const { onScroll: tabBarOnScroll } = useTabBarScroll();

    const handleScroll = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            tabBarOnScroll(event);

            const y = event.nativeEvent.contentOffset.y;
            const threshold = 1200; // ~10 cards worth of scrolling
            const shouldShow = y > threshold;
            if (shouldShow !== showScrollTop) {
                setShowScrollTop(shouldShow);
                Animated.timing(scrollTopAnim, {
                    toValue: shouldShow ? 1 : 0,
                    duration: scaleMs(scale, 200),
                    useNativeDriver: true,
                }).start();
            }
        },
        [showScrollTop, scrollTopAnim, tabBarOnScroll, scale],
    );

    const scrollToTop = useCallback(() => {
        Keyboard.dismiss();
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, []);

    const loadByFilter = useCallback(
        async (activeFilter: string, from?: LocalCursor): Promise<Article[]> => {
            const userPreferences = await AsyncStorage.getItem('genreSelection');
            if (activeFilter === 'Recent') {
                return await getAllArticles(PAGE_SIZE, from);
            } else if (activeFilter === 'Top') {
                return (await getArticles(undefined, 'Technology', PAGE_SIZE, from)) ?? [];
            }
            if (userPreferences) {
                return (await getArticles(userPreferences, undefined, PAGE_SIZE, from)) ?? [];
            }
            return (await getArticles(undefined, 'Technology', PAGE_SIZE, from)) ?? [];
        },
        [],
    );

    // Prefetches both scopes and records their nextCursor for later load-more.
    // Home and Top are independent requests, so run them concurrently.
    const syncAndCaptureCursors = useCallback(
        async (userPreferences: string | null) => {
            const token = (await getToken()) ?? undefined;
            const [homeOutcome, topOutcome] = await Promise.all([
                userPreferences
                    ? syncArticles(userPreferences, undefined, undefined, token)
                    : Promise.resolve(undefined),
                syncArticles(undefined, 'Technology', undefined, token),
            ]);

            setNetworkCursors((prev) => {
                const next: Record<string, string | null> = {
                    ...prev,
                    'category:Technology': topOutcome?.nextCursor ?? null,
                };
                if (userPreferences && !userPreferences.includes(',')) {
                    next[`genre:${userPreferences}`] = homeOutcome?.nextCursor ?? null;
                }
                return next;
            });
        },
        [getToken],
    );

    const onRefresh = useCallback(async () => {
        Keyboard.dismiss();
        const canRefresh = await canRefreshArticles();
        if (!canRefresh) return;

        setRefreshing(true);
        await deleteArticlesByAge();

        const userPreferences = await AsyncStorage.getItem('genreSelection');
        await syncAndCaptureCursors(userPreferences);

        const newArticles = await loadByFilter(filter);
        setArticles(newArticles);
        setCursor(cursorAfter(newArticles));
        setHasMore(newArticles.length >= PAGE_SIZE);
        setRefreshing(false);
    }, [filter, loadByFilter, syncAndCaptureCursors]);

    const loadNextPage = useCallback(async () => {
        if (loadingMore || !hasMore || searchOpen) return;

        setLoadingMore(true);
        let nextBatch = await loadByFilter(filter, cursor);

        // Local cache ran out, try a network top-up before giving up.
        if (nextBatch.length < PAGE_SIZE) {
            const userPreferences = await AsyncStorage.getItem('genreSelection');
            const scope = getNetworkScope(filter, userPreferences);
            // The API's opaque cursor, distinct from the local keyset one above.
            const networkCursor = scope ? networkCursors[scope.key] : undefined;

            if (scope && networkCursor) {
                const token = (await getToken()) ?? undefined;
                const outcome = await syncArticles(
                    scope.genre,
                    scope.category,
                    networkCursor,
                    token,
                );
                setNetworkCursors((prev) => ({
                    ...prev,
                    // Keep the prior cursor on failure so the next scroll retries.
                    [scope.key]: outcome ? outcome.nextCursor : prev[scope.key],
                }));
                if (outcome) {
                    // Re-read from the same local position; the sync only added
                    // rows further down the order.
                    nextBatch = await loadByFilter(filter, cursor);
                }
            }
        }

        if (nextBatch.length < PAGE_SIZE) {
            setHasMore(false);
        }
        if (nextBatch.length > 0) {
            setArticles((prev) => [...prev, ...nextBatch]);
            setCursor(cursorAfter(nextBatch));
        }
        setLoadingMore(false);
    }, [loadingMore, hasMore, searchOpen, cursor, filter, loadByFilter, networkCursors, getToken]);

    const handleEllipsisPress = useCallback(
        (id: string, anchor: AnchorRect) => {
            Keyboard.dismiss();
            // The row is already in state from rendering the card, so the sheet
            // can open on this tick rather than after a SQLite round trip.
            const article = articles.find((item) => item.id === id);
            if (!article) return;
            actionSheet.open({
                article,
                saved: article.saved === 1,
                anchor,
                onToggleSave: async (next) => {
                    const token = (await getToken()) ?? undefined;
                    // unsaveArticle rolls the SQLite row back to saved=1 on failure
                    // and reports whether it stuck -- the list has to check that
                    // instead of trusting the optimistic value it was passed.
                    let finalSaved = next;
                    if (next) {
                        await saveArticle(article.id, token);
                    } else {
                        const unsaveStuck = await unsaveArticle(article.id, token);
                        finalSaved = !unsaveStuck;
                    }
                    setArticles((prev) =>
                        prev.map((item) =>
                            item.id === article.id ? { ...item, saved: finalSaved ? 1 : 0 } : item,
                        ),
                    );
                },
                onOpenInBrowser: async () => {
                    const supported = await Linking.canOpenURL(article.url);
                    if (supported) await Linking.openURL(article.url);
                },
                onBlocked: (domain) => {
                    setArticles((prev) => prev.filter((item) => domainForArticle(item) !== domain));
                },
            });
        },
        [articles, actionSheet, getToken],
    );

    const animateContent = useCallback(() => {
        const duration = scaleMs(scale, 350);
        Animated.parallel([
            Animated.timing(fadeAnimArticles, { toValue: 1, duration, useNativeDriver: true }),
            Animated.timing(slideAnimArticles, { toValue: 0, duration, useNativeDriver: true }),
        ]).start();
    }, [fadeAnimArticles, slideAnimArticles, scale]);

    const resetContentAnim = useCallback(() => {
        fadeAnimArticles.setValue(0);
        slideAnimArticles.setValue(12);
    }, [fadeAnimArticles, slideAnimArticles]);

    // Search is always visible now; "entering" it just means the query went
    // from empty to non-empty, which is when the pre-search feed gets snapshotted.
    const handleSearchChange = useCallback(
        (text: string) => {
            if (preSearchArticles.current === null && text.trim().length > 0) {
                preSearchArticles.current = articles;
            }
            setSearchQuery(text);
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
            debounceTimer.current = setTimeout(async () => {
                if (text.trim().length === 0) {
                    if (preSearchArticles.current) {
                        setArticles(preSearchArticles.current);
                        preSearchArticles.current = null;
                    }
                    return;
                }
                const token = (await getToken()) ?? undefined;
                const results = await searchArticles(text.trim(), token);
                setArticles(results);
            }, 300);
        },
        [articles, getToken],
    );

    const handleSearchClear = useCallback(() => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        setSearchQuery('');
        searchInputRef.current?.clear();
        Keyboard.dismiss();
        if (preSearchArticles.current) {
            setArticles(preSearchArticles.current);
            preSearchArticles.current = null;
        }
    }, []);

    useEffect(() => {
        return () => {
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
    }, []);

    useEffect(() => {
        resetContentAnim();
        animateContent();
    }, [filter]);

    useFocusEffect(
        useCallback(() => {
            // Entrance animation deliberately does NOT replay here. useFocusEffect
            // re-fires on every focus regain -- including the below-screen focus
            // react-navigation sends mid-drag during iOS's interactive swipe-back
            // from article/[id] -- not just on true first mount. Re-running
            // resetContentAnim/animateContent from here made the feed's fade/slide
            // replay every time you swiped back, since that focus fires while the
            // list is already visible. animateContent() is already invoked once by
            // the initial-load effect and again on deliberate filter changes below;
            // that's the only entrance animation this screen needs.
            //
            // The sheet reads `saved` straight from list state now, so refresh it
            // in case the article screen changed it while we were away.
            (async () => {
                const db = await getDb();
                const rows = (await db.getAllAsync('SELECT id FROM articles WHERE saved = 1')) as {
                    id: string;
                }[];
                const savedIds = new Set(rows.map((row) => row.id));
                setArticles((prev) =>
                    prev.map((item) => {
                        const saved = savedIds.has(item.id) ? 1 : 0;
                        return item.saved === saved ? item : { ...item, saved };
                    }),
                );
            })();
        }, []),
    );

    useEffect(() => {
        const loadArticles = async () => {
            setLoading(true);
            try {
                const existingPreferences = await AsyncStorage.getItem('genreSelection');
                await syncAndCaptureCursors(existingPreferences);
                const loadedArticles = await loadByFilter('Home');
                setArticles(loadedArticles);
                setCursor(cursorAfter(loadedArticles));
                setHasMore(loadedArticles.length >= PAGE_SIZE);
            } catch (error) {
                console.error(`Error occurred: ${error}`);
            } finally {
                setLoading(false);
                animateContent();
                initialLoadDone.current = true;
            }
        };
        loadArticles();
    }, []);

    useEffect(() => {
        if (!initialLoadDone.current) return;
        const applyFilter = async () => {
            setLoading(true);
            try {
                const filtered = await loadByFilter(filter);
                setArticles(filtered);
                setCursor(cursorAfter(filtered));
                setHasMore(filtered.length >= PAGE_SIZE);
            } catch (error) {
                console.error(`Error occurred: ${error}`);
            } finally {
                setLoading(false);
                animateContent();
            }
        };
        applyFilter();
    }, [filter, loadByFilter]);

    const EmptyState = () => (
        <ReAnimated.View
            entering={withMotion(scale, () => FadeIn.duration(scaleMs(scale, 500)))}
            style={empty_styles.container}
        >
            <Text style={empty_styles.title}>
                {searchOpen && searchQuery.length > 0 ? 'No results' : 'No articles yet'}
            </Text>
            <Text style={empty_styles.subtitle}>
                {searchOpen && searchQuery.length > 0
                    ? 'Try different keywords.'
                    : 'Pull down to refresh.'}
            </Text>
        </ReAnimated.View>
    );

    return (
        <SafeAreaProvider>
            <SafeAreaView style={base_template.theme} edges={['top', 'left', 'right']}>
                <View style={base_template.config}>
                    <TabHeader title="Feed" subtitle="Your news" />
                    <HeaderRule />

                    <View style={search_styles.controls}>
                        <View
                            style={[
                                search_styles.search_pill,
                                searchOpen && search_styles.search_pill_active,
                            ]}
                        >
                            <FontAwesomeIcon
                                icon={faMagnifyingGlass}
                                size={13}
                                color={theme.text_tertiary}
                            />
                            <TextInput
                                ref={searchInputRef}
                                style={search_styles.search_input}
                                placeholder="Search articles, sources, authors"
                                placeholderTextColor={theme.text_tertiary}
                                value={searchQuery}
                                onChangeText={handleSearchChange}
                                returnKeyType="search"
                                autoCapitalize="none"
                                autoCorrect={false}
                                onSubmitEditing={() => Keyboard.dismiss()}
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={handleSearchClear} hitSlop={10}>
                                    <FontAwesomeIcon
                                        icon={faCircleXmark}
                                        size={14}
                                        color={theme.text_tertiary}
                                    />
                                </TouchableOpacity>
                            )}
                        </View>

                        <TouchableOpacity
                            onPress={() => {
                                Keyboard.dismiss();
                                feedOptions.open({
                                    filter,
                                    onSelectFilter: setFilter,
                                    onBlockedSourcesPress: () => router.push('/profile'),
                                    onRefreshPress: onRefresh,
                                });
                            }}
                            style={search_styles.filter_pill}
                            activeOpacity={0.7}
                        >
                            <Text style={search_styles.filter_pill_text}>{filter}</Text>
                        </TouchableOpacity>
                    </View>

                    {loading && articles.length === 0 ? (
                        <View style={empty_styles.container}>
                            <ActivityIndicator size="large" color={theme.accent} />
                            <Text style={[empty_styles.subtitle, { marginTop: 16 }]}>
                                Loading articles...
                            </Text>
                        </View>
                    ) : (
                        <Animated.View
                            style={{
                                opacity: fadeAnimArticles,
                                transform: [{ translateY: slideAnimArticles }],
                                flex: 1,
                            }}
                        >
                            <FlatList
                                ref={flatListRef}
                                showsVerticalScrollIndicator={false}
                                data={articles}
                                keyboardShouldPersistTaps="handled"
                                onScroll={handleScroll}
                                scrollEventThrottle={16}
                                contentContainerStyle={
                                    articles.length === 0
                                        ? {
                                              flexGrow: 1,
                                              justifyContent: 'center',
                                              paddingBottom: TAB_BAR_INSET,
                                          }
                                        : { flexGrow: 1, paddingBottom: TAB_BAR_INSET }
                                }
                                bounces={true}
                                alwaysBounceVertical={true}
                                ListEmptyComponent={<EmptyState />}
                                renderItem={({ item, index }) => (
                                    <NewsCard
                                        title={item.title}
                                        url_to_image={item.url_to_image}
                                        published_at={item.published_at}
                                        genre={item.genre ?? ''}
                                        id={item.id}
                                        source={item.source}
                                        source_domain={item.source_domain}
                                        url={item.url}
                                        variant={
                                            index === 0 && !(searchOpen && searchQuery.length > 0)
                                                ? 'lead'
                                                : 'standard'
                                        }
                                        handleEllipsisPress={handleEllipsisPress}
                                    />
                                )}
                                keyExtractor={(item) => item.id}
                                onEndReached={loadNextPage}
                                onEndReachedThreshold={0.5}
                                ListFooterComponent={
                                    loadingMore ? (
                                        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                                            <ActivityIndicator size="small" color={theme.accent} />
                                        </View>
                                    ) : null
                                }
                                refreshControl={
                                    <RefreshControl
                                        refreshing={refreshing}
                                        onRefresh={onRefresh}
                                        tintColor={theme.accent}
                                    />
                                }
                            />
                        </Animated.View>
                    )}

                    <Animated.View
                        pointerEvents={showScrollTop ? 'auto' : 'none'}
                        style={[
                            fab_styles.container,
                            { opacity: scrollTopAnim, transform: [{ scale: scrollTopAnim }] },
                        ]}
                    >
                        <TouchableOpacity
                            onPress={scrollToTop}
                            activeOpacity={0.8}
                            style={fab_styles.button}
                        >
                            <FontAwesomeIcon icon={faArrowUp} size={16} color={theme.on_accent} />
                        </TouchableOpacity>
                    </Animated.View>
                </View>
            </SafeAreaView>
        </SafeAreaProvider>
    );
}

const makeEmptyStyles = (theme: Theme) =>
    StyleSheet.create({
        container: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 40,
        },
        title: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 18,
            color: theme.text_secondary,
            marginBottom: 6,
        },
        subtitle: {
            fontFamily: 'WorkSans-Light',
            fontSize: 14,
            color: theme.text_tertiary,
            textAlign: 'center',
        },
    });

// The always-visible search + filter row that replaced the header's search
// toggle and filter dropdown -- both now just open FeedOptionsSheet.
const makeSearchStyles = (theme: Theme) =>
    StyleSheet.create({
        controls: {
            flexDirection: 'row',
            gap: 8,
            paddingHorizontal: 16,
            paddingBottom: 12,
        },
        search_pill: {
            flex: 1,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 16,
        },
        search_pill_active: {
            borderColor: theme.accent_border,
        },
        search_input: {
            flex: 1,
            fontFamily: 'WorkSans-Regular',
            fontSize: 13,
            color: theme.text,
            padding: 0,
        },
        filter_pill: {
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.accent_soft,
            borderWidth: 1,
            borderColor: theme.accent_border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
        },
        filter_pill_text: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 13,
            color: theme.accent,
        },
    });

const makeFabStyles = (theme: Theme) =>
    StyleSheet.create({
        container: {
            position: 'absolute',
            bottom: 148,
            right: 20,
            zIndex: 20,
        },
        button: {
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.accent,
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: theme.accent,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 12,
            elevation: 8,
        },
    });

const makeBaseTemplate = (theme: Theme) =>
    StyleSheet.create({
        theme: {
            flex: 1,
            backgroundColor: theme.bg,
        },
        config: {
            flex: 1,
            width: '100%',
            flexDirection: 'column',
        },
    });
