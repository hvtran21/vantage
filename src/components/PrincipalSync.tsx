import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { getAnonId } from '@/lib/principal';
import { BASE_URL } from '@/lib/services';
import { replaceLocalBlocklist } from '@/lib/sources';
import { replaceLocalSavedArticles } from '@/lib/savedArticles';
import { replaceLocalInterests } from '@/lib/interests';

/**
 * Points the device's preferences at whoever is currently acting. Renders
 * nothing, and lives at the root because a screen unmounted at the moment of
 * sign-in would miss the transition.
 */
export function PrincipalSync() {
    const { isSignedIn, userId, getToken } = useAuth();
    // The identity, not just signed-in-ness, so account switches count.
    const activePrincipal = useRef<string | null>(null);
    // getToken isn't referentially stable, so depending on it re-ran this mid-flight.
    const getTokenRef = useRef(getToken);
    getTokenRef.current = getToken;

    useEffect(() => {
        const principal = isSignedIn && userId ? `clerk:${userId}` : 'anon';
        if (activePrincipal.current === principal) return;

        let cancelled = false;

        (async () => {
            const token = isSignedIn ? await getTokenRef.current() : null;
            if (cancelled) return;

            if (token) {
                await linkAnonPrincipal(token);
            }
            if (cancelled) return;

            // Replace, not union -- see replaceLocalBlocklist. Sequential, not
            // Promise.all: the first two open a SQLite transaction on the single
            // shared connection, and expo-sqlite has no support for two open at
            // once. Interests don't touch SQLite, but join the same chain anyway.
            const blocklistMirrored = await replaceLocalBlocklist(token);
            if (cancelled) return;
            const savedMirrored = await replaceLocalSavedArticles(token);
            if (cancelled) return;
            const interestsMirrored = await replaceLocalInterests(token);

            // Only claim it once every mirror landed, or a swallowed failure
            // would leave one of them stale for the session.
            if (!cancelled && blocklistMirrored && savedMirrored && interestsMirrored) {
                activePrincipal.current = principal;
            }
        })().catch((error) => {
            // Non-fatal; activePrincipal stays unset so the next change retries.
            console.warn('[principal] sync failed:', error);
        });

        return () => {
            cancelled = true;
        };
    }, [isSignedIn, userId]);

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

        const { linked, merged, mergedSaves, mergedInterests } = (await response.json()) as {
            linked: boolean;
            merged: number;
            mergedSaves: number;
            mergedInterests: number;
        };
        console.log(
            `[principal] linked=${linked} merged=${merged} block(s), ${mergedSaves} save(s), ${mergedInterests} interest(s)`,
        );
    } catch (error) {
        console.warn('[principal] link-anon failed:', error);
    }
}

export default PrincipalSync;
