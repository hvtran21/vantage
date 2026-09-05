import { useState, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faUser, faCheck, faSignOutAlt, faSignInAlt } from '@fortawesome/free-solid-svg-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser, useAuth } from '@clerk/expo';
import { TabHeader, HeaderRule, theme, topicColors } from '@/components/styles';
import {
    listBlocked,
    listReportedDomains,
    syncBlockedSources,
    unblockSource,
    type BlockedSource,
} from '@/lib/sources';
import { useMotion } from '@/components/Motion';
import { scaleMs, withMotion, type MotionPreference } from '@/lib/motion';
import Animated, { FadeIn } from 'react-native-reanimated';

const genreOptions = [
    'Artificial Intelligence',
    'Machine Learning',
    'Apple',
    'Microsoft',
    'Amazon',
    'Google',
    'Gaming',
    'Cybersecurity',
    'Game development',
    'Nintendo',
    'Space Tech',
    'Startups',
    'Blockchain',
    'Robotics',
];

function GenrePreferences() {
    const [selected, setSelected] = useState<string[]>([]);
    const [saved, setSaved] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const { scale } = useMotion();

    useFocusEffect(
        useCallback(() => {
            const load = async () => {
                const stored = await AsyncStorage.getItem('genreSelection');
                if (stored) setSelected(stored.split(','));
                setLoaded(true);
            };
            load();
        }, []),
    );

    const toggle = async (genre: string) => {
        let next: string[];
        if (selected.includes(genre)) {
            next = selected.filter((g) => g !== genre);
        } else {
            next = [...selected, genre];
        }
        setSelected(next);
        if (next.length > 0) {
            await AsyncStorage.setItem('genreSelection', next.join(','));
        } else {
            await AsyncStorage.removeItem('genreSelection');
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    return (
        <View style={styles.section}>
            <View style={styles.section_header}>
                <Text style={styles.section_label}>INTERESTS</Text>
                {saved && (
                    <Animated.View
                        entering={withMotion(scale, () => FadeIn.duration(scaleMs(scale, 200)))}
                        style={styles.saved_inline}
                    >
                        <FontAwesomeIcon icon={faCheck} size={10} color="#4ade80" />
                        <Text style={styles.saved_inline_text}>Updated</Text>
                    </Animated.View>
                )}
            </View>
            <Text style={styles.section_hint}>
                {selected.length} selected
            </Text>
            <View style={styles.chip_container}>
                {!loaded ? null : genreOptions.map((genre, index) => {
                    const active = selected.includes(genre);
                    const tc = topicColors[genre];
                    return (
                        <TouchableOpacity key={genre} onPress={() => toggle(genre)} activeOpacity={0.7}>
                            <Animated.View
                                entering={withMotion(scale, () =>
                                    FadeIn.duration(scaleMs(scale, 350)).delay(scaleMs(scale, index * 40)),
                                )}
                                style={[
                                    styles.chip,
                                    active && tc && {
                                        backgroundColor: tc.bg,
                                        borderColor: tc.color + '40',
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.chip_text,
                                        active && tc && {
                                            color: tc.color,
                                            fontFamily: 'WorkSans-SemiBold',
                                        },
                                    ]}
                                >
                                    {genre}
                                </Text>
                            </Animated.View>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const MOTION_OPTIONS: { value: MotionPreference; label: string }[] = [
    { value: 'snappy', label: 'Snappy' },
    { value: 'default', label: 'Default' },
    { value: 'off', label: 'Off' },
];

function MotionPreferences() {
    const { preference, setPreference } = useMotion();
    return (
        <View style={styles.section}>
            <Text style={styles.section_label}>MOTION</Text>
            <Text style={styles.section_hint}>How fast animations and transitions play.</Text>
            <View style={styles.motion_row}>
                {MOTION_OPTIONS.map((option) => {
                    const active = preference === option.value;
                    return (
                        <TouchableOpacity
                            key={option.value}
                            onPress={() => setPreference(option.value)}
                            activeOpacity={0.7}
                            style={[styles.motion_option, active && styles.motion_option_active]}
                        >
                            <Text
                                style={[
                                    styles.motion_option_text,
                                    active && styles.motion_option_text_active,
                                ]}
                            >
                                {option.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

function ProfileCard({
    displayName,
    email,
    signedIn,
}: {
    displayName: string;
    email: string;
    signedIn: boolean;
}) {
    return (
        <View style={styles.profile_card}>
            {displayName ? (
                <View style={styles.card_avatar_filled}>
                    <Text style={styles.card_avatar_initial}>{displayName.charAt(0).toUpperCase()}</Text>
                </View>
            ) : (
                <View style={styles.card_avatar_empty}>
                    <FontAwesomeIcon icon={faUser} size={18} color="white" style={{ opacity: 0.15 }} />
                </View>
            )}
            <View style={styles.card_info}>
                <Text style={styles.card_name}>
                    {displayName || (signedIn ? 'Signed in' : 'Not signed in')}
                </Text>
                {email.length > 0 && <Text style={styles.card_email}>{email}</Text>}
            </View>
        </View>
    );
}

// One list rather than two: reporting also blocks, so a separate reported
// section would show the same domain twice.
function BlockedSources() {
    const { isSignedIn, getToken } = useAuth();
    const [sources, setSources] = useState<BlockedSource[]>([]);
    const [reported, setReported] = useState<string[]>([]);

    const load = useCallback(
        async (cancelled: () => boolean = () => false) => {
            const token = isSignedIn ? await getToken() : null;
            await syncBlockedSources(token);
            if (cancelled()) return;
            const blocked = await listBlocked();
            if (cancelled()) return;
            setSources(blocked);
            setReported(token ? await listReportedDomains(token) : []);
        },
        [isSignedIn, getToken],
    );

    // Held in a ref so the focus effect has no dependencies. Clerk's getToken
    // is not referentially stable, so depending on `load` directly re-fired this
    // on every render -- and because load() sets state, that was an unbounded
    // request loop against the API.
    const loadRef = useRef(load);
    loadRef.current = load;

    useFocusEffect(
        useCallback(() => {
            // A slow sync could otherwise land after an unblock and reinstate it.
            let cancelled = false;
            loadRef.current(() => cancelled).catch((error) =>
                console.warn('[profile] could not load sources:', error),
            );
            return () => {
                cancelled = true;
            };
        }, []),
    );

    const handleUnblock = useCallback(
        (domain: string) => {
            // Drop it optimistically, but put it back if the server refused --
            // otherwise the next sync silently reinstates it with no explanation.
            setSources((prev) => prev.filter((item) => item.source_domain !== domain));
            (async () => {
                const token = isSignedIn ? await getToken() : null;
                if (!(await unblockSource(domain, token))) {
                    setSources(await listBlocked());
                }
            })().catch((error) => console.warn('[profile] unblock failed:', error));
        },
        [isSignedIn, getToken],
    );

    return (
        <View style={styles.section}>
            <Text style={styles.section_label}>SOURCES</Text>
            <Text style={styles.section_hint}>
                Publishers you have blocked. Their articles stay out of your feed.
            </Text>

            {sources.length === 0 ? (
                <Text style={styles.section_hint}>
                    Nothing blocked yet. Use the menu on any article to block its publisher.
                </Text>
            ) : (
                sources.map((source, index) => (
                    <View
                        key={source.source_domain}
                        style={[
                            styles.source_row,
                            index === 0 && styles.source_row_first,
                            index === sources.length - 1 && styles.source_row_last,
                        ]}
                    >
                        <View style={styles.source_info}>
                            <Text style={styles.source_domain} numberOfLines={1}>
                                {source.source_domain}
                            </Text>
                            {reported.includes(source.source_domain) && (
                                <View style={styles.reported_badge}>
                                    <Text style={styles.reported_text}>REPORTED</Text>
                                </View>
                            )}
                        </View>
                        <TouchableOpacity
                            onPress={() => handleUnblock(source.source_domain)}
                            style={styles.unblock_hit}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.unblock_text}>Unblock</Text>
                        </TouchableOpacity>
                    </View>
                ))
            )}
        </View>
    );
}

export default function ProfileScreen() {
    const { user } = useUser();
    const { signOut } = useAuth();
    const isSignedIn = !!user;

    const handleSignOut = async () => {
        await signOut();
        await AsyncStorage.removeItem('skippedAuth');
        router.replace('/sign-in');
    };

    const handleSignIn = () => {
        router.push('/sign-in');
    };

    return (
        <SafeAreaProvider>
            <SafeAreaView style={styles.theme} edges={['top', 'left', 'right']}>
                <TabHeader title="Profile" subtitle="Your account" />
                <HeaderRule />

                <ScrollView
                    contentContainerStyle={styles.scroll_content}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.section}>
                        <Text style={styles.section_label}>PROFILE</Text>
                        <ProfileCard
                            displayName={user?.fullName ?? ''}
                            email={user?.primaryEmailAddress?.emailAddress ?? ''}
                            signedIn={isSignedIn}
                        />
                        {isSignedIn ? (
                            <TouchableOpacity
                                style={styles.sign_out_button}
                                onPress={handleSignOut}
                                activeOpacity={0.7}
                            >
                                <FontAwesomeIcon icon={faSignOutAlt} size={14} color={theme.danger} />
                                <Text style={styles.sign_out_text}>Sign out</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={styles.sign_out_button}
                                onPress={handleSignIn}
                                activeOpacity={0.7}
                            >
                                <FontAwesomeIcon icon={faSignInAlt} size={14} color={theme.accent} />
                                <Text style={[styles.sign_out_text, { color: theme.accent }]}>Sign in</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    <MotionPreferences />

                    <BlockedSources />

                    <GenrePreferences />
                </ScrollView>
            </SafeAreaView>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    theme: {
        flex: 1,
        backgroundColor: theme.bg,
    },
    scroll_content: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 140,
    },
    section: {
        marginBottom: 32,
    },
    section_header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    section_label: {
        fontFamily: 'WorkSans-SemiBold',
        fontSize: 11,
        color: theme.text_tertiary,
        letterSpacing: 2,
        marginBottom: 12,
    },
    section_hint: {
        fontFamily: 'WorkSans-Light',
        fontSize: 13,
        color: theme.text_tertiary,
        marginTop: -6,
        marginBottom: 14,
    },
    saved_inline: {
        position: 'absolute',
        right: 0,
        top: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    saved_inline_text: {
        fontFamily: 'WorkSans-Regular',
        fontSize: 12,
        color: '#4ade80',
    },
    source_row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.border,
    },
    // Without this the first domain sits 26pt below the hint, where every other
    // section's content starts at 14.
    source_row_first: {
        paddingTop: 0,
    },
    // A rule under the last row reads as a section divider that isn't one; the
    // feed's own list omits its separator the same way.
    source_row_last: {
        borderBottomWidth: 0,
    },
    source_info: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    source_domain: {
        flexShrink: 1,
        fontFamily: 'WorkSans-Regular',
        // 14 matches the other list/control labels on this screen; 15 was off-scale.
        fontSize: 14,
        color: theme.text,
    },
    reported_badge: {
        backgroundColor: 'rgba(239, 68, 68, 0.10)',
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    reported_text: {
        fontFamily: 'WorkSans-SemiBold',
        fontSize: 11,
        letterSpacing: 0.8,
        color: theme.danger,
    },
    // Padded to a 44pt target rather than relying on hitSlop alone, which left
    // it the smallest tappable thing on the screen.
    unblock_hit: {
        justifyContent: 'center',
        minHeight: 44,
        paddingLeft: 12,
    },
    unblock_text: {
        fontFamily: 'WorkSans-SemiBold',
        fontSize: 13,
        color: theme.accent,
    },
    chip_container: {
        flexWrap: 'wrap',
        flexDirection: 'row',
        gap: 8,
    },
    motion_row: {
        flexDirection: 'row',
        gap: 8,
    },
    motion_option: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
    },
    motion_option_active: {
        backgroundColor: theme.accent_soft,
        borderColor: theme.accent_border,
    },
    motion_option_text: {
        fontFamily: 'WorkSans-Regular',
        fontSize: 14,
        color: theme.text_secondary,
    },
    motion_option_text_active: {
        fontFamily: 'WorkSans-SemiBold',
        color: theme.accent,
    },
    chip: {
        backgroundColor: theme.surface,
        height: 42,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 21,
        paddingHorizontal: 18,
        borderWidth: 1,
        borderColor: theme.border,
    },
    chip_text: {
        color: theme.text_secondary,
        fontFamily: 'WorkSans-Regular',
        fontSize: 14,
    },
    profile_card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 16,
    },
    card_avatar_filled: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: theme.accent_soft,
        borderWidth: 1,
        borderColor: theme.accent_border,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    card_avatar_initial: {
        fontFamily: 'WorkSans-Bold',
        fontSize: 18,
        color: theme.accent,
    },
    card_avatar_empty: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: theme.elevated,
        borderWidth: 1,
        borderColor: theme.border,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    card_info: {
        flex: 1,
    },
    card_name: {
        fontFamily: 'WorkSans-SemiBold',
        fontSize: 16,
        color: theme.text,
    },
    card_email: {
        fontFamily: 'WorkSans-Light',
        fontSize: 13,
        color: theme.text_tertiary,
        marginTop: 2,
    },
    sign_out_button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 12,
        paddingVertical: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
    },
    sign_out_text: {
        fontFamily: 'WorkSans-SemiBold',
        fontSize: 14,
        color: theme.danger,
    },
});
