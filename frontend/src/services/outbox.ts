// src/services/outbox.ts
import * as Crypto from 'expo-crypto';
import { getDb } from './database';
import { api } from './api';

export const enqueueRequest = async (method: string, url: string, body?: object) => {
  const database = await getDb();
  const id = Crypto.randomUUID();
  const idempotencyKey = Crypto.randomUUID();
  await database.runAsync(
    `INSERT INTO outbox (id, idempotency_key, method, url, body, status, attempt, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [id, idempotencyKey, method, url, body ? JSON.stringify(body) : null, new Date().toISOString()]
  );
  return { id, idempotencyKey };
};

export const processOutbox = async () => {
  const database = await getDb();
  const pending = await database.getAllAsync<any>(
    `SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC`
  );

  for (const req of pending) {
    try {
      await api.request({
        method: req.method,
        url: req.url,
        data: req.body ? JSON.parse(req.body) : undefined,
        headers: { 'Idempotency-Key': req.idempotency_key }, // same key every retry — safe re-send
      });
      await database.runAsync(`UPDATE outbox SET status = 'complete' WHERE id = ?`, [req.id]);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status && status >= 400 && status < 500) {
        // Non-recoverable client error — stop retrying this one
        await database.runAsync(`UPDATE outbox SET status = 'failed' WHERE id = ?`, [req.id]);
        console.error(`[Outbox] Request ${req.id} failed with 4xx, marked failed.`);
      } else {
        // Network/5xx — bump attempt count, leave pending for next sync
        await database.runAsync(`UPDATE outbox SET attempt = attempt + 1 WHERE id = ?`, [req.id]);
      }
    }
  }
};