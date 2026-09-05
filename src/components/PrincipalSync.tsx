import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { getAnonId } from '@/lib/principal';
import { BASE_URL } from '@/lib/services';
import { replaceLocalBlocklist } from '@/lib/sources';

/**
 * Keeps the device's preferences pointed at whoever is currently acting.
 *
 * Renders nothing. Mounted once at the root rather than per-screen, because a
 * screen that happened to be unmounted at the moment of sign-in would miss the
 * transition entirely.
 */
export function PrincipalSync() {
    const { isSignedIn, userId, getToken } = useAuth();
    // Tracks the identity, not just signed-in-ness, so switching accounts on one
    // device is treated as the change it is.
    const activePrincipal = useRef<string | null>(null);

    useEffect(() => {
        const principal = isSignedIn && userId ? `clerk:${userId}` : 'anon';
        if (activePrincipal.current === principal) return;

        let cancelled = false;

        (async () => {
            const token = isSignedIn ? await getToken() : null;
            if (cancelled) return;

            if (token) {
                // Claims the device's anonymous principal so anything set before
                // signing in follows the account. The server does the merge.
                await linkAnonPrincipal(token);
            }
            if (cancelled) return;

            // Mirror whoever is acting now. Replace, not union -- see
            // replaceLocalBlocklist for why that matters on a shared device.
            await replaceLocalBlocklist(token);

            if (!cancelled) activePrincipal.current = principal;
        })().catch((error) => {
            // Non-fatal: the app works, it just hasn't reconciled preferences.
            // activePrincipal stays unset so the next change retries.
            console.warn('[principal] sync failed:', error);
        });

        return () => {
            cancelled = true;
        };
    }, [isSignedIn, userId, getToken]);

    return null;
}

async function linkAnonPrincipal(token: string): Promise<void> {
    try {
        const anonId = await getAnonId();
        const response = await fetch(`${BASE_URL}/api/me/link-anon`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ anonId }),
        });

        if (!response.ok) {
            console.warn(`[principal] link-anon failed with ${response.status}`);
            return;
        }

        const { linked, merged } = (await response.json()) as {
            linked: boolean;
            merged: number;
        };
        console.log(`[principal] linked=${linked} merged=${merged} block(s)`);
    } catch (error) {
        console.warn('[principal] link-anon failed:', error);
    }
}

export default PrincipalSync;
