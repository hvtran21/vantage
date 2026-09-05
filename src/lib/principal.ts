import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'vantage.anon-id';

/**
 * A per-device identity so preferences work before signing in.
 *
 * This is a bearer secret: whoever holds it can read and write that device's
 * preferences, so it lives in the keystore, travels only in a header, and never
 * goes in a URL. The server stores only its digest.
 *
 * It is not portable. Android clears the keystore on uninstall, so a reinstall
 * is a new identity -- signing in is what actually makes preferences durable.
 */
let cached: string | null = null;

export async function getAnonId(): Promise<string> {
    if (cached) return cached;

    const stored = await SecureStore.getItemAsync(KEY);
    if (stored) {
        cached = stored;
        return stored;
    }

    // 16 bytes: enough that guessing another device's id is infeasible, which is
    // the only thing standing between an id and the preferences behind it.
    const bytes = Crypto.getRandomBytes(16);
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    await SecureStore.setItemAsync(KEY, id);
    cached = id;
    return id;
}

/**
 * Headers for an API call. A Clerk token wins when present -- the server ignores
 * the anon header for a verified session, but there's no reason to send both.
 */
export async function principalHeaders(token?: string | null): Promise<Record<string, string>> {
    if (token) return { Authorization: `Bearer ${token}` };
    return { 'X-Anon-Id': await getAnonId() };
}
