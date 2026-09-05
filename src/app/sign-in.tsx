import { useEffect, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Keyboard,
    StyleSheet,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSignIn, useSignUp } from '@clerk/expo';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '@/components/styles';

type Mode = 'sign-in' | 'sign-up';

export default function SignInPage() {
    const [mode, setMode] = useState<Mode>('sign-in');
    const [emailAddress, setEmailAddress] = useState('');
    const [code, setCode] = useState('');
    const [pendingVerification, setPendingVerification] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const { signIn } = useSignIn();
    const { signUp } = useSignUp();

    useEffect(() => {
        if (signIn.status === 'complete') {
            signIn.finalize().then(() => router.replace('/(tabs)'));
        }
    }, [signIn, signIn.status]);

    useEffect(() => {
        if (signUp.status === 'complete') {
            signUp.finalize().then(() => router.replace('/(tabs)'));
        }
    }, [signUp, signUp.status]);

    const switchMode = (next: Mode) => {
        setMode(next);
        setErrorMessage(null);
        setCode('');
        setPendingVerification(false);
    };

    // Both sign-in and sign-up are just "email → code" now, no passwords.
    const handleSendCode = async () => {
        setErrorMessage(null);
        setSubmitting(true);

        if (mode === 'sign-in') {
            const { error } = await signIn.emailCode.sendCode({ emailAddress });
            setSubmitting(false);
            if (error) {
                setErrorMessage(error.message ?? 'Could not send code');
                return;
            }
        } else {
            const { error } = await signUp.create({ emailAddress });
            if (error) {
                setSubmitting(false);
                setErrorMessage(error.message ?? 'Sign-up failed');
                return;
            }
            const { error: sendError } = await signUp.verifications.sendEmailCode();
            setSubmitting(false);
            if (sendError) {
                setErrorMessage(sendError.message ?? 'Could not send verification code');
                return;
            }
        }
        setPendingVerification(true);
    };

    const handleVerifyCode = async () => {
        setErrorMessage(null);
        setSubmitting(true);
        const { error } =
            mode === 'sign-in'
                ? await signIn.emailCode.verifyCode({ code })
                : await signUp.verifications.verifyEmailCode({ code });
        setSubmitting(false);
        if (error) setErrorMessage(error.message ?? 'Invalid code');
    };

    const handleSkip = async () => {
        await AsyncStorage.setItem('skippedAuth', 'true');
        router.replace('/(tabs)');
    };

    return (
        <SafeAreaProvider>
            <SafeAreaView style={styles.theme} edges={['top', 'left', 'right', 'bottom']}>
                <KeyboardAvoidingView
                    style={styles.flex}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                        <View style={styles.container}>
                            <Text style={styles.wordmark}>VANTAGE</Text>
                            <Text style={styles.title}>
                                {pendingVerification
                                    ? 'Check your email'
                                    : mode === 'sign-in'
                                      ? 'Welcome back'
                                      : 'Create your account'}
                            </Text>

                            {pendingVerification ? (
                                <>
                                    <Text style={styles.subtitle}>
                                        Enter the code we sent to {emailAddress}
                                    </Text>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Verification code"
                                        placeholderTextColor={theme.text_tertiary}
                                        value={code}
                                        onChangeText={setCode}
                                        keyboardType="number-pad"
                                        autoFocus
                                    />
                                </>
                            ) : (
                                <TextInput
                                    style={styles.input}
                                    placeholder="Email"
                                    placeholderTextColor={theme.text_tertiary}
                                    value={emailAddress}
                                    onChangeText={setEmailAddress}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                    autoComplete="email"
                                />
                            )}

                            {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

                            <TouchableOpacity
                                onPress={pendingVerification ? handleVerifyCode : handleSendCode}
                                activeOpacity={0.8}
                                disabled={submitting}
                                style={styles.submit_button}
                            >
                                <LinearGradient
                                    colors={['#06B6D4', '#0891B2']}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={styles.submit_gradient}
                                >
                                    {submitting ? (
                                        <ActivityIndicator color="white" />
                                    ) : (
                                        <Text style={styles.submit_text}>
                                            {pendingVerification ? 'Verify' : 'Continue'}
                                        </Text>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>

                            {!pendingVerification && (
                                <TouchableOpacity
                                    onPress={() =>
                                        switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
                                    }
                                    style={styles.toggle}
                                >
                                    <Text style={styles.toggle_text}>
                                        {mode === 'sign-in'
                                            ? "Don't have an account? Sign up"
                                            : 'Already have an account? Sign in'}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            <TouchableOpacity onPress={handleSkip} style={styles.skip}>
                                <Text style={styles.skip_text}>Skip for now</Text>
                            </TouchableOpacity>
                        </View>
                    </TouchableWithoutFeedback>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    theme: {
        flex: 1,
        backgroundColor: theme.bg,
    },
    flex: {
        flex: 1,
    },
    container: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 28,
    },
    wordmark: {
        fontFamily: 'WorkSans-SemiBold',
        fontSize: 13,
        color: theme.accent,
        letterSpacing: 3,
        marginBottom: 16,
    },
    title: {
        fontFamily: 'WorkSans-Bold',
        color: 'white',
        fontSize: 32,
        letterSpacing: -0.5,
        marginBottom: 24,
    },
    subtitle: {
        fontFamily: 'WorkSans-Light',
        fontSize: 15,
        color: theme.text_secondary,
        marginBottom: 20,
    },
    input: {
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 12,
        paddingHorizontal: 18,
        paddingVertical: 16,
        fontFamily: 'WorkSans-Regular',
        fontSize: 15,
        color: theme.text,
        marginBottom: 12,
    },
    error: {
        fontFamily: 'WorkSans-Regular',
        fontSize: 13,
        color: theme.danger,
        marginBottom: 12,
    },
    submit_button: {
        borderRadius: 16,
        overflow: 'hidden',
        marginTop: 8,
    },
    submit_gradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        gap: 10,
    },
    submit_text: {
        fontFamily: 'WorkSans-SemiBold',
        fontSize: 17,
        color: 'white',
    },
    toggle: {
        marginTop: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 13,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.accent_border,
        backgroundColor: theme.accent_soft,
    },
    toggle_text: {
        fontFamily: 'WorkSans-SemiBold',
        fontSize: 15,
        color: theme.accent,
    },
    skip: {
        marginTop: 14,
        alignItems: 'center',
    },
    skip_text: {
        fontFamily: 'WorkSans-Regular',
        fontSize: 13,
        color: theme.text_tertiary,
    },
});
