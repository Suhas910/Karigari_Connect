// src/services/database.ts
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export const getDb = async () => {
  if (!db) {
    db = await SQLite.openDatabaseAsync('karigari.db');
  }
  return db;
};

export const initDatabase = async () => {
  const database = await getDb();

  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY NOT NULL,
      listing_id TEXT,
      state TEXT NOT NULL DEFAULT 'draft',
      preferred_language TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL,
      idempotency_key TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  console.log('[DB] Tables ready: drafts, outbox');
};

export const saveDraft = async (draft: {
  id: string;
  listing_id?: string;
  state: string;
  preferred_language: string;
  payload: object;
}) => {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT OR REPLACE INTO drafts (id, listing_id, state, preferred_language, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM drafts WHERE id = ?), ?), ?)`,
    [draft.id, draft.listing_id ?? null, draft.state, draft.preferred_language, JSON.stringify(draft.payload), draft.id, now, now]
  );
};

export const getDraft = async (id: string) => {
  const database = await getDb();
  const row = await database.getFirstAsync<any>(`SELECT * FROM drafts WHERE id = ?`, [id]);
  return row ? { ...row, payload: JSON.parse(row.payload) } : null;
};

export const listDrafts = async () => {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(`SELECT * FROM drafts ORDER BY updated_at DESC`);
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
};