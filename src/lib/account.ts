import { BASE_URL } from '@/lib/services';

export type DeleteAccountOutcome = 'deleted' | 'partial' | 'failed';

export async function deleteAccount(token: string): Promise<DeleteAccountOutcome> {
    try {
        const response = await fetch(`${BASE_URL}/api/me`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 204) return 'deleted';

        console.warn(`[account] delete failed with ${response.status}`);
        // A proxy can answer 502 for itself with nothing deleted; only the API's code proves
        // the data is gone and just the Clerk step failed.
        if (response.status === 502) {
            const body = (await response.json()) as { error?: unknown } | null;
            if (body?.error === 'EXTERNAL_SERVICE') return 'partial';
        }
        return 'failed';
    } catch (error) {
        console.warn('[account] delete failed:', error);
        return 'failed';
    }
}
