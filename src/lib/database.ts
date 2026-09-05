import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { extractDomain } from '@/lib/domain';

const DB_NAME = 'newsapp';

// Shared so busy_timeout (per-connection, unlike WAL mode) is actually set everywhere.
let dbPromise: Promise<SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLiteDatabase> {
    if (!dbPromise) {
        dbPromise = openDatabaseAsync(DB_NAME).then(async (db) => {
            await db.execAsync('PRAGMA busy_timeout = 3000;');
            return db;
        });
    }
    return dbPromise;
}

// Versioned migrations, applied via PRAGMA user_version. v1 doesn't try to
// patch old drifted schemas (e.g. missing `category`); wipe the cache instead.
// `after` exists because SQLite has no regexp, so the v2 backfill can't be
// expressed in the SQL the way the server's migration could.
const MIGRATIONS: {
    version: number;
    up: string;
    after?: (db: SQLiteDatabase) => Promise<void>;
}[] = [
    {
        version: 1,
        up: `
            CREATE TABLE IF NOT EXISTS articles (
                id TEXT PRIMARY KEY,
                genre TEXT,
                category TEXT,
                source TEXT,
                author TEXT,
                title TEXT,
                description TEXT,
                url TEXT,
                url_to_image TEXT,
                published_at TEXT,
                content TEXT,
                saved INTEGER CHECK (saved IN (0, 1)) DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS metadata (
                latest_article_query TEXT
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                display_name TEXT,
                email TEXT,
                avatar_uri TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
        `,
    },
    {
        version: 2,
        up: `
            ALTER TABLE articles ADD COLUMN source_domain TEXT;
            CREATE INDEX IF NOT EXISTS idx_articles_source_domain
                ON articles(source_domain);
            CREATE TABLE IF NOT EXISTS blocked_sources (
                source_domain TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1))
            );
        `,
        // Rows cached before this column existed would otherwise be unblockable
        // until they rotated out.
        after: async (db) => {
            const rows = await db.getAllAsync<{ id: string; url: string | null }>(
                'SELECT id, url FROM articles WHERE source_domain IS NULL',
            );
            for (const row of rows) {
                const domain = extractDomain(row.url);
                if (domain) {
                    await db.runAsync('UPDATE articles SET source_domain = ? WHERE id = ?', [
                        domain,
                        row.id,
                    ]);
                }
            }
            console.log(`[db] backfilled source_domain for ${rows.length} article(s)`);
        },
    },
];

async function getUserVersion(db: SQLiteDatabase): Promise<number> {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    return row?.user_version ?? 0;
}

export async function initializeDatabase() {
    const db = await getDb();

    // Apparently 'PRAGMA journal_mode = WAL' can't run outside of a transaction.
    await db.execAsync('PRAGMA journal_mode = WAL;');

    const currentVersion = await getUserVersion(db);
    const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
        (a, b) => a.version - b.version,
    );

    for (const migration of pending) {
        await db.withTransactionAsync(async () => {
            await db.execAsync(migration.up);
        });
        // Runs outside the transaction above: a long row-by-row backfill holding
        // a write lock would collide with the feed's own reads on startup.
        await migration.after?.(db);
        // PRAGMA doesn't support bound params; version is from our own static array, not user input.
        await db.execAsync(`PRAGMA user_version = ${migration.version}`);
        console.log(`[db] applied migration ${migration.version}`);
    }
}

export async function getUser() {
    const db = await getDb();
    const user = await db.getFirstAsync('SELECT * FROM users LIMIT 1');
    return user as { id: number; display_name: string | null; email: string | null; avatar_uri: string | null; created_at: string } | null;
}

export async function upsertUser(displayName: string, email?: string) {
    const db = await getDb();
    const existing = await db.getFirstAsync('SELECT id FROM users LIMIT 1');
    if (existing) {
        await db.runAsync(
            'UPDATE users SET display_name = ?, email = ? WHERE id = ?',
            [displayName, email ?? null, (existing as { id: number }).id],
        );
    } else {
        await db.runAsync(
            'INSERT INTO users (display_name, email) VALUES (?, ?)',
            [displayName, email ?? null],
        );
    }
}
