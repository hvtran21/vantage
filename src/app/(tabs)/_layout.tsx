import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faHome, faBookmark, faUser } from '@fortawesome/free-solid-svg-icons';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Platform,
    I18nManager,
    type LayoutChangeEvent,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '@/components/Theme';
import { useHaptics } from '@/components/Haptics';
import { TabBarScrollProvider, useTabBarScroll } from '@/components/TabBarScroll';

const INDICATOR_INSET = 6;
const SLIDE = { damping: 18, stiffness: 190, mass: 0.6 };
// How much smaller the bar gets at full collapse -- shrinks everything
// (icons, labels, padding, border) together via transform so nothing gets
// cut off, it's just proportionally smaller.
const COLLAPSED_SCALE = 0.82;

// dimezisBlurView only became dependable in API 31; below that it can no-op.
const ANDROID_BLUR = Platform.OS === 'android' && Number(Platform.Version) >= 31;
const BLURRED = Platform.OS === 'ios' || ANDROID_BLUR;

// Derived from Tabs itself (rather than imported from @react-navigation/
// bottom-tabs) because expo-router re-declares this type on its own, and the
// two have drifted apart before -- this stays correct by construction.
type CustomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

// Fully custom tab bar. react-navigation's default button reserves its own
// bottom padding that can't be overridden cleanly, so we own the layout instead.
function CustomTabBar({ state, descriptors, navigation }: CustomTabBarProps) {
    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const tab_styles = useMemo(() => makeTabStyles(theme), [theme]);
    const [pillWidth, setPillWidth] = useState(0);
    const itemWidth = pillWidth ? pillWidth / state.routes.length : 0;

    const indicatorX = useSharedValue(0);
    const lastItemWidth = useRef(0);
    const { collapse } = useTabBarScroll();
    const haptics = useHaptics();

    useEffect(() => {
        if (!itemWidth) return;
        // flexDirection: 'row' mirrors under RTL, so the travel flips with it.
        const target = state.index * itemWidth * (I18nManager.isRTL ? -1 : 1);
        const resized = lastItemWidth.current !== itemWidth;
        lastItemWidth.current = itemWidth;
        indicatorX.value = resized ? target : withSpring(target, SLIDE);
    }, [state.index, itemWidth, indicatorX]);

    // A tab switch always lands back at full size -- the screen you just
    // left being scrolled down shouldn't leave the bar shrunk on the one you
    // switched to.
    useEffect(() => {
        collapse.value = withTiming(0, { duration: 200 });
    }, [state.index, collapse]);

    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorX.value }],
    }));

    // Scales the whole bar down at once -- icons, labels, padding and border
    // all shrink together, so nothing gets clipped, it just gets smaller.
    const barStyle = useAnimatedStyle(() => ({
        transform: [
            {
                scale: interpolate(
                    collapse.value,
                    [0, 1],
                    [1, COLLAPSED_SCALE],
                    Extrapolation.CLAMP,
                ),
            },
        ],
    }));

    const onPillLayout = (event: LayoutChangeEvent) => {
        setPillWidth(event.nativeEvent.layout.width);
    };

    return (
        <Animated.View style={[tab_styles.wrapper, { bottom: insets.bottom + 16 }, barStyle]}>
            <View style={tab_styles.pill} onLayout={onPillLayout}>
                {BLURRED && (
                    <BlurView
                        intensity={65}
                        tint={theme.dark ? 'dark' : 'light'}
                        experimentalBlurMethod={ANDROID_BLUR ? 'dimezisBlurView' : undefined}
                        style={StyleSheet.absoluteFill}
                    />
                )}

                <LinearGradient
                    colors={[theme.tab_glint, 'transparent']}
                    pointerEvents="none"
                    style={StyleSheet.absoluteFill}
                />

                {itemWidth > 0 && (
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            tab_styles.indicator,
                            { width: itemWidth - INDICATOR_INSET * 2 },
                            I18nManager.isRTL
                                ? { right: INDICATOR_INSET }
                                : { left: INDICATOR_INSET },
                            indicatorStyle,
                        ]}
                    />
                )}

                {state.routes.map((route, index) => {
                    const { options } = descriptors[route.key];
                    const focused = state.index === index;
                    const color = focused ? theme.accent : theme.text_tertiary;
                    const label = options.title ?? route.name;

                    const onPress = () => {
                        const event = navigation.emit({
                            type: 'tabPress',
                            target: route.key,
                            canPreventDefault: true,
                        });
                        if (!focused && !event.defaultPrevented) {
                            haptics.selection();
                            navigation.navigate(route.name);
                        }
                    };

                    return (
                        <Pressable
                            key={route.key}
                            onPress={onPress}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: focused }}
                            accessibilityLabel={label}
                            // A bounded ripple would square off the pill's rounded ends.
                            android_ripple={{
                                color: 'rgba(255, 255, 255, 0.10)',
                                borderless: true,
                                radius: 46,
                            }}
                            style={({ pressed }) => [
                                tab_styles.item,
                                pressed && Platform.OS === 'ios' && { opacity: 0.6 },
                            ]}
                        >
                            {options.tabBarIcon?.({ focused, color, size: 20 })}
                            <Text
                                style={[
                                    tab_styles.label,
                                    { color },
                                    focused && tab_styles.label_focused,
                                ]}
                            >
                                {label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </Animated.View>
    );
}

export default function TabLayout() {
    return (
        <TabBarScrollProvider>
            <Tabs
                tabBar={(props) => <CustomTabBar {...props} />}
                screenOptions={{ headerShown: false }}
            >
                <Tabs.Screen
                    name="index"
                    options={{
                        title: 'Feed',
                        tabBarIcon: ({ color }) => (
                            <FontAwesomeIcon icon={faHome} size={19} color={color as string} />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="profile"
                    options={{
                        title: 'Profile',
                        tabBarIcon: ({ color }) => (
                            <FontAwesomeIcon icon={faUser} size={17} color={color as string} />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="saved"
                    options={{
                        title: 'Saved',
                        tabBarIcon: ({ color }) => (
                            <FontAwesomeIcon icon={faBookmark} size={16} color={color as string} />
                        ),
                    }}
                />
            </Tabs>
        </TabBarScrollProvider>
    );
}

const makeTabStyles = (theme: Theme) =>
    StyleSheet.create({
        // Positioned + shadowed here; no overflow so the shadow isn't clipped.
        wrapper: {
            position: 'absolute',
            left: 20,
            right: 20,
            height: 72,
            borderRadius: 26,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: theme.tab_shadow_opacity,
            shadowRadius: 18,
            elevation: 14,
        },
        // Clips the blur + rounds the corners; separate from wrapper's shadow.
        pill: {
            flex: 1,
            flexDirection: 'row',
            borderRadius: 26,
            overflow: 'hidden',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.tab_border,
            // Translucent only where a real blur backs it.
            backgroundColor:
                Platform.OS === 'ios'
                    ? 'transparent'
                    : ANDROID_BLUR
                      ? theme.tab_bg
                      : theme.elevated,
        },
        indicator: {
            position: 'absolute',
            top: 8,
            bottom: 8,
            borderRadius: 28,
            backgroundColor: theme.accent_soft,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.accent_border,
        },
        item: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            gap: 4,
        },
        label: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 10,
            letterSpacing: 0.3,
        },
        label_focused: {
            fontFamily: 'WorkSans-SemiBold',
        },
    });
