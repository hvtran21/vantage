import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDb } from '@/lib/database';

/**
 * What you've already read. Deliberately device-only: unlike saves, blocks and
 * interests, a reading history isn't worth what it costs in privacy to ship off
 * the phone, so none of this needs the push/rollback dance the other lib/
 * modules do.
 */

const HIDE_READ_KEY = 'hideReadArticles';

/** Stamps an article read, keeping the *first* read -- hence `read_at IS NULL`. */
export async function markArticleRead(id: string): Promise<string> {
    const readAt = new Date().toISOString();
    const db = await getDb();
    await db.runAsync('UPDATE articles SET read_at = ? WHERE id = ? AND read_at IS NULL', [
        readAt,
        id,
    ]);
    const row = await db.getFirstAsync<{ read_at: string | null }>(
        'SELECT read_at FROM articles WHERE id = ?',
        [id],
    );
    return row?.read_at ?? readAt;
}

/** The undo for a mis-tap. */
export async function markArticleUnread(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('UPDATE articles SET read_at = NULL WHERE id = ?', [id]);
}

/** id -> read_at, for reconciling a list already in memory. Absent means unread. */
export async function getReadStamps(): Promise<Map<string, string>> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ id: string; read_at: string }>(
        'SELECT id, read_at FROM articles WHERE read_at IS NOT NULL',
    );
    return new Map(rows.map((row) => [row.id, row.read_at]));
}

export async function countReadArticles(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ total: number }>(
        'SELECT COUNT(*) AS total FROM articles WHERE read_at IS NOT NULL',
    );
    return row?.total ?? 0;
}

/** Clears the history without deleting the articles. */
export async function clearReadHistory(): Promise<number> {
    const db = await getDb();
    const result = await db.runAsync(
        'UPDATE articles SET read_at = NULL WHERE read_at IS NOT NULL',
    );
    return result.changes;
}

export async function getHideRead(): Promise<boolean> {
    try {
        return (await AsyncStorage.getItem(HIDE_READ_KEY)) === 'true';
    } catch {
        return false;
    }
}

export async function setHideRead(next: boolean): Promise<void> {
    await AsyncStorage.setItem(HIDE_READ_KEY, next ? 'true' : 'false');
}
