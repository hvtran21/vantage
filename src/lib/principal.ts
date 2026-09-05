import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'vantage.anon-id';

/**
 * A per-device identity so preferences work before signing in. It's a bearer
 * secret, so it stays in the keystore and travels in a header, never a URL.
 *
 * Not portable: Android clears the keystore on uninstall.
 */
// A promise, not a value -- caching after the await let two callers both miss
// and mint different ids.
let anonIdPromise: Promise<string> | null = null;

export function getAnonId(): Promise<string> {
    if (!anonIdPromise) {
        anonIdPromise = (async () => {
            const stored = await SecureStore.getItemAsync(KEY);
            if (stored) return stored;

            // 128 bits, because holding the id is the whole of the claim.
            const bytes = Crypto.getRandomBytes(16);
            const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

            await SecureStore.setItemAsync(KEY, id);
            return id;
        })().catch((error) => {
            // Don't cache a failure; the next caller should retry.
            anonIdPromise = null;
            throw error;
        });
    }
    return anonIdPromise;
}

/** A Clerk token wins when present; no reason to send both. */
export async function principalHeaders(token?: string | null): Promise<Record<string, string>> {
    if (token) return { Authorization: `Bearer ${token}` };
    return { 'X-Anon-Id': await getAnonId() };
}
