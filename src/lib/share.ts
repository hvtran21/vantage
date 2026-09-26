import { Platform, Share } from 'react-native';
import { faArrowUpFromBracket, faShareNodes } from '@fortawesome/free-solid-svg-icons';
import type Article from '@/lib/constants';

export const shareIcon = Platform.OS === 'ios' ? faArrowUpFromBracket : faShareNodes;

/** Opens the native share sheet. Doesn't count as a read: you can pass a link on unread. */
export async function shareArticle(article: Pick<Article, 'title' | 'url'>): Promise<void> {
    const url = article.url?.trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    const title = article.title?.trim();
    try {
        // iOS gets the bare url: adding a message made Copy put the headline on
        // the clipboard instead of the link. The sheet fetches the page title for
        // its preview anyway. Android drops `url`, so there it rides in the text.
        await Share.share(
            Platform.OS === 'ios'
                ? { url }
                : { message: title ? `${title}\n${url}` : url, title },
        );
    } catch (error) {
        console.warn('[share] could not open share sheet:', error);
    }
}
