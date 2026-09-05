import Article from '@/lib/constants';
import { getDb } from '@/lib/database';

export function stripHtml(text: string): string {
    return (
        text
            .replace(/<[^>]*>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            // NewsAPI appends a literal '… [+28934 chars]' to truncated content.
            .replace(/\s*\[\+[\d,]+\s*chars\]\s*$/i, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
    );
}

type MetadataRow = {
    latest_article_query: string | null;
};

export async function deleteArticlesByAge(days?: number): Promise<number> {
    const retentionDays = days ?? 4;

    const db = await getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffDate = cutoff.toISOString().split('T')[0];

    try {
        const result = await db.runAsync(
            'DELETE FROM articles WHERE published_at <= $date AND saved = 0',
            {
                $date: cutoffDate,
            },
        );
        console.log(
            `[cleanup] Removed ${result.changes} article(s) older than ${retentionDays} days`,
        );
        return result.changes;
    } catch (error) {
        console.error('[cleanup] Error removing old articles:', error);
        return -1;
    }
}

export async function deleteArticlesById(id: string) {
    const db = await getDb();
    try {
        const result = await db.runAsync('DELETE FROM articles WHERE id = $id', {
            $id: id,
        });

        if (result.changes === 1) {
            console.log(`Successfully removed article ${id}`);
            return;
        } else {
            console.error(`Deleting article ${id} failed, it may not exist, or ID is wrong.`);
        }
    } catch (error) {
        console.error(`Error occurred: ${error}`);
    }
}

export default async function getArticleById(id: string) {
    const db = await getDb();
    try {
        const article = (await db.getFirstAsync('SELECT * FROM articles WHERE id = ?', [
            id,
        ])) as Article;
        if (!article) {
            throw new Error(`Article with ID ${id} not found`);
        }
        return article;
    } catch (error) {
        console.error(`Error occurred: ${error}`);
    }
}

export function sortArticlesByDate(articles: Article[]): Article[] {
    const result = [...articles].sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    );
    return result;
}

export async function updateArticleQueryTime() {
    const currentDate = new Date().toISOString();
    const db = await getDb();
    try {
        const result = await db.runAsync('UPDATE metadata SET latest_article_query = $date', {
            $date: currentDate,
        });

        if (result.changes === 0) {
            await db.runAsync('INSERT INTO metadata (latest_article_query) VALUES ($date)', {
                $date: currentDate,
            });
        }

        console.log(`Updated article query date: ${currentDate}`);
    } catch (error) {
        console.error(error);
    }
}

export async function canRefreshArticles() {
    const cooldownMinutes = 0.5;
    const db = await getDb();

    try {
        const row = (await db.getFirstAsync('SELECT * FROM metadata')) as MetadataRow;

        if (row === null || row === undefined) {
            return true;
        }

        const lastQueryTime = row.latest_article_query ?? '';

        if (!lastQueryTime) {
            throw new Error('latest_article_query is empty. This should not have happened..');
        }

        const lastRefresh = new Date(lastQueryTime);
        const now = new Date();
        const elapsedMinutes = Math.abs(now.getTime() - lastRefresh.getTime()) / (1000 * 60);

        if (elapsedMinutes < cooldownMinutes) {
            console.log('Refresh cooldown in effect.');
            return false;
        }
    } catch (error) {
        console.error(error);
    }

    console.log('Refresh approved!');
    return true;
}
