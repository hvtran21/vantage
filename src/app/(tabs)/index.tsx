import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Animated,
    TouchableHighlight,
    TouchableWithoutFeedback,
    Linking,
    FlatList,
    RefreshControl,
    ActivityIndicator,
    TextInput,
    Keyboard,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useActionSheet } from '@/components/ArticleActionSheet';
import { getDb } from '@/lib/database';
import { NewsCard } from '@/components/NewsCard';
import { TabHeader, HeaderRule, HorizonalLine, theme, TAB_BAR_INSET } from '@/components/styles';
import {
    faHouse,
    faAngleDown,
    faAngleUp,
    faBolt,
    faClock,
    faCircleXmark,
    faMagnifyingGlass,
    faXmark,
    faArrowUp,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { IconProp } from '@fortawesome/fontawesome-svg-core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Article from '@/lib/constants';
import getArticles, { syncArticles, getAllArticles, searchArticles } from '@/lib/services';
import { deleteArticlesByAge, canRefreshArticles } from '@/lib/utilities';
import { domainForArticle } from '@/lib/domain';
import { useMotion } from '@/components/Motion';
import { scaleMs, withMotion } from '@/lib/motion';
import ReAnimated, { FadeIn } from 'react-native-reanimated';

type MenuOptionProp = {
    title: string;
    icon: IconProp;
    selected: boolean;
    onPress: () => void;
};

const MenuOption = ({ title, selected, icon, onPress }: MenuOptionProp) => {
    return (
        <TouchableHighlight onPress={onPress} underlayColor="rgba(255,255,255,0.04)" style={{ borderRadius: 10 }}>
            <View style={[menu_styles.option_row, selected && menu_styles.option_selected]}>
                <View style={menu_styles.icon_wrapper}>
                    <FontAwesomeIcon
                        icon={icon}
                        size={13}
                        style={{ color: selected ? theme.accent : 'white', opacity: selected ? 1 : 0.45 }}
                    />
                </View>
                <Text style={[menu_styles.option_text, selected && { opacity: 1, color: theme.accent }]}>
                    {title}
                </Text>
            </View>
        </TouchableHighlight>
    );
};

interface MenuFilterProp {
    setFilter: (filterType: string) => void;
    activeFilter: string;
}

const FilterMenu = ({ setFilter, activeFilter }: MenuFilterProp) => {
    return (
        <View style={menu_styles.menu_inner}>
            <MenuOption title="Home" icon={faHouse} selected={activeFilter === 'Home'} onPress={() => setFilter('Home')} />
            <MenuOption title="Recent" icon={faClock} selected={activeFilter === 'Recent'} onPress={() => setFilter('Recent')} />
            <MenuOption title="Top" icon={faBolt} selected={activeFilter === 'Top'} onPress={() => setFilter('Top')} />
        </View>
    );
};

type NetworkScope = { key: string; genre?: string; category?: string };

// Cursor pagination needs a single genre or category. CSV "Home" selections
// keep the existing first-batch-only behavior.
const getNetworkScope = (activeFilter: string, userPreferences: string | null): NetworkScope | null => {
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
    const [articles, setArticles] = useState<Article[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('Home');

    const [visible, setVisible] = useState(false);
    const heightAnim = useRef(new Animated.Value(0)).current;
    const fadeAnimArticles = useRef(new Animated.Value(0)).current;
    const slideAnimArticles = useRef(new Animated.Value(12)).current;

    const actionSheet = useActionSheet();
    const { scale } = useMotion();

    const [refreshing, setRefreshing] = useState(false);
    const initialLoadDone = useRef(false);

    // Pagination
    const PAGE_SIZE = 20;
    const [page, setPage] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    // Cursor per scope (see getNetworkScope) so Home's and Top's don't clobber each other.
    const [networkCursors, setNetworkCursors] = useState<Record<string, string | null>>({});

    // Search
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchAnim = useRef(new Animated.Value(0)).current;
    const searchInputRef = useRef<TextInput>(null);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const preSearchArticles = useRef<Article[]>([]);

    // Scroll-to-top
    const flatListRef = useRef<FlatList>(null);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const scrollTopAnim = useRef(new Animated.Value(0)).current;

    const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
        const y = event.nativeEvent.contentOffset.y;
        const threshold = 1200; // ~10 cards worth of scrolling
        const shouldShow = y > threshold;
        if (shouldShow !== showScrollTop) {
            setShowScrollTop(shouldShow);
            Animated.timing(scrollTopAnim, { toValue: shouldShow ? 1 : 0, duration: 200, useNativeDriver: true }).start();
        }
    }, [showScrollTop, scrollTopAnim]);

    const scrollToTop = useCallback(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, []);

    const loadByFilter = useCallback(async (activeFilter: string, offset: number = 0): Promise<Article[]> => {
        const userPreferences = await AsyncStorage.getItem('genreSelection');
        if (activeFilter === 'Recent') {
            return await getAllArticles(PAGE_SIZE, offset);
        } else if (activeFilter === 'Top') {
            return (await getArticles(undefined, 'Technology', PAGE_SIZE, offset)) ?? [];
        }
        if (userPreferences) {
            return (await getArticles(userPreferences, undefined, PAGE_SIZE, offset)) ?? [];
        }
        return (await getArticles(undefined, 'Technology', PAGE_SIZE, offset)) ?? [];
    }, []);

    // Prefetches both scopes and records their nextCursor for later load-more.
    // Home and Top are independent requests, so run them concurrently.
    const syncAndCaptureCursors = useCallback(async (userPreferences: string | null) => {
        const token = (await getToken()) ?? undefined;
        const [homeOutcome, topOutcome] = await Promise.all([
            userPreferences ? syncArticles(userPreferences, undefined, undefined, token) : Promise.resolve(undefined),
            syncArticles(undefined, 'Technology', undefined, token),
        ]);

        setNetworkCursors((prev) => {
            const next: Record<string, string | null> = { ...prev, 'category:Technology': topOutcome?.nextCursor ?? null };
            if (userPreferences && !userPreferences.includes(',')) {
                next[`genre:${userPreferences}`] = homeOutcome?.nextCursor ?? null;
            }
            return next;
        });
    }, [getToken]);

    const onRefresh = useCallback(async () => {
        const canRefresh = await canRefreshArticles();
        if (!canRefresh) return;

        setRefreshing(true);
        await deleteArticlesByAge();

        const userPreferences = await AsyncStorage.getItem('genreSelection');
        await syncAndCaptureCursors(userPreferences);

        const newArticles = await loadByFilter(filter, 0);
        setArticles(newArticles);
        setPage(0);
        setHasMore(newArticles.length >= PAGE_SIZE);
        setRefreshing(false);
    }, [filter, loadByFilter, syncAndCaptureCursors]);

    const loadNextPage = useCallback(async () => {
        if (loadingMore || !hasMore || searchOpen) return;

        setLoadingMore(true);
        const nextOffset = (page + 1) * PAGE_SIZE;
        let nextBatch = await loadByFilter(filter, nextOffset);

        // Local cache ran out, try a network top-up before giving up.
        if (nextBatch.length < PAGE_SIZE) {
            const userPreferences = await AsyncStorage.getItem('genreSelection');
            const scope = getNetworkScope(filter, userPreferences);
            const cursor = scope ? networkCursors[scope.key] : undefined;

            if (scope && cursor) {
                const token = (await getToken()) ?? undefined;
                const outcome = await syncArticles(scope.genre, scope.category, cursor, token);
                setNetworkCursors((prev) => ({
                    ...prev,
                    // Keep the prior cursor on failure so the next scroll retries.
                    [scope.key]: outcome ? outcome.nextCursor : prev[scope.key],
                }));
                if (outcome) {
                    nextBatch = await loadByFilter(filter, nextOffset);
                }
            }
        }

        if (nextBatch.length < PAGE_SIZE) {
            setHasMore(false);
        }
        if (nextBatch.length > 0) {
            setArticles((prev) => [...prev, ...nextBatch]);
            setPage((prev) => prev + 1);
        }
        setLoadingMore(false);
    }, [loadingMore, hasMore, searchOpen, page, filter, loadByFilter, networkCursors, getToken]);

    const handleEllipsisPress = useCallback(
        (id: string) => {
            // The row is already in state from rendering the card, so the sheet
            // can open on this tick rather than after a SQLite round trip.
            const article = articles.find((item) => item.id === id);
            if (!article) return;
            actionSheet.open({
                article,
                saved: article.saved === 1,
                onToggleSave: async (next) => {
                    const db = await getDb();
                    await db.runAsync('UPDATE articles SET saved = ? WHERE id = ?', [
                        next ? 1 : 0,
                        article.id,
                    ]);
                    setArticles((prev) =>
                        prev.map((item) =>
                            item.id === article.id ? { ...item, saved: next ? 1 : 0 } : item,
                        ),
                    );
                },
                onOpenInBrowser: async () => {
                    const supported = await Linking.canOpenURL(article.url);
                    if (supported) await Linking.openURL(article.url);
                },
                onBlocked: (domain) => {
                    setArticles((prev) =>
                        prev.filter((item) => domainForArticle(item) !== domain),
                    );
                },
            });
        },
        [articles, actionSheet],
    );

    const animateContent = useCallback(() => {
        Animated.parallel([
            Animated.timing(fadeAnimArticles, { toValue: 1, duration: 350, useNativeDriver: true }),
            Animated.timing(slideAnimArticles, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]).start();
    }, [fadeAnimArticles, slideAnimArticles]);

    const resetContentAnim = useCallback(() => {
        fadeAnimArticles.setValue(0);
        slideAnimArticles.setValue(12);
    }, [fadeAnimArticles, slideAnimArticles]);

    const toggleMenu = useCallback(() => {
        const opening = !visible;
        setVisible(opening);
        Animated.timing(heightAnim, { toValue: opening ? 1 : 0, duration: 120, useNativeDriver: true }).start();
    }, [visible, heightAnim]);

    // Search
    const toggleSearch = useCallback(() => {
        const opening = !searchOpen;
        setSearchOpen(opening);
        Animated.timing(searchAnim, { toValue: opening ? 1 : 0, duration: 200, useNativeDriver: false }).start(() => {
            if (opening) {
                searchInputRef.current?.focus();
            } else {
                setSearchQuery('');
                if (preSearchArticles.current.length > 0) {
                    setArticles(preSearchArticles.current);
                    preSearchArticles.current = [];
                }
                Keyboard.dismiss();
            }
        });
    }, [searchOpen, searchAnim]);

    const handleSearchChange = useCallback((text: string) => {
        setSearchQuery(text);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(async () => {
            if (text.trim().length === 0) {
                if (preSearchArticles.current.length > 0) setArticles(preSearchArticles.current);
                return;
            }
            const results = await searchArticles(text.trim());
            setArticles(results);
        }, 300);
    }, []);

    const handleSearchOpen = useCallback(() => {
        preSearchArticles.current = articles;
        toggleSearch();
    }, [articles, toggleSearch]);

    const handleSearchClear = useCallback(() => {
        setSearchQuery('');
        searchInputRef.current?.clear();
        if (preSearchArticles.current.length > 0) setArticles(preSearchArticles.current);
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
            if (initialLoadDone.current) {
                resetContentAnim();
                animateContent();
            }
            // The sheet reads `saved` straight from list state now, so refresh it
            // in case the article screen changed it while we were away.
            (async () => {
                const db = await getDb();
                const rows = (await db.getAllAsync(
                    'SELECT id FROM articles WHERE saved = 1',
                )) as { id: string }[];
                const savedIds = new Set(rows.map((row) => row.id));
                setArticles((prev) =>
                    prev.map((item) => {
                        const saved = savedIds.has(item.id) ? 1 : 0;
                        return item.saved === saved ? item : { ...item, saved };
                    }),
                );
            })();
        }, [resetContentAnim, animateContent]),
    );

    useEffect(() => {
        const loadArticles = async () => {
            setLoading(true);
            try {
                const existingPreferences = await AsyncStorage.getItem('genreSelection');
                await syncAndCaptureCursors(existingPreferences);
                const loadedArticles = await loadByFilter('Home', 0);
                setArticles(loadedArticles);
                setPage(0);
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
                const filtered = await loadByFilter(filter, 0);
                setArticles(filtered);
                setPage(0);
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

    const searchBarHeight = searchAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 56],
    });

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
                    <TabHeader
                        title="Feed"
                        subtitle="Your news"
                        rightAccessory={
                            <View style={base_template.header_actions}>
                                <TouchableOpacity
                                    onPress={searchOpen ? toggleSearch : handleSearchOpen}
                                    style={search_styles.icon_btn}
                                    activeOpacity={0.6}
                                    hitSlop={6}
                                >
                                    <FontAwesomeIcon
                                        icon={searchOpen ? faXmark : faMagnifyingGlass}
                                        size={searchOpen ? 16 : 15}
                                        color="white"
                                        style={{ opacity: searchOpen ? 0.5 : 0.35 }}
                                    />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={toggleMenu}
                                    style={menu_styles.trigger}
                                    activeOpacity={0.7}
                                >
                                    <Text style={menu_styles.trigger_text}>{filter}</Text>
                                    <FontAwesomeIcon
                                        icon={visible ? faAngleUp : faAngleDown}
                                        size={11}
                                        style={{ color: 'white', opacity: 0.4 }}
                                    />
                                </TouchableOpacity>

                                <Animated.View
                                    pointerEvents={visible ? 'auto' : 'none'}
                                    style={[menu_styles.dropdown, { transform: [{ scaleY: heightAnim }], opacity: heightAnim }]}
                                >
                                    <FilterMenu
                                        setFilter={(f) => {
                                            setFilter(f);
                                            Animated.timing(heightAnim, { toValue: 0, duration: 100, useNativeDriver: true }).start();
                                            setVisible(false);
                                        }}
                                        activeFilter={filter}
                                    />
                                </Animated.View>
                            </View>
                        }
                    />
                    <HeaderRule />

                    <Animated.View style={[search_styles.bar_wrapper, { height: searchBarHeight, opacity: searchAnim }]}>
                        <View style={search_styles.bar}>
                            <FontAwesomeIcon icon={faMagnifyingGlass} size={13} color="white" style={{ opacity: 0.25, marginRight: 10 }} />
                            <TextInput
                                ref={searchInputRef}
                                style={search_styles.input}
                                placeholder="Search articles..."
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
                                    <FontAwesomeIcon icon={faCircleXmark} size={14} color="white" style={{ opacity: 0.25 }} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </Animated.View>

                    {visible && (
                        <TouchableWithoutFeedback onPress={toggleMenu}>
                            <View style={menu_styles.backdrop} />
                        </TouchableWithoutFeedback>
                    )}

                    {loading && articles.length === 0 ? (
                        <View style={empty_styles.container}>
                            <ActivityIndicator size="large" color={theme.accent} />
                            <Text style={[empty_styles.subtitle, { marginTop: 16 }]}>Loading articles...</Text>
                        </View>
                    ) : (
                        <Animated.View style={{ opacity: fadeAnimArticles, transform: [{ translateY: slideAnimArticles }], flex: 1 }}>
                            <FlatList
                                ref={flatListRef}
                                showsVerticalScrollIndicator={false}
                                data={articles}
                                keyboardShouldPersistTaps="handled"
                                onScroll={handleScroll}
                                scrollEventThrottle={100}
                                contentContainerStyle={
                                    articles.length === 0
                                        ? { flexGrow: 1, justifyContent: 'center', paddingBottom: TAB_BAR_INSET }
                                        : { flexGrow: 1, paddingBottom: TAB_BAR_INSET }
                                }
                                bounces={true}
                                alwaysBounceVertical={true}
                                ListEmptyComponent={<EmptyState />}
                                ItemSeparatorComponent={() => <HorizonalLine />}
                                renderItem={({ item }) => (
                                    <NewsCard
                                        title={item.title}
                                        url_to_image={item.url_to_image}
                                        published_at={item.published_at}
                                        genre={item.genre ?? ''}
                                        id={item.id}
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
                                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
                                }
                            />
                        </Animated.View>
                    )}

                    <Animated.View
                        pointerEvents={showScrollTop ? 'auto' : 'none'}
                        style={[fab_styles.container, { opacity: scrollTopAnim, transform: [{ scale: scrollTopAnim }] }]}
                    >
                        <TouchableOpacity onPress={scrollToTop} activeOpacity={0.8} style={fab_styles.button}>
                            <FontAwesomeIcon icon={faArrowUp} size={16} color="white" />
                        </TouchableOpacity>
                    </Animated.View>

                </View>
            </SafeAreaView>
        </SafeAreaProvider>
    );
}

const empty_styles = StyleSheet.create({
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

const search_styles = StyleSheet.create({
    icon_btn: {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: theme.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bar_wrapper: {
        overflow: 'hidden',
        paddingHorizontal: 20,
    },
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surface,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: theme.border,
    },
    input: {
        flex: 1,
        fontFamily: 'WorkSans-Regular',
        fontSize: 15,
        color: 'white',
        padding: 0,
    },
});

const menu_styles = StyleSheet.create({
    trigger: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surface,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 6,
        borderWidth: 1,
        borderColor: theme.border,
    },
    trigger_text: {
        fontFamily: 'WorkSans-Regular',
        fontSize: 13,
        color: theme.text_secondary,
    },
    option_text: {
        opacity: 0.6,
        fontFamily: 'WorkSans-Regular',
        fontSize: 15,
        color: 'white',
    },
    option_row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 11,
        paddingHorizontal: 14,
        borderRadius: 10,
    },
    option_selected: {
        backgroundColor: theme.accent_soft,
    },
    icon_wrapper: {
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    menu_inner: {
        padding: 6,
    },
    dropdown: {
        position: 'absolute',
        top: 44,
        right: 0,
        backgroundColor: theme.elevated,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 12,
        zIndex: 10,
        width: 150,
        transformOrigin: 'top right',
        overflow: 'hidden',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 5,
    },
});

const fab_styles = StyleSheet.create({
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

const base_template = StyleSheet.create({
    theme: {
        flex: 1,
        backgroundColor: theme.bg,
    },
    config: {
        flex: 1,
        width: '100%',
        flexDirection: 'column',
    },
    header_actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        overflow: 'visible',
        zIndex: 10,
    },
});
