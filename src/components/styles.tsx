import React, { useMemo } from 'react';
import { Text, TextStyle, StyleSheet, View } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useMotion } from '@/components/Motion';
import { useTheme, type Theme } from '@/components/Theme';
import { scaleMs, withMotion } from '@/lib/motion';

// Floating tab bar's 72pt pill + 16pt gap + safe area, rounded up.
export const TAB_BAR_INSET = 130;

type GradientTextProps = {
    text: string;
    colors: [string, string];
    style?: TextStyle;
    summary?: string;
};

export const GradientText: React.FC<GradientTextProps> = ({ text, colors, style }) => {
    return (
        <MaskedView
            maskElement={
                <Text style={[style, { backgroundColor: 'transparent', color: 'black' }]}>
                    {text}
                </Text>
            }
        >
            <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={[style, { opacity: 0 }]}>{text}</Text>
            </LinearGradient>
        </MaskedView>
    );
};

interface TabHeaderProps {
    title: string;
    rightAccessory?: React.ReactNode;
    subtitle?: string;
}

export const TabHeader = ({ title, rightAccessory, subtitle }: TabHeaderProps) => {
    const { scale } = useMotion();
    const theme = useTheme();
    const header_styles = useMemo(() => makeHeaderStyles(theme), [theme]);
    return (
        <Animated.View
            entering={withMotion(scale, () => FadeIn.duration(scaleMs(scale, 450)))}
            style={header_styles.container}
        >
            <View style={header_styles.title_block}>
                {subtitle && <Text style={header_styles.subtitle}>{subtitle}</Text>}
                <Text style={header_styles.title}>{title}</Text>
            </View>
            {rightAccessory}
        </Animated.View>
    );
};

export const HeaderRule = () => {
    const theme = useTheme();
    const header_styles = useMemo(() => makeHeaderStyles(theme), [theme]);
    return (
        <View style={header_styles.rule_wrapper}>
            <View style={header_styles.rule_line} />
        </View>
    );
};

const makeHeaderStyles = (theme: Theme) =>
    StyleSheet.create({
        container: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: 6,
            overflow: 'visible',
            zIndex: 10,
        },
        title_block: {
            justifyContent: 'center',
        },
        title: {
            fontFamily: 'WorkSans-Bold',
            fontSize: 30,
            letterSpacing: -0.5,
            color: theme.text,
        },
        subtitle: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 10,
            letterSpacing: 2.5,
            textTransform: 'uppercase',
            marginBottom: 4,
            color: theme.text_tertiary,
        },
        rule_wrapper: {
            paddingHorizontal: 20,
            paddingBottom: 10,
        },
        rule_line: {
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.border,
        },
    });

export default GradientText;
