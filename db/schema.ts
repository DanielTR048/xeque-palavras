import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const profileDocuments = sqliteTable('profile_documents', {
  ownerId: text('owner_id').notNull(),
  profileId: text('profile_id').notNull(),
  document: text('document').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.profileId] })]);

export const syncDevices = sqliteTable('sync_devices', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  label: text('label').notNull(),
  tokenHash: text('token_hash').notNull(),
  nonceHash: text('nonce_hash').notNull(),
  keyHash: text('key_hash').notNull(),
  envelope: text('envelope').notNull(),
  createdAt: integer('created_at').notNull(),
  lastSeen: integer('last_seen').notNull(),
  revokedAt: integer('revoked_at'),
}, table => [uniqueIndex('device_token_unique').on(table.tokenHash),
  uniqueIndex('owner_pairing_nonce_unique').on(table.ownerId, table.nonceHash)]);
