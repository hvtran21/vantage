import * as WebBrowser from 'expo-web-browser';
import type { Theme } from '@/components/Theme';

/** Opens a URL in the in-app browser, matching the app's chrome. */
export async function openArticleBrowser(url: string, theme: Theme): Promise<void> {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) return;
    try {
        await WebBrowser.openBrowserAsync(trimmed, {
            toolbarColor: theme.elevated,
            controlsColor: theme.accent,
            dismissButtonStyle: 'close',
        });
    } catch (error) {
        console.warn('[browser] could not open url:', error);
    }
}
