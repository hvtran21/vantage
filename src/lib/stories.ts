import type Article from '@/lib/constants';
import { BASE_URL, cacheArticles } from '@/lib/services';
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
    sources: StorySource[];
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
        return (await response.json()) as ArticleStory;
    } catch (error) {
        console.error('[api] fetchArticleStory failed:', error);
    }
}
