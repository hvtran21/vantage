export const DEV_FALLBACK_URL = 'http://localhost:8081';

/**
 * Where the API lives. A development build may use any URL, the LAN http one included. A
 * release build must use https, so a missing or mistyped setting stops the app at startup
 * instead of sending sign-in tokens and a reader's data over plain http.
 */
export function resolveBaseUrl(configured: string | undefined, isDev: boolean): string {
    const url = configured?.trim();
    if (isDev) return url || DEV_FALLBACK_URL;
    if (url && /^https:\/\/\S+$/i.test(url)) return url;
    // The value is left out: a mistyped one can carry credentials.
    throw new Error(
        'EXPO_PUBLIC_BASE_URL must be set to an https:// URL in a release build ' +
            (url ? 'but is not one.' : 'but is not set.'),
    );
}
