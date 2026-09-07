import { getDb } from '@/lib/database';
import { BASE_URL } from '@/lib/services';
import { principalHeaders } from '@/lib/principal';

export interface BlockedSource {
    source_domain: string;
    created_at: string;
    synced: number;
}

export async function listBlocked(): Promise<BlockedSource[]> {
    const db = await getDb();
    return db.getAllAsync<BlockedSource>(
        'SELECT source_domain, created_at, synced FROM blocked_sources ORDER BY created_at DESC',
    );
}

/** Local-first, so it works offline and while signed out; `synced` queues the push. */
export async function blockSource(domain: string, token?: string | null): Promise<void> {
    const db = await getDb();

    await db.runAsync(
        `INSERT INTO blocked_sources (source_domain, synced) VALUES (?, 0)
         ON CONFLICT(source_domain) DO NOTHING`,
        [domain],
    );

    // Saved articles stay: blocking a publisher shouldn't delete something kept.
    await db.runAsync('DELETE FROM articles WHERE source_domain = ? AND saved = 0', [domain]);

    await pushBlock(domain, token);
}

/**
 * Removes a block, reporting whether it stuck. There's no tombstone, and the
 * union sync would silently reinstate a delete that never reached the server.
 */
export async function unblockSource(domain: string, token?: string | null): Promise<boolean> {
    const db = await getDb();
    const previous = await db.getFirstAsync<BlockedSource>(
        'SELECT source_domain, created_at, synced FROM blocked_sources WHERE source_domain = ?',
        [domain],
    );

    await db.runAsync('DELETE FROM blocked_sources WHERE source_domain = ?', [domain]);

    try {
        const response = await fetch(
            `${BASE_URL}/api/me/blocked-sources/${encodeURIComponent(domain)}`,
            { method: 'DELETE', headers: await principalHeaders(token) },
        );
        // 404 means the server never had it, which is the state we wanted.
        if (response.ok || response.status === 404) return true;
        throw new Error(`server returned ${response.status}`);
    } catch (error) {
        console.warn('[sources] unblock did not reach the server:', error);
        if (previous) {
            await db.runAsync(
                'INSERT OR REPLACE INTO blocked_sources (source_domain, created_at, synced) VALUES (?, ?, ?)',
                [previous.source_domain, previous.created_at, previous.synced],
            );
        }
        return false;
    }
}

/** Needs a token: the server refuses anonymous reports, so queueing is pointless. */
export async function reportSource(
    domain: string,
    token: string,
    articleId?: string,
    reason?: 'misleading' | 'spam' | 'offensive' | 'other',
): Promise<boolean> {
    await blockSource(domain, token);

    try {
        const response = await fetch(`${BASE_URL}/api/me/reports`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ domain, articleId, reason }),
        });
        return response.ok;
    } catch (error) {
        console.warn('[sources] report failed:', error);
        return false;
    }
}

async function pushBlock(domain: string, token?: string | null): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/api/me/blocked-sources`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await principalHeaders(token)) },
            body: JSON.stringify({ domain }),
        });
        if (!response.ok) return false;

        const db = await getDb();
        await db.runAsync('UPDATE blocked_sources SET synced = 1 WHERE source_domain = ?', [
            domain,
        ]);
        return true;
    } catch (error) {
        // Stays unsynced; syncBlockedSources pushes it next time.
        console.warn('[sources] block did not reach the server:', error);
        return false;
    }
}

/** Union, not server-wins: a blocklist quietly losing entries is the bad failure. */
export async function syncBlockedSources(token?: string | null): Promise<void> {
    const db = await getDb();

    try {
        const pending = await db.getAllAsync<{ source_domain: string }>(
            'SELECT source_domain FROM blocked_sources WHERE synced = 0',
        );
        for (const row of pending) {
            await pushBlock(row.source_domain, token);
        }

        const response = await fetch(`${BASE_URL}/api/me/blocked-sources`, {
            headers: await principalHeaders(token),
        });
        if (!response.ok) return;

        const { sources } = (await response.json()) as {
            sources: { source_domain: string; created_at: string }[];
        };

        for (const source of sources) {
            if (!source.source_domain) continue;
            await db.runAsync(
                `INSERT INTO blocked_sources (source_domain, created_at, synced) VALUES (?, ?, 1)
                 ON CONFLICT(source_domain) DO UPDATE SET synced = 1`,
                [source.source_domain, source.created_at],
            );
            await db.runAsync('DELETE FROM articles WHERE source_domain = ? AND saved = 0', [
                source.source_domain,
            ]);
        }
    } catch (error) {
        console.warn('[sources] sync failed:', error);
    }
}

/** Domains this account has reported, for badging the manage-sources list. */
export async function listReportedDomains(token: string): Promise<string[]> {
    try {
        const response = await fetch(`${BASE_URL}/api/me/reports`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return [];
        const { reports } = (await response.json()) as { reports: { source_domain: string }[] };
        return reports.map((report) => report.source_domain);
    } catch (error) {
        console.warn('[sources] could not load reports:', error);
        return [];
    }
}

/**
 * Mirrors one principal's server blocklist onto the device, replacing
 * whatever was there. Used when the principal itself changes (sign in, out,
 * or switch account) -- a union would leak one account's blocks into the
 * next person who signs in on a shared device, so identity changes replace
 * rather than merge. Anything blocked offline and never pushed is lost in
 * the swap; pushing it after its token is already gone would just attribute
 * it to the wrong principal.
 */
export async function replaceLocalBlocklist(token?: string | null): Promise<boolean> {
    const db = await getDb();

    try {
        const response = await fetch(`${BASE_URL}/api/me/blocked-sources`, {
            headers: await principalHeaders(token),
        });
        if (!response.ok) return false;

        const { sources } = (await response.json()) as {
            sources: { source_domain: string; created_at: string }[];
        };
        // A null domain would poison the block filter, and can't be removed from
        // the manage screen either.
        const usable = sources.filter((source) => Boolean(source.source_domain));

        // One transaction: two overlapping runs used to be able to interleave a
        // DELETE with the other's INSERT and leave the list half-mirrored.
        await db.withTransactionAsync(async () => {
            await db.runAsync('DELETE FROM blocked_sources');
            for (const source of usable) {
                await db.runAsync(
                    'INSERT OR REPLACE INTO blocked_sources (source_domain, created_at, synced) VALUES (?, ?, 1)',
                    [source.source_domain, source.created_at],
                );
            }
        });

        for (const source of usable) {
            await db.runAsync('DELETE FROM articles WHERE source_domain = ? AND saved = 0', [
                source.source_domain,
            ]);
        }
        return true;
    } catch (error) {
        // Leave the local list alone rather than blanking it on a network blip.
        console.warn('[sources] could not mirror the blocklist:', error);
        return false;
    }
}
