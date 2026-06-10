import { desc, eq } from 'drizzle-orm'
import { ipcMain } from 'electron'
import { getDb } from './db'
import type { PasswordHistoryEntry } from './db/schema'
import { passwordHistory } from './db/schema'

const MAX_HISTORY = 500

export function setupPasswordHistoryIPC(): void {
  ipcMain.handle(
    'password-history:save',
    (
      _event,
      entries: { password: string; domain: string; url: string; browser: string }[],
    ): PasswordHistoryEntry[] => {
      const db = getDb()
      const now = new Date().toISOString()

      for (const entry of entries) {
        db.insert(passwordHistory)
          .values({
            password: entry.password,
            domain: entry.domain,
            url: entry.url,
            browser: entry.browser,
            createdAt: now,
          })
          .run()
      }

      // Return latest entries
      return db
        .select()
        .from(passwordHistory)
        .orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id))
        .limit(MAX_HISTORY)
        .all()
    },
  )

  ipcMain.handle('password-history:get', (): PasswordHistoryEntry[] => {
    const db = getDb()
    return db
      .select()
      .from(passwordHistory)
      .orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id))
      .limit(MAX_HISTORY)
      .all()
  })

  ipcMain.handle('password-history:delete', (_event, id: number): PasswordHistoryEntry[] => {
    const db = getDb()
    db.delete(passwordHistory).where(eq(passwordHistory.id, id)).run()
    return db
      .select()
      .from(passwordHistory)
      .orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id))
      .limit(MAX_HISTORY)
      .all()
  })

  ipcMain.handle('password-history:clear', (): PasswordHistoryEntry[] => {
    const db = getDb()
    db.delete(passwordHistory).run()
    return []
  })
}
