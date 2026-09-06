import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
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
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '@/components/Theme';

const INDICATOR_INSET = 6;
const SLIDE = { damping: 18, stiffness: 190, mass: 0.6 };

// dimezisBlurView only became dependable in API 31; below that it can no-op.
const ANDROID_BLUR = Platform.OS === 'android' && Number(Platform.Version) >= 31;
const BLURRED = Platform.OS === 'ios' || ANDROID_BLUR;

// Fully custom tab bar. react-navigation's default button reserves its own
// bottom padding that can't be overridden cleanly, so we own the layout instead.
function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const tab_styles = useMemo(() => makeTabStyles(theme), [theme]);
    const [pillWidth, setPillWidth] = useState(0);
    const itemWidth = pillWidth ? pillWidth / state.routes.length : 0;

    const indicatorX = useSharedValue(0);
    const lastItemWidth = useRef(0);

    useEffect(() => {
        if (!itemWidth) return;
        // flexDirection: 'row' mirrors under RTL, so the travel flips with it.
        const target = state.index * itemWidth * (I18nManager.isRTL ? -1 : 1);
        const resized = lastItemWidth.current !== itemWidth;
        lastItemWidth.current = itemWidth;
        indicatorX.value = resized ? target : withSpring(target, SLIDE);
    }, [state.index, itemWidth, indicatorX]);

    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorX.value }],
    }));

    const onPillLayout = (event: LayoutChangeEvent) => {
        setPillWidth(event.nativeEvent.layout.width);
    };

    return (
        <View style={[tab_styles.wrapper, { bottom: insets.bottom + 16 }]}>
            <View style={tab_styles.pill} onLayout={onPillLayout}>
                {BLURRED && (
                    <BlurView
                        intensity={65}
                        tint="dark"
                        experimentalBlurMethod={ANDROID_BLUR ? 'dimezisBlurView' : undefined}
                        style={StyleSheet.absoluteFill}
                    />
                )}

                <LinearGradient
                    colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.02)', 'transparent']}
                    locations={[0, 0.45, 1]}
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
        </View>
    );
}

export default function TabLayout() {
    return (
        <Tabs
            tabBar={(props) => <CustomTabBar {...props} />}
            screenOptions={{ headerShown: false }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: 'Feed',
                    tabBarIcon: ({ color }) => (
                        <FontAwesomeIcon icon={faHome} size={19} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    title: 'Profile',
                    tabBarIcon: ({ color }) => (
                        <FontAwesomeIcon icon={faUser} size={17} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="saved"
                options={{
                    title: 'Saved',
                    tabBarIcon: ({ color }) => (
                        <FontAwesomeIcon icon={faBookmark} size={16} color={color} />
                    ),
                }}
            />
        </Tabs>
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
            shadowOpacity: 0.45,
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
            borderColor: Platform.select({
                ios: 'rgba(255,255,255,0.14)',
                default: 'rgba(255,255,255,0.20)',
            }),
            // Translucent only where a real blur backs it.
            backgroundColor:
                Platform.OS === 'ios'
                    ? 'transparent'
                    : ANDROID_BLUR
                      ? 'rgba(14, 14, 14, 0.45)'
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
