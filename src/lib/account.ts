import { BASE_URL } from '@/lib/services';

export async function deleteAccount(token: string): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/api/me`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 204) return true;
        throw new Error(`server returned ${response.status}`);
    } catch (error) {
        console.warn('[account] delete failed:', error);
        return false;
    }
}
