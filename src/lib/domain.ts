/**
 * The publisher a URL belongs to, e.g. "thenextweb.com". Mirrors
 * src/lib/domain.ts in vantage-api; only needed for rows cached before the
 * source_domain column existed.
 */
export function extractDomain(url: string | null | undefined): string | null {
    if (!url) return null;

    const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
    if (!match) return null;

    return match[1].toLowerCase().replace(/^www\./, '') || null;
}

/** The domain to block for an article, preferring what the server already told us. */
export function domainForArticle(article: {
    source_domain?: string | null;
    url?: string | null;
}): string | null {
    return article.source_domain ?? extractDomain(article.url);
}
