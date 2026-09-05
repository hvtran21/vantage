import Article from '@/lib/constants';
import { getDb } from '@/lib/database';
import { updateArticleQueryTime } from '@/lib/utilities';
import { principalHeaders } from '@/lib/principal';
import { extractDomain } from '@/lib/domain';

export const BASE_URL = process.env.EXPO_PUBLIC_BASE_URL || 'http://localhost:8081';

// Blocked publishers are excluded in the query rather than filtered afterwards,
// so a LIMIT still returns a full page. A plain NOT IN would drop rows with a
// null source_domain -- those predate the column and should stay visible.
const NOT_BLOCKED =
    '(source_domain IS NULL OR source_domain NOT IN (SELECT source_domain FROM blocked_sources))';

export async function syncArticles(genre?: string, category?: string, cursor?: string, token?: string) {
    try {
        let results = null;
        let nextCursor: string | null = null;
        if (genre) {
            const outcome = await fetchAndCacheArticles(genre, undefined, 100, cursor, token);
            if (!outcome) {
                console.error(`[sync] No articles returned from API for genre "${genre}"`);
                return;
            }
            nextCursor = outcome.nextCursor;
            results = await getArticles(genre, undefined);
        } else if (category) {
            const outcome = await fetchAndCacheArticles(undefined, category, 100, cursor, token);
            if (!outcome) {
                console.error(`[sync] No articles returned from API for category "${category}"`);
                return;
            }
            nextCursor = outcome.nextCursor;
            results = await getArticles(undefined, category);
        }
        updateArticleQueryTime();
        return { articles: results as Article[] | undefined, nextCursor };
    } catch (error) {
        console.error('[sync] syncArticles failed:', error);
    }
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export default async function getArticles(
    genres?: string,
    category?: string,
    limit: number = 20,
    offset: number = 0,
): Promise<Article[] | undefined> {
    const db = await getDb();

    if (genres !== undefined && category === undefined) {
        const genreList = genres.split(',');
        const results = await Promise.all(
            genreList.map(async (genre) => {
                return await db.getAllAsync(
                    `SELECT * FROM articles WHERE genre = ? AND ${NOT_BLOCKED} LIMIT ? OFFSET ?`,
                    [genre, limit, offset],
                );
            }),
        );
        if (results) {
            return shuffle(results.flat() as Article[]);
        }
    } else if (category !== undefined && genres === undefined) {
        const results = await db.getAllAsync(
            `SELECT * FROM articles WHERE category = ? AND ${NOT_BLOCKED} LIMIT ? OFFSET ?`,
            [category, limit, offset],
        );
        if (results) {
            return shuffle(results.flat() as Article[]);
        }
    }
}

export async function getSavedArticles(): Promise<Article[]> {
    const db = await getDb();
    const results = await db.getAllAsync('SELECT * FROM articles WHERE saved = 1');
    return (results as Article[]) ?? [];
}

export async function getAllArticles(limit: number = 100, offset: number = 0): Promise<Article[]> {
    const db = await getDb();
    const results = await db.getAllAsync(
        `SELECT * FROM articles WHERE ${NOT_BLOCKED} ORDER BY published_at DESC LIMIT ? OFFSET ?`,
        [limit, offset],
    );
    return (results as Article[]) ?? [];
}

export async function searchArticles(query: string): Promise<Article[]> {
    const db = await getDb();
    const searchTerm = `%${query}%`;
    const results = await db.getAllAsync(
        // The OR needs its own parentheses, or the block filter would only apply
        // to the description half.
        `SELECT * FROM articles WHERE (title LIKE ? OR description LIKE ?) AND ${NOT_BLOCKED} LIMIT 50`,
        [searchTerm, searchTerm],
    );
    return (results as Article[]) ?? [];
}

export async function fetchAndCacheArticles(
    genre?: string,
    category?: string,
    limit: number = 100,
    cursor?: string,
    token?: string,
) {
    try {
        const params = new URLSearchParams();
        if (genre) params.set('genre', genre);
        if (category) params.set('category', category);
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        const url = `${BASE_URL}/api/articles?${params}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                // Signed in or not, the request carries a principal so the server
                // can scope results to it.
                ...(await principalHeaders(token)),
            },
        });

        if (response.status === 500) {
            console.error('[api] Server returned 500. Is the backend running?');
            return;
        }

        if (!response.ok) {
            console.error(`[api] Request failed with status ${response.status}`);
            return;
        }

        const data = await response.json();
        const articles = data.articles as Article[];
        const nextCursor = (data.nextCursor as string | null | undefined) ?? null;

        const db = await getDb();
        const statement = await db.prepareAsync(
            'INSERT OR IGNORE INTO articles(id, genre, category, source, author, title, description, url, url_to_image, published_at, content, saved, source_domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );

        let insertedCount = 0;
        try {
            for (const article of articles) {
                const result = await statement.executeAsync([
                    article.id,
                    article.genre ?? null,
                    article.category ?? null,
                    article.source ?? null,
                    article.author ?? null,
                    article.title ?? null,
                    article.description ?? null,
                    article.url?.toString() ?? null,
                    article.url_to_image?.toString() ?? null,
                    article.published_at ?? null,
                    article.content ?? null,
                    0,
                    // The API sends this; fall back for anything older.
                    article.source_domain ?? extractDomain(article.url) ?? null,
                ]);
                if (result.changes > 0) insertedCount++;
            }
        } finally {
            await statement.finalizeAsync();
        }

        return { insertedCount, nextCursor };
    } catch (error) {
        console.error('[api] fetchAndCacheArticles failed:', error);
    }
}
