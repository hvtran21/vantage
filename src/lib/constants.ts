export default interface Article {
    id: string;
    genre: string | null;
    category: string | null;
    source: string;
    author: string | null;
    title: string;
    description: string;
    url: string;
    url_to_image: string;
    published_at: string;
    content?: string;
    saved: number;
    // Sent by the API; null on rows cached before the column existed.
    source_domain?: string | null;
}
