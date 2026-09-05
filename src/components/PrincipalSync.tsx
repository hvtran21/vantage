import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { getAnonId } from '@/lib/principal';
import { BASE_URL } from '@/lib/services';

/**
 * Claims this device's anonymous principal for the account as soon as someone
 * signs in, so anything they set while signed out follows them.
 *
 * Renders nothing. Mounted once at the root rather than per-screen, because a
 * screen that happens to be unmounted at sign-in would miss the transition.
 */
export function PrincipalSync() {
    const { isSignedIn, getToken } = useAuth();
    const linkedFor = useRef<string | null>(null);

    useEffect(() => {
        if (!isSignedIn) {
            // Signing out means the next sign-in should link again -- it may be a
            // different account on the same device.
            linkedFor.current = null;
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const token = await getToken();
                if (!token || cancelled || linkedFor.current === token) return;

                const anonId = await getAnonId();
                const response = await fetch(`${BASE_URL}/api/me/link-anon`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ anonId }),
                });

                if (!response.ok) {
                    console.warn(`[principal] link-anon failed with ${response.status}`);
                    return;
                }
                if (!cancelled) linkedFor.current = token;
            } catch (error) {
                // Non-fatal: the account still works, it just hasn't absorbed the
                // anonymous preferences yet. The next sign-in retries.
                console.warn('[principal] link-anon failed:', error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isSignedIn, getToken]);

    return null;
}

export default PrincipalSync;
