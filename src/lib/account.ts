import { BASE_URL } from '@/lib/services';

export async function deleteAccount(token: string): Promise<number | null> {
    try {
        const response = await fetch(`${BASE_URL}/api/me`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status !== 204) {
            console.warn(`[account] delete failed with ${response.status}`);
        }
        return response.status;
    } catch (error) {
        console.warn('[account] delete failed:', error);
        return null;
    }
}
