import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SystemUI from 'expo-system-ui';
import { ClerkProvider, ClerkLoaded } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActionSheetProvider } from '@/components/ArticleActionSheet';
import { PrincipalSync } from '@/components/PrincipalSync';
import { MotionProvider, useMotion } from '@/components/Motion';
import { theme } from '@/components/styles';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

function AppNavigator() {
    const { scale } = useMotion();
    // The native stack has no per-transition duration knob, so "off" is the
    // only scale that changes anything here -- it drops the transition
    // entirely rather than playing a fade/slide the user asked to skip.
    const screenAnimation = scale === 0 ? 'none' : 'fade';
    const articleAnimation = scale === 0 ? 'none' : 'slide_from_right';

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#000000' },
                animation: screenAnimation,
            }}
        >
            <Stack.Screen name="index" />
            <Stack.Screen name="welcome" />
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="article/[id]" options={{ animation: articleAnimation }} />
        </Stack>
    );
}

export default function RootLayout() {
    // The native stack lifts both screens during a push/pop, exposing Android's
    // window background -- white by default. contentStyle only paints screens.
    useEffect(() => {
        SystemUI.setBackgroundColorAsync(theme.bg).catch((error) => {
            console.warn('[system-ui] could not set window background:', error);
        });
    }, []);

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
                <ClerkLoaded>
                    <PrincipalSync />
                    {/* Above the Stack, so the action sheet covers the tab bar. */}
                    <SafeAreaProvider>
                        <MotionProvider>
                            <ActionSheetProvider>
                                <AppNavigator />
                            </ActionSheetProvider>
                        </MotionProvider>
                    </SafeAreaProvider>
                </ClerkLoaded>
            </ClerkProvider>
        </GestureHandlerRootView>
    );
}
