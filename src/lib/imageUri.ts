const WEB_URL = /^https?:\/\/\S+$/i;

/**
 * The image URL if it is an absolute http(s) one, otherwise undefined, so the caller shows its
 * placeholder. The URL comes from a publisher's feed, and the image view will fetch whatever
 * scheme it is handed (file:, content:, data:), so only the web ones get through.
 */
export function safeImageUri(url: unknown): string | undefined {
    if (typeof url !== 'string') return undefined;
    const trimmed = url.trim();
    return WEB_URL.test(trimmed) ? trimmed : undefined;
}
