import Article from '@/lib/constants';
import { getDb } from '@/lib/database';
import { updateArticleQueryTime } from '@/lib/utilities';
import { principalHeaders } from '@/lib/principal';
import { extractDomain } from '@/lib/domain';

export const BASE_URL = process.env.EXPO_PUBLIC_BASE_URL || 'http://localhost:8081';

// Excluded in the query rather than filtered afterwards, so a LIMIT still
// returns a full page.
//
// NOT EXISTS rather than NOT IN: a single NULL inside a NOT IN subquery makes
// the whole predicate NULL for every row, which would silently empty the feed.
// This form also keeps articles whose own source_domain is null -- they predate
// the column -- because the inner comparison simply never matches.
const notBlocked = (row: string) =>
    `NOT EXISTS (SELECT 1 FROM blocked_sources b WHERE b.source_domain = ${row}.source_domain)`;
const NOT_BLOCKED = notBlocked('articles');

/**
 * Position in the local feed, by value rather than by row count.
 *
 * OFFSET counts rows, so anything that removes one -- blocking a publisher
 * purges its cached articles -- silently shifts every later page and the reader
 * skips whatever moved across the boundary. A keyset cursor names the last row
 * seen, so it stays correct even when that row itself is deleted.
 */
export type LocalCursor = { publishedAt: string; id: string };

// Total order, matching the API's. COALESCE keeps undated rows sortable and
// reachable: a bare `published_at < ?` is NULL for them, so they'd be dropped
// from every page after the first.
const ORDER_KEY = "COALESCE(published_at, '')";
const ORDER_BY = `ORDER BY ${ORDER_KEY} DESC, id DESC`;
const AFTER_CURSOR = `(${ORDER_KEY} < ? OR (${ORDER_KEY} = ? AND id < ?))`;

// In the WHERE clause for the same reason NOT_BLOCKED is: filtering after the
// LIMIT would return short pages. Reading one outlet's copy reads the story, so
// another copy doesn't resurface in its place.
const UNREAD_ONLY = `read_at IS NULL AND (cluster_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM articles seen
    WHERE seen.cluster_id = articles.cluster_id AND seen.read_at IS NOT NULL))`;

// One card per story: a row shows only while nothing newer from its story
// passes the same filter, written against `newer`.
const newestInStory = (filter: string) => `(cluster_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM articles newer
    WHERE newer.cluster_id = articles.cluster_id AND ${filter}
      AND (COALESCE(newer.published_at, '') > COALESCE(articles.published_at, '')
           OR (COALESCE(newer.published_at, '') = COALESCE(articles.published_at, '')
               AND newer.id > articles.id))))`;

export type FeedFilters = { hideRead?: boolean };

const readClause = (filters?: FeedFilters) => (filters?.hideRead ? `AND ${UNREAD_ONLY}` : '');

const cursorClause = (cursor?: LocalCursor) => (cursor ? `AND ${AFTER_CURSOR}` : '');
const cursorParams = (cursor?: LocalCursor) =>
    cursor ? [cursor.publishedAt, cursor.publishedAt, cursor.id] : [];

/** The cursor that continues after a page, or undefined if the page was empty. */
export function cursorAfter(articles: Article[]): LocalCursor | undefined {
    const last = articles[articles.length - 1];
    return last ? { publishedAt: last.published_at ?? '', id: last.id } : undefined;
}

export async function syncArticles(
    genre?: string,
    category?: string,
    cursor?: string,
    token?: string,
) {
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

/**
 * One ordered query rather than one per genre.
 *
 * The old shape ran a LIMIT per genre and shuffled the union, so a single
 * "page" could return limit x genres rows in random order while the caller
 * advanced by one page -- rows were both duplicated and skipped. Ordering by
 * recency across all selected genres interleaves them anyway, which is what the
 * shuffle was there to do.
 */
export default async function getArticles(
    genres?: string,
    category?: string,
    limit: number = 20,
    cursor?: LocalCursor,
    filters?: FeedFilters,
): Promise<Article[] | undefined> {
    const db = await getDb();

    if (genres !== undefined && category === undefined) {
        const genreList = genres
            .split(',')
            .map((genre) => genre.trim())
            .filter(Boolean);
        if (genreList.length === 0) return [];

        const placeholders = genreList.map(() => '?').join(', ');
        return db.getAllAsync<Article>(
            `SELECT * FROM articles
             WHERE genre IN (${placeholders}) AND ${NOT_BLOCKED} ${readClause(filters)}
             AND ${newestInStory(`newer.genre IN (${placeholders}) AND ${notBlocked('newer')}`)}
             ${cursorClause(cursor)}
             ${ORDER_BY} LIMIT ?`,
            [...genreList, ...genreList, ...cursorParams(cursor), limit],
        );
    }

    if (category !== undefined && genres === undefined) {
        return db.getAllAsync<Article>(
            `SELECT * FROM articles
             WHERE category = ? AND ${NOT_BLOCKED} ${readClause(filters)}
             AND ${newestInStory(`newer.category = ? AND ${notBlocked('newer')}`)}
             ${cursorClause(cursor)}
             ${ORDER_BY} LIMIT ?`,
            [category, category, ...cursorParams(cursor), limit],
        );
    }
}

/**
 * Cached rows for these ids in the order given, less blocked publishers and,
 * with Hide read, read stories. For lists the server orders, like Top.
 */
export async function getCachedArticles(ids: string[], filters?: FeedFilters): Promise<Article[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows = await db.getAllAsync<Article>(
        `SELECT * FROM articles
         WHERE id IN (${ids.map(() => '?').join(', ')}) AND ${NOT_BLOCKED} ${readClause(filters)}`,
        ids,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => byId.get(id) ?? []);
}

type CachedArticleState = { saved: number; read_at: string | null; cluster_id: string | null };

/**
 * saved + read_at (and the story, for story-level Hide read) for every row still
 * cached. A list held in memory can outlive the rows behind it, so absence from
 * this map means gone, not merely unread.
 */
export async function getCachedArticleStates(): Promise<Map<string, CachedArticleState>> {
    const db = await getDb();
    const rows = await db.getAllAsync<CachedArticleState & { id: string }>(
        'SELECT id, saved, read_at, cluster_id FROM articles',
    );
    return new Map(
        rows.map((row) => [
            row.id,
            { saved: row.saved, read_at: row.read_at, cluster_id: row.cluster_id },
        ]),
    );
}

export async function getSavedArticles(): Promise<Article[]> {
    const db = await getDb();
    const results = await db.getAllAsync('SELECT * FROM articles WHERE saved = 1');
    return (results as Article[]) ?? [];
}

export async function getAllArticles(
    limit: number = 100,
    cursor?: LocalCursor,
    filters?: FeedFilters,
): Promise<Article[]> {
    const db = await getDb();
    const results = await db.getAllAsync(
        `SELECT * FROM articles
         WHERE ${NOT_BLOCKED} ${readClause(filters)} AND ${newestInStory(notBlocked('newer'))}
         ${cursorClause(cursor)}
         ${ORDER_BY} LIMIT ?`,
        [...cursorParams(cursor), limit],
    );
    return (results as Article[]) ?? [];
}

// Matches the API's own `limit` default/cap for /api/articles/search, and
// doubles as the "thin" threshold below: fewer local rows than a full page
// means the ~200-row cache likely doesn't hold every match.
const SEARCH_LIMIT = 50;

async function queryLocalArticles(query: string): Promise<Article[]> {
    const db = await getDb();
    const searchTerm = `%${query}%`;
    const results = await db.getAllAsync(
        // The OR needs its own parentheses, or the block filter would only apply
        // to the description half.
        `SELECT * FROM articles WHERE (title LIKE ? OR description LIKE ?) AND ${NOT_BLOCKED}
         ${ORDER_BY} LIMIT ?`,
        [searchTerm, searchTerm, SEARCH_LIMIT],
    );
    return (results as Article[]) ?? [];
}

export async function searchArticles(query: string, token?: string): Promise<Article[]> {
    const local = await queryLocalArticles(query);
    if (local.length >= SEARCH_LIMIT) return local;

    // The client only ever caches a few hundred articles, so a thin local hit
    // doesn't mean the term has no matches -- it means they're likely outside
    // the cache. /api/articles/search runs the same match against the full
    // server-side table.
    const outcome = await searchArticlesRemote(query, token);
    return outcome ? queryLocalArticles(query) : local;
}

async function searchArticlesRemote(query: string, token?: string) {
    try {
        const params = new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT) });
        const url = `${BASE_URL}/api/articles/search?${params}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                ...(await principalHeaders(token)),
            },
        });

        if (!response.ok) {
            console.error(`[api] Search request failed with status ${response.status}`);
            return;
        }

        const data = await response.json();
        const insertedCount = await cacheArticles(data.articles as Article[]);
        return { insertedCount };
    } catch (error) {
        console.error('[api] searchArticlesRemote failed:', error);
    }
}

const serializePublishers = (value: Article['story_sources']) =>
    value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);

export async function cacheArticles(articles: Article[]): Promise<number> {
    const db = await getDb();
    const statement = await db.prepareAsync(
        'INSERT OR IGNORE INTO articles(id, genre, category, source, author, title, description, url, url_to_image, published_at, content, saved, source_domain, cluster_id, source_count, story_sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    // A cached row keeps its saved/read state, but its story keeps growing as
    // outlets pick it up, so only the story columns follow the server. Saved
    // snapshots come back without them and leave the cached values alone.
    const refreshStory = await db.prepareAsync(
        'UPDATE articles SET cluster_id = ?, source_count = ?, story_sources = ? WHERE id = ? AND (cluster_id IS NOT ? OR source_count IS NOT ? OR story_sources IS NOT ?)',
    );

    let insertedCount = 0;
    try {
        for (const article of articles) {
            const clusterId = article.cluster_id ?? null;
            const sourceCount = article.source_count ?? null;
            const storySources = serializePublishers(article.story_sources);
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
                clusterId,
                sourceCount,
                storySources,
            ]);
            if (result.changes > 0) insertedCount++;
            else if (article.cluster_id !== undefined) {
                await refreshStory.executeAsync([
                    clusterId,
                    sourceCount,
                    storySources,
                    article.id,
                    clusterId,
                    sourceCount,
                    storySources,
                ]);
            }
        }
    } finally {
        await statement.finalizeAsync();
        await refreshStory.finalizeAsync();
    }
    return insertedCount;
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
        const nextCursor = (data.nextCursor as string | null | undefined) ?? null;
        const insertedCount = await cacheArticles(data.articles as Article[]);

        return { insertedCount, nextCursor };
    } catch (error) {
        console.error('[api] fetchAndCacheArticles failed:', error);
    }
}
