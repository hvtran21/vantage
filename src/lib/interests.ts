import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '@/lib/services';
import { principalHeaders } from '@/lib/principal';

const STORAGE_KEY = 'genreSelection';

async function readLocal(): Promise<string[]> {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? stored.split(',') : [];
}

async function writeLocal(genres: string[]): Promise<void> {
    if (genres.length > 0) {
        await AsyncStorage.setItem(STORAGE_KEY, genres.join(','));
    } else {
        await AsyncStorage.removeItem(STORAGE_KEY);
    }
}

export async function getInterests(): Promise<string[]> {
    return readLocal();
}

/** Local-first, like blockSource -- works offline and while signed out. */
export async function addInterest(genre: string, token?: string | null): Promise<void> {
    const current = await readLocal();
    if (!current.includes(genre)) {
        await writeLocal([...current, genre]);
    }
    await pushInterest(genre, token);
}

/**
 * Removes an interest, rolling back locally if the server refused -- otherwise
 * the next sync silently reinstates it with no explanation, same as unblockSource.
 */
export async function removeInterest(genre: string, token?: string | null): Promise<boolean> {
    const previous = await readLocal();
    await writeLocal(previous.filter((g) => g !== genre));

    try {
        const response = await fetch(`${BASE_URL}/api/me/interests/${encodeURIComponent(genre)}`, {
            method: 'DELETE',
            headers: await principalHeaders(token),
        });
        if (response.ok || response.status === 404) return true;
        throw new Error(`server returned ${response.status}`);
    } catch (error) {
        console.warn('[interests] remove did not reach the server:', error);
        await writeLocal(previous);
        return false;
    }
}

async function pushInterest(genre: string, token?: string | null): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/api/me/interests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await principalHeaders(token)) },
            body: JSON.stringify({ genre }),
        });
        return response.ok;
    } catch (error) {
        console.warn('[interests] add did not reach the server:', error);
        return false;
    }
}

/** Union, not server-wins -- mirrors syncBlockedSources; losing a pick offline is the bad failure. */
export async function syncInterests(token?: string | null): Promise<void> {
    try {
        const local = await readLocal();
        const response = await fetch(`${BASE_URL}/api/me/interests`, {
            headers: await principalHeaders(token),
        });
        if (!response.ok) return;

        const { interests } = (await response.json()) as { interests: { genre: string }[] };
        const remote = interests.map((interest) => interest.genre);

        // Anything local-only might just be a push that never landed -- retry it.
        for (const genre of local) {
            if (!remote.includes(genre)) await pushInterest(genre, token);
        }

        await writeLocal(Array.from(new Set([...local, ...remote])));
    } catch (error) {
        console.warn('[interests] sync failed:', error);
    }
}

/**
 * Mirrors one principal's server interests onto the device, replacing local --
 * same reasoning as replaceLocalBlocklist: a principal change replaces rather
 * than unions, or a shared device would carry one account's picks into the next.
 */
export async function replaceLocalInterests(token?: string | null): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/api/me/interests`, {
            headers: await principalHeaders(token),
        });
        if (!response.ok) return false;

        const { interests } = (await response.json()) as { interests: { genre: string }[] };
        await writeLocal(interests.map((interest) => interest.genre));
        return true;
    } catch (error) {
        console.warn('[interests] could not mirror interests:', error);
        return false;
    }
}
