import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const passwordHistory = sqliteTable('password_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  password: text('password').notNull(),
  domain: text('domain').notNull().default(''),
  url: text('url').notNull().default(''),
  browser: text('browser').notNull().default(''),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const configurations = sqliteTable('configurations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull().default(''),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const antigravityProjects = sqliteTable('antigravity_projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  projectId: text('project_id').notNull().default(''),
  path: text('path').notNull().default(''),
  syncedAt: text('synced_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const antigravityConversations = sqliteTable('antigravity_conversations', {
  conversationId: text('conversation_id').primaryKey(),
  projectName: text('project_name').notNull(),
  syncedAt: text('synced_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export type PasswordHistoryEntry = typeof passwordHistory.$inferSelect
export type NewPasswordHistoryEntry = typeof passwordHistory.$inferInsert
export type ConfigurationEntry = typeof configurations.$inferSelect
export type NewConfigurationEntry = typeof configurations.$inferInsert
export type AntigravityProjectEntry = typeof antigravityProjects.$inferSelect
export type NewAntigravityProjectEntry = typeof antigravityProjects.$inferInsert
export type AntigravityConversationEntry = typeof antigravityConversations.$inferSelect
export type NewAntigravityConversationEntry = typeof antigravityConversations.$inferInsert
