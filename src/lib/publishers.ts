// NewsAPI returns publisher names as free text -- "Theregister.com",
// "9to5google.com" -- so this keys off the normalized domain instead and
// supplies the real masthead name. Anything absent here just falls back to
// the bare domain; the list only needs to grow, never be exhaustive.
const KNOWN_PUBLISHERS: Record<string, string> = {
    'theverge.com': 'The Verge',
    'techcrunch.com': 'TechCrunch',
    'theregister.com': 'The Register',
    'wired.com': 'Wired',
    'arstechnica.com': 'Ars Technica',
    'engadget.com': 'Engadget',
    'zdnet.com': 'ZDNET',
    'macrumors.com': 'MacRumors',
    '9to5mac.com': '9to5Mac',
    '9to5google.com': '9to5Google',
    'techradar.com': 'TechRadar',
    'tomshardware.com': "Tom's Hardware",
    'tomsguide.com': "Tom's Guide",
    'bleepingcomputer.com': 'BleepingComputer',
    'darkreading.com': 'Dark Reading',
    'thehackernews.com': 'The Hacker News',
    'krebsonsecurity.com': 'Krebs on Security',
    'thenextweb.com': 'The Next Web',
    'venturebeat.com': 'VentureBeat',
    'gizmodo.com': 'Gizmodo',
    'cnet.com': 'CNET',
    'pcmag.com': 'PCMag',
    'androidcentral.com': 'Android Central',
    'androidauthority.com': 'Android Authority',
    'androidpolice.com': 'Android Police',
    '9to5linux.com': '9to5Linux',
    'reuters.com': 'Reuters',
    'apnews.com': 'AP News',
    'bbc.com': 'BBC',
    'bbc.co.uk': 'BBC',
    'nytimes.com': 'The New York Times',
    'bloomberg.com': 'Bloomberg',
    'cnbc.com': 'CNBC',
    'forbes.com': 'Forbes',
    'axios.com': 'Axios',
    'businessinsider.com': 'Business Insider',
    'spaceflightnow.com': 'Spaceflight Now',
    'nasaspaceflight.com': 'NASASpaceflight',
    'ign.com': 'IGN',
    'polygon.com': 'Polygon',
    'kotaku.com': 'Kotaku',
    'eurogamer.net': 'Eurogamer',
    'gamesradar.com': 'GamesRadar+',
    'pcgamer.com': 'PC Gamer',
    'coindesk.com': 'CoinDesk',
    'cointelegraph.com': 'Cointelegraph',
    'techspot.com': 'TechSpot',
    'macworld.com': 'Macworld',
    'appleinsider.com': 'AppleInsider',
};

export type PublisherLabel = { name: string; known: boolean };

/** Known publishers get their real masthead name; everything else, the bare domain. */
export function getPublisherLabel(domain: string | null | undefined): PublisherLabel | null {
    if (!domain) return null;
    const known = KNOWN_PUBLISHERS[domain];
    return known ? { name: known, known: true } : { name: domain, known: false };
}
