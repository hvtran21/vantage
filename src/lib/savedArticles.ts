import { getDb } from '@/lib/database';
import { BASE_URL, cacheArticles } from '@/lib/services';
import { principalHeaders } from '@/lib/principal';
import Article from '@/lib/constants';

/** Local-first, so saving works offline and while signed out; `save_synced` queues the push. */
export async function saveArticle(articleId: string, token?: string | null): Promise<void> {
    const db = await getDb();
    await db.runAsync('UPDATE articles SET saved = 1, save_synced = 0 WHERE id = ?', [articleId]);
    await pushSave(articleId, token);
}

/**
 * Unsaves, reporting whether it stuck. There's no tombstone, and the union
 * sync would silently reinstate a delete that never reached the server --
 * mirrors unblockSource for the same reason.
 */
export async function unsaveArticle(articleId: string, token?: string | null): Promise<boolean> {
    const db = await getDb();
    await db.runAsync('UPDATE articles SET saved = 0 WHERE id = ?', [articleId]);

    try {
        const response = await fetch(
            `${BASE_URL}/api/me/saved-articles/${encodeURIComponent(articleId)}`,
            { method: 'DELETE', headers: await principalHeaders(token) },
        );
        // 404 means the server never had it, which is the state we wanted.
        if (response.ok || response.status === 404) return true;
        throw new Error(`server returned ${response.status}`);
    } catch (error) {
        console.warn('[saved] unsave did not reach the server:', error);
        await db.runAsync('UPDATE articles SET saved = 1 WHERE id = ?', [articleId]);
        return false;
    }
}

async function pushSave(articleId: string, token?: string | null): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/api/me/saved-articles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await principalHeaders(token)) },
            body: JSON.stringify({ articleId }),
        });
        if (!response.ok) return false;

        const db = await getDb();
        await db.runAsync('UPDATE articles SET save_synced = 1 WHERE id = ?', [articleId]);
        return true;
    } catch (error) {
        // Stays unsynced; syncSavedArticles pushes it next time.
        console.warn('[saved] save did not reach the server:', error);
        return false;
    }
}

/** Union, not server-wins: losing a save silently is the bad failure -- mirrors syncBlockedSources. */
export async function syncSavedArticles(token?: string | null): Promise<void> {
    const db = await getDb();

    try {
        const pending = await db.getAllAsync<{ id: string }>(
            'SELECT id FROM articles WHERE saved = 1 AND save_synced = 0',
        );
        for (const row of pending) {
            await pushSave(row.id, token);
        }

        const response = await fetch(`${BASE_URL}/api/me/saved-articles`, {
            headers: await principalHeaders(token),
        });
        if (!response.ok) return;

        const { articles } = (await response.json()) as { articles: Article[] };
        await cacheArticles(articles);
        for (const article of articles) {
            await db.runAsync('UPDATE articles SET saved = 1, save_synced = 1 WHERE id = ?', [
                article.id,
            ]);
        }
    } catch (error) {
        console.warn('[saved] sync failed:', error);
    }
}

/**
 * Mirrors one principal's server saves onto the device, replacing whatever was
 * saved locally. Used when the principal itself changes -- see
 * replaceLocalBlocklist for why a change of identity replaces rather than
 * unions.
 */
export async function replaceLocalSavedArticles(token?: string | null): Promise<boolean> {
    const db = await getDb();

    try {
        const response = await fetch(`${BASE_URL}/api/me/saved-articles`, {
            headers: await principalHeaders(token),
        });
        if (!response.ok) return false;

        const { articles } = (await response.json()) as { articles: Article[] };

        await db.withTransactionAsync(async () => {
            await db.runAsync('UPDATE articles SET saved = 0, save_synced = 1');
            await cacheArticles(articles);
            for (const article of articles) {
                await db.runAsync('UPDATE articles SET saved = 1, save_synced = 1 WHERE id = ?', [
                    article.id,
                ]);
            }
        });
        return true;
    } catch (error) {
        // Leave the local saved state alone rather than blanking it on a network blip.
        console.warn('[saved] could not mirror saved articles:', error);
        return false;
    }
}
