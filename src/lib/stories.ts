import type Article from '@/lib/constants';
import type { StoryPublisher } from '@/lib/constants';
import { BASE_URL, cacheArticles } from '@/lib/services';
import { getDb } from '@/lib/database';
import { principalHeaders } from '@/lib/principal';

export type StorySource = {
    id: string;
    source: string | null;
    source_domain: string | null;
    title: string;
    url: string;
    url_to_image: string | null;
    published_at: string;
};

export type Story = {
    cluster_id: string;
    source_count: number;
    article_count: number;
    first_published_at: string;
    last_published_at: string;
    /** The first report with a photo, in the same shape as a feed article. */
    article: Article;
    /** Every article in the story the caller hasn't blocked, oldest first. */
    sources: StorySource[];
};

export type ArticleStory = {
    cluster_id: string | null;
    source_count: number;
    article_count: number;
    /** Whole feed rows, oldest first; each is cached as the story loads. */
    sources: Article[];
};

/**
 * Stories ranked by how many publishers covered them. Each lead article is
 * cached, so opening one works like any other card.
 */
export async function fetchStories(options: {
    category?: string;
    hours?: number;
    limit?: number;
    cursor?: string;
    token?: string;
}): Promise<{ stories: Story[]; nextCursor: string | null } | undefined> {
    try {
        const params = new URLSearchParams();
        if (options.category) params.set('category', options.category);
        if (options.hours) params.set('hours', String(options.hours));
        if (options.limit) params.set('limit', String(options.limit));
        if (options.cursor) params.set('cursor', options.cursor);

        const response = await fetch(`${BASE_URL}/api/stories?${params}`, {
            headers: { Accept: 'application/json', ...(await principalHeaders(options.token)) },
        });
        if (!response.ok) {
            console.error(`[api] Stories request failed with status ${response.status}`);
            return;
        }
        const data = (await response.json()) as { stories: Story[]; nextCursor: string | null };
        await cacheArticles(data.stories.map((story) => story.article));
        return data;
    } catch (error) {
        console.error('[api] fetchStories failed:', error);
    }
}

/**
 * Who else covered an article, fetched when the sources sheet opens. Looked up
 * by the article so nothing depends on a cached cluster id staying valid.
 */
export async function fetchArticleStory(
    articleId: string,
    token?: string,
): Promise<ArticleStory | undefined> {
    try {
        const response = await fetch(
            `${BASE_URL}/api/articles/${encodeURIComponent(articleId)}/story`,
            { headers: { Accept: 'application/json', ...(await principalHeaders(token)) } },
        );
        if (!response.ok) {
            console.error(`[api] Story request failed with status ${response.status}`);
            return;
        }
        const story = (await response.json()) as ArticleStory;
        await cacheArticles(story.sources);
        return story;
    } catch (error) {
        console.error('[api] fetchArticleStory failed:', error);
    }
}

function parsePublishers(value: Article['story_sources']): StoryPublisher[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as StoryPublisher[]) : [];
    } catch {
        return [];
    }
}

/** Everyone covering an article's story, with the article's own publisher first. */
export function storyPublishers(
    article: Pick<Article, 'source' | 'source_domain' | 'story_sources'>,
): StoryPublisher[] {
    const publishers = parsePublishers(article.story_sources);
    const own = publishers.findIndex(
        (p) =>
            (article.source_domain && p.source_domain === article.source_domain) ||
            p.source === article.source,
    );
    if (own <= 0) return publishers;
    return [publishers[own], ...publishers.slice(0, own), ...publishers.slice(own + 1)];
}

/** "V" for The Verge, "9" for 9to5Mac. */
export function initialOf(name: string): string {
    const masthead = name.replace(/^the\s+/i, '').trim();
    return masthead.charAt(0).toUpperCase() || '?';
}

/** "The Verge, MacRumors +1": two names, then how many more. */
export function stackLabel(names: string[]): string {
    const rest = names.length - 2;
    return rest > 0 ? `${names[0]}, ${names[1]} +${rest}` : `${names[0]}, ${names[1]}`;
}

/** The same article with a just-blocked publisher gone from its story. */
export function withoutPublisher<T extends Article>(article: T, domain: string): T {
    const publishers = parsePublishers(article.story_sources);
    const kept = publishers.filter((p) => p.source_domain !== domain);
    if (kept.length === publishers.length) return article;
    return { ...article, story_sources: kept, source_count: kept.length || null };
}

/**
 * Drops blocked publishers from every cached story they're in, so chips stop
 * naming them before the next fetch recomputes stories on the server. One pass
 * for any number of domains, since syncs hand over the whole blocklist.
 */
export async function forgetPublishers(domains: string[]): Promise<void> {
    if (domains.length === 0) return;
    const db = await getDb();
    const rows = await db.getAllAsync<Article>(
        `SELECT * FROM articles WHERE ${domains.map(() => 'story_sources LIKE ?').join(' OR ')}`,
        domains.map((domain) => `%${JSON.stringify(domain)}%`),
    );
    for (const row of rows) {
        const next = domains.reduce((article, domain) => withoutPublisher(article, domain), row);
        if (next === row) continue;
        await db.runAsync('UPDATE articles SET story_sources = ?, source_count = ? WHERE id = ?', [
            JSON.stringify(next.story_sources),
            next.source_count ?? null,
            row.id,
        ]);
    }
}
