import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import type { IconProp } from '@fortawesome/fontawesome-svg-core';
import {
    faHouse,
    faClock,
    faBolt,
    faBan,
    faArrowsRotate,
    faCheck,
    faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
import { useTheme, useThemeMode, type Theme, type ThemeMode } from '@/components/Theme';
import { getLastQueryTime } from '@/lib/utilities';
import { relativeTime } from '@/components/NewsCard';

const SHOW_OPTIONS = [
    { key: 'Home', icon: faHouse, hint: 'The topics you picked' },
    { key: 'Recent', icon: faClock, hint: 'Newest first, every topic' },
    { key: 'Top', icon: faBolt, hint: 'Across all of tech' },
];

const APPEARANCE_OPTIONS: { key: ThemeMode; label: string }[] = [
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
    { key: 'system', label: 'System' },
];

function OptionRow({
    styles,
    theme,
    icon,
    name,
    hint,
    selected,
    onPress,
}: {
    styles: ReturnType<typeof makeStyles>;
    theme: Theme;
    icon: IconProp;
    name: string;
    hint?: string;
    selected?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable onPress={onPress} style={styles.opt_row}>
            <View style={[styles.opt_icon, selected && styles.opt_icon_on]}>
                <FontAwesomeIcon
                    icon={icon}
                    size={15}
                    color={selected ? theme.accent : theme.text_secondary}
                />
            </View>
            <View style={styles.opt_text_block}>
                <Text style={[styles.opt_name, selected && styles.opt_name_on]}>{name}</Text>
                {hint && <Text style={styles.opt_hint}>{hint}</Text>}
            </View>
            {selected && <FontAwesomeIcon icon={faCheck} size={15} color={theme.accent} />}
            {!selected && hint === undefined && (
                <FontAwesomeIcon icon={faChevronRight} size={13} color={theme.text_tertiary} />
            )}
        </Pressable>
    );
}

export function FeedOptionsSheet({
    visible,
    onClose,
    filter,
    onSelectFilter,
    onBlockedSourcesPress,
    onRefreshPress,
}: {
    visible: boolean;
    onClose: () => void;
    filter: string;
    onSelectFilter: (filter: string) => void;
    onBlockedSourcesPress: () => void;
    onRefreshPress: () => void;
}) {
    const theme = useTheme();
    const { mode, setMode } = useThemeMode();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const [refreshHint, setRefreshHint] = useState('');

    useEffect(() => {
        if (!visible) return;
        getLastQueryTime()
            .then((iso) => setRefreshHint(iso ? `Last updated ${relativeTime(iso)}` : ''))
            .catch(() => setRefreshHint(''));
    }, [visible]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            statusBarTranslucent
            onRequestClose={onClose}
        >
            <Pressable style={[styles.dim, { backgroundColor: theme.scrim }]} onPress={onClose} />
            <View style={styles.sheet}>
                <View style={styles.grab} />

                <Text style={styles.seclabel}>Show</Text>
                {SHOW_OPTIONS.map((option) => (
                    <OptionRow
                        key={option.key}
                        styles={styles}
                        theme={theme}
                        icon={option.icon}
                        name={option.key}
                        hint={option.hint}
                        selected={filter === option.key}
                        onPress={() => {
                            onSelectFilter(option.key);
                            onClose();
                        }}
                    />
                ))}

                <View style={styles.divide} />
                <Text style={styles.seclabel}>Appearance</Text>
                <View style={styles.segment}>
                    {APPEARANCE_OPTIONS.map((option) => (
                        <Pressable
                            key={option.key}
                            onPress={() => setMode(option.key)}
                            style={[styles.seg, mode === option.key && styles.seg_on]}
                        >
                            <Text
                                style={[styles.seg_text, mode === option.key && styles.seg_text_on]}
                            >
                                {option.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                <View style={styles.divide} />
                <OptionRow
                    styles={styles}
                    theme={theme}
                    icon={faBan}
                    name="Blocked sources"
                    onPress={() => {
                        onClose();
                        onBlockedSourcesPress();
                    }}
                />
                <OptionRow
                    styles={styles}
                    theme={theme}
                    icon={faArrowsRotate}
                    name="Refresh now"
                    hint={refreshHint}
                    onPress={() => {
                        onClose();
                        onRefreshPress();
                    }}
                />
            </View>
        </Modal>
    );
}

const makeStyles = (theme: Theme) =>
    StyleSheet.create({
        dim: {
            flex: 1,
        },
        sheet: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.elevated,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.border,
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: 26,
        },
        grab: {
            width: 36,
            height: 4,
            borderRadius: 2,
            alignSelf: 'center',
            marginBottom: 16,
            backgroundColor: theme.border_strong,
        },
        seclabel: {
            fontFamily: 'WorkSans-SemiBold',
            fontSize: 10,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: theme.text_tertiary,
            marginBottom: 6,
            marginLeft: 2,
        },
        opt_row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            paddingVertical: 11,
        },
        opt_icon: {
            width: 34,
            height: 34,
            borderRadius: 11,
            backgroundColor: theme.border,
            justifyContent: 'center',
            alignItems: 'center',
        },
        opt_icon_on: {
            backgroundColor: theme.accent_soft,
        },
        opt_text_block: {
            flex: 1,
        },
        opt_name: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 16,
            lineHeight: 20,
            color: theme.text,
        },
        opt_name_on: {
            fontFamily: 'WorkSans-SemiBold',
        },
        opt_hint: {
            fontFamily: 'WorkSans-Light',
            fontSize: 12,
            color: theme.text_tertiary,
            marginTop: 1,
        },
        segment: {
            flexDirection: 'row',
            gap: 4,
            padding: 4,
            borderRadius: 14,
            backgroundColor: theme.border,
            marginBottom: 4,
        },
        seg: {
            flex: 1,
            alignItems: 'center',
            paddingVertical: 9,
            borderRadius: 11,
        },
        seg_on: {
            backgroundColor: theme.surface,
            ...(theme.card_shadow ?? {}),
        },
        seg_text: {
            fontFamily: 'WorkSans-Regular',
            fontSize: 13,
            color: theme.text_secondary,
        },
        seg_text_on: {
            fontFamily: 'WorkSans-SemiBold',
            color: theme.text,
        },
        divide: {
            height: 1,
            backgroundColor: theme.border,
            marginVertical: 12,
        },
    });

export default FeedOptionsSheet;
