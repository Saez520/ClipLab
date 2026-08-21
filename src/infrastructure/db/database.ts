import Database from 'better-sqlite3'; import { mkdirSync } from 'node:fs'; import { dirname, resolve } from 'node:path';
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS opportunities (opportunity_id TEXT PRIMARY KEY, state TEXT NOT NULL, stable_state TEXT NOT NULL, blocked_reason TEXT, blocked_actor TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS authorizations (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL, from_state TEXT NOT NULL, role TEXT NOT NULL, actor TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, FOREIGN KEY(opportunity_id) REFERENCES opportunities(opportunity_id));
CREATE TABLE IF NOT EXISTS handoffs (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL, from_state TEXT NOT NULL, to_state TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(opportunity_id) REFERENCES opportunities(opportunity_id));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT, actor TEXT NOT NULL, reason TEXT, payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY(opportunity_id) REFERENCES opportunities(opportunity_id));
` as const;
export function openDatabase(path = process.env.DATABASE_PATH ?? './data/pipeline.sqlite'): Database.Database { const filename = path === ':memory:' ? path : resolve(path); if(filename !== ':memory:') mkdirSync(dirname(filename), { recursive:true }); const db = new Database(filename); db.pragma('foreign_keys = ON'); db.exec(SCHEMA_SQL); return db; }
