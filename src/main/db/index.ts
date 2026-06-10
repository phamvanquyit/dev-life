import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import * as schema from './schema'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqliteInstance: Database.Database | null = null

export function getDb() {
  if (db) return db

  const dataDir = join(app.getPath('userData'), 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = join(dataDir, 'dev-life.db')
  const sqlite = new Database(dbPath)
  sqliteInstance = sqlite

  // Enable WAL mode for better performance
  sqlite.pragma('journal_mode = WAL')

  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS password_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      password TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS configurations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS antigravity_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS antigravity_conversations (
      conversation_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Migration: add project_id column if it doesn't exist
  try {
    sqlite.exec(`ALTER TABLE antigravity_projects ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`)
  } catch {
    // Column already exists
  }

  db = drizzle(sqlite, { schema })
  return db
}

/**
 * Get the raw better-sqlite3 instance for direct SQL operations.
 * Must call getDb() first to ensure initialization.
 */
export function getSqlite(): Database.Database {
  if (!sqliteInstance) {
    getDb() // Initialize if needed
  }
  return sqliteInstance!
}
