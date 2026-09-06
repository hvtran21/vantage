import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { extractDomain } from '@/lib/domain';

const DB_NAME = 'newsapp';

// Shared so busy_timeout (per-connection, unlike WAL mode) is actually set everywhere.
let dbPromise: Promise<SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLiteDatabase> {
    if (!dbPromise) {
        dbPromise = openDatabaseAsync(DB_NAME).then(async (db) => {
            await db.execAsync('PRAGMA busy_timeout = 3000;');
            await migrate(db);
            return db;
        });
    }
    return dbPromise;
}

// Versioned migrations, applied via PRAGMA user_version. v1 doesn't try to
// patch old drifted schemas (e.g. missing `category`); wipe the cache instead.
type Migration = { version: number; run: (db: SQLiteDatabase) => Promise<void> };

// SQLite has no `ADD COLUMN IF NOT EXISTS`, so this is how a migration stays
// re-runnable after a partial apply.
async function addColumn(db: SQLiteDatabase, table: string, column: string, type: string) {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (columns.some((c) => c.name === column)) return;
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

const MIGRATIONS: Migration[] = [
    {
        version: 1,
        run: (db) =>
            db.execAsync(`
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
            `),
    },
    {
        version: 2,
        run: async (db) => {
            await addColumn(db, 'articles', 'source_domain', 'TEXT');
            await db.execAsync(`
                CREATE INDEX IF NOT EXISTS idx_articles_source_domain
                    ON articles(source_domain);
                CREATE TABLE IF NOT EXISTS blocked_sources (
                    source_domain TEXT PRIMARY KEY NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1))
                );
            `);

            // Rows cached before the column existed would otherwise be
            // unblockable until they rotated out. SQLite has no regexp, so this
            // can't be expressed in the SQL above.
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
    {
        version: 3,
        run: async (db) => {
            // No CHECK constraint: unlike the columns in the original CREATE
            // TABLE, SQLite's ADD COLUMN doesn't reliably support adding one.
            await addColumn(db, 'articles', 'save_synced', 'INTEGER NOT NULL DEFAULT 1');
            // Anything already saved predates server sync entirely -- treat it as
            // pending so the next sync pushes it up instead of it looking synced
            // and never leaving the device.
            await db.execAsync('UPDATE articles SET save_synced = 0 WHERE saved = 1');
        },
    },
];

async function getUserVersion(db: SQLiteDatabase): Promise<number> {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    return row?.user_version ?? 0;
}

async function migrate(db: SQLiteDatabase) {
    // journal_mode can't run inside a transaction.
    await db.execAsync('PRAGMA journal_mode = WAL;');

    const currentVersion = await getUserVersion(db);
    const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
        (a, b) => a.version - b.version,
    );

    for (const migration of pending) {
        // The version bump commits with the migration's own work. Bumping
        // afterwards meant an interrupted run left the schema half-applied with
        // the old version still recorded, and the retry then failed forever.
        await db.withTransactionAsync(async () => {
            await migration.run(db);
            // PRAGMA takes no bound params; the version comes from the static
            // array above, not from user input.
            await db.execAsync(`PRAGMA user_version = ${migration.version}`);
        });
        console.log(`[db] applied migration ${migration.version}`);
    }
}

/**
 * Opens the database and brings the schema up to date, exactly once.
 *
 * Migrations live inside this promise rather than in a separate exported step so
 * no caller can reach a table before it exists -- the root PrincipalSync effect
 * used to race the screen that called the old initializeDatabase().
 */
export function initializeDatabase(): Promise<SQLiteDatabase> {
    return getDb();
}

export async function getUser() {
    const db = await getDb();
    const user = await db.getFirstAsync('SELECT * FROM users LIMIT 1');
    return user as {
        id: number;
        display_name: string | null;
        email: string | null;
        avatar_uri: string | null;
        created_at: string;
    } | null;
}

export async function upsertUser(displayName: string, email?: string) {
    const db = await getDb();
    const existing = await db.getFirstAsync('SELECT id FROM users LIMIT 1');
    if (existing) {
        await db.runAsync('UPDATE users SET display_name = ?, email = ? WHERE id = ?', [
            displayName,
            email ?? null,
            (existing as { id: number }).id,
        ]);
    } else {
        await db.runAsync('INSERT INTO users (display_name, email) VALUES (?, ?)', [
            displayName,
            email ?? null,
        ]);
    }
}
