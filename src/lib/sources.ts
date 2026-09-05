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

/**
 * Blocks locally first, then tells the server.
 *
 * Local-first because the feed should update the instant someone taps, and
 * because blocking has to work offline and while signed out. The synced flag is
 * what lets an unsynced row get pushed later.
 */
export async function blockSource(domain: string, token?: string | null): Promise<void> {
    const db = await getDb();

    await db.runAsync(
        `INSERT INTO blocked_sources (source_domain, synced) VALUES (?, 0)
         ON CONFLICT(source_domain) DO NOTHING`,
        [domain],
    );

    // Drop what's already cached from this publisher so the feed reflects the
    // block now rather than whenever the cache next rotates. Saved articles stay:
    // blocking a publisher shouldn't delete something deliberately kept.
    await db.runAsync('DELETE FROM articles WHERE source_domain = ? AND saved = 0', [domain]);

    await pushBlock(domain, token);
}

/**
 * Removes a block, reporting whether it stuck.
 *
 * There is no tombstone for unblocks, and syncBlockedSources unions the server's
 * list back in -- so a delete that never reached the server would silently
 * reappear on the next focus. Rather than pretend, the local row is restored and
 * the caller is told it failed.
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

/**
 * Reports a publisher. Requires a signed-in token -- the server refuses
 * anonymous reports, so there is no point queueing one.
 */
export async function reportSource(
    domain: string,
    token: string,
    articleId?: string,
    reason?: 'misleading' | 'spam' | 'offensive' | 'other',
): Promise<boolean> {
    // Reporting implies not wanting to see it, and the server blocks it too.
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
        // Offline, or the API is down. The row stays unsynced and syncBlocked
        // pushes it next time.
        console.warn('[sources] block did not reach the server:', error);
        return false;
    }
}

/**
 * Reconciles the local blocklist with the server's as a union.
 *
 * Union rather than server-wins: a blocklist quietly losing entries is the bad
 * failure mode, and anything blocked while offline hasn't reached the server yet.
 */
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
 * Mirrors one principal's server blocklist onto the device, replacing whatever
 * was there.
 *
 * Used when the principal itself changes -- signing in, out, or as a different
 * account. A union would be wrong here: it would carry one account's blocks into
 * the next person to sign in on a shared device, and push them up as if they
 * were theirs. Union stays for reconciling a single principal across offline
 * edits; a change of identity replaces.
 *
 * Anything blocked offline and never pushed is lost in that swap. The window is
 * narrow and the alternative -- pushing pending rows after the token they belong
 * to is already gone -- would attribute them to the wrong principal.
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
