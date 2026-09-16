import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const userStatus = pgEnum("user_status", ["active", "suspended", "closed"]);
export const entitlementStatus = pgEnum("entitlement_status", ["granted", "consumed", "revoked", "expired"]);
export const shareState = pgEnum("share_state", ["started", "completed_by_user", "verified", "rejected", "expired"]);
export const actorType = pgEnum("actor_type", ["user", "engine", "system", "admin"]);
export const ledgerAccountType = pgEnum("ledger_account_type", [
  "USER_AVAILABLE", "USER_LOCKED", "USER_PENDING_DEPOSIT", "USER_PENDING_WITHDRAWAL",
  "TREASURY", "FEE_REVENUE", "TRADING_CLEARING", "CREATOR_TREASURY", "SYSTEM_SUSPENSE", "EXTERNAL_SETTLEMENT"
]);
export const ledgerDirection = pgEnum("ledger_direction", ["debit", "credit"]);
export const journalStatus = pgEnum("journal_status", ["posted", "reversed"]);
export const orderSide = pgEnum("order_side", ["buy", "sell"]);
export const orderStatus = pgEnum("order_status", ["pending", "open", "partially_filled", "filled", "cancelled", "rejected"]);
export const activitySource = pgEnum("activity_source", ["user", "engine", "system", "admin", "promotion"]);
export const fundingStatus = pgEnum("funding_status", ["pending", "confirmed", "credited", "failed", "reversed"]);
export const withdrawalStatus = pgEnum("withdrawal_status", ["requested", "pending", "approved", "submitted", "confirmed", "failed", "reversed", "cancelled"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  status: userStatus("status").notNull().default("active"),
  ...timestamps
});

export const identities = pgTable("identities", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  providerSubject: text("provider_subject").notNull(),
  ...timestamps
}, (table) => ({
  providerSubjectIdx: uniqueIndex("identities_provider_subject_uq").on(table.provider, table.providerSubject),
  userIdx: index("identities_user_idx").on(table.userId)
}));

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  decimals: integer("decimals").notNull(),
  chain: text("chain"),
  contractAddress: text("contract_address"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps
}, (table) => ({
  decimalsCheck: check("assets_decimals_check", sql`${table.decimals} >= 0 AND ${table.decimals} <= 30`)
}));

export const markets = pgTable("markets", {
  id: uuid("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  baseAssetId: uuid("base_asset_id").notNull().references(() => assets.id),
  quoteAssetId: uuid("quote_asset_id").notNull().references(() => assets.id),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps
});

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  accountType: ledgerAccountType("account_type").notNull(),
  code: text("code").notNull().unique(),
  ...timestamps
}, (table) => ({
  userAssetTypeIdx: uniqueIndex("ledger_accounts_user_asset_type_uq").on(table.userId, table.assetId, table.accountType)
}));

export const journalTransactions = pgTable("journal_transactions", {
  id: uuid("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  referenceType: text("reference_type").notNull(),
  referenceId: uuid("reference_id"),
  status: journalStatus("status").notNull().default("posted"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps
});

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey(),
  transactionId: uuid("transaction_id").notNull().references(() => journalTransactions.id),
  accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id),
  direction: ledgerDirection("direction").notNull(),
  amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
  sequence: integer("sequence").notNull(),
  ...timestamps
}, (table) => ({
  transactionSequenceUq: uniqueIndex("journal_entries_transaction_sequence_uq").on(table.transactionId, table.sequence),
  amountCheck: check("journal_entries_amount_positive", sql`${table.amount} > 0`),
  transactionIdx: index("journal_entries_transaction_idx").on(table.transactionId),
  accountIdx: index("journal_entries_account_idx").on(table.accountId)
}));

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  marketId: uuid("market_id").notNull().references(() => markets.id),
  side: orderSide("side").notNull(),
  status: orderStatus("status").notNull().default("pending"),
  quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull(),
  remainingQuantity: numeric("remaining_quantity", { precision: 38, scale: 18 }).notNull(),
  limitPrice: numeric("limit_price", { precision: 38, scale: 18 }),
  feeRate: numeric("fee_rate", { precision: 20, scale: 10 }).notNull().default("0.0055"),
  clientOrderId: text("client_order_id").notNull(),
  sequence: integer("sequence").notNull().default(sql`nextval('orders_sequence_seq')`),
  ...timestamps
}, (table) => ({
  clientOrderUq: uniqueIndex("orders_user_client_order_uq").on(table.userId, table.clientOrderId),
  sequenceUq: uniqueIndex("orders_sequence_uq").on(table.sequence),
  userIdx: index("orders_user_idx").on(table.userId, table.createdAt),
  marketBookIdx: index("orders_market_book_idx").on(table.marketId, table.status, table.side, table.sequence),
  quantityCheck: check("orders_quantity_positive", sql`${table.quantity} > 0`),
  remainingQuantityCheck: check("orders_remaining_quantity_valid", sql`${table.remainingQuantity} >= 0 AND ${table.remainingQuantity} <= ${table.quantity}`),
  limitPriceCheck: check("orders_limit_price_positive", sql`${table.limitPrice} IS NULL OR ${table.limitPrice} > 0`)
}));

export const trades = pgTable("trades", {
  id: uuid("id").primaryKey(),
  marketId: uuid("market_id").notNull().references(() => markets.id),
  buyOrderId: uuid("buy_order_id").notNull().references(() => orders.id),
  sellOrderId: uuid("sell_order_id").notNull().references(() => orders.id),
  price: numeric("price", { precision: 38, scale: 18 }).notNull(),
  quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull(),
  feeAmount: numeric("fee_amount", { precision: 38, scale: 18 }).notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps
}, (table) => ({
  priceCheck: check("trades_price_positive", sql`${table.price} > 0`),
  quantityCheck: check("trades_quantity_positive", sql`${table.quantity} > 0`),
  feeCheck: check("trades_fee_nonnegative", sql`${table.feeAmount} >= 0`),
  marketIdx: index("trades_market_time_idx").on(table.marketId, table.executedAt)
}));

export const deposits = pgTable("deposits", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  pendingAccountId: uuid("pending_account_id").notNull().references(() => ledgerAccounts.id),
  amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
  status: fundingStatus("status").notNull().default("pending"),
  externalReference: text("external_reference").notNull().unique(),
  confirmationCount: integer("confirmation_count").notNull().default(0),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  creditedAt: timestamp("credited_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  ...timestamps
}, (table) => ({
  userStatusIdx: index("deposits_user_status_idx").on(table.userId, table.status, table.createdAt),
  amountCheck: check("deposits_amount_positive", sql`${table.amount} > 0`),
  confirmationsCheck: check("deposits_confirmation_count_nonnegative", sql`${table.confirmationCount} >= 0`)
}));

export const withdrawals = pgTable("withdrawals", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  pendingAccountId: uuid("pending_account_id").notNull().references(() => ledgerAccounts.id),
  amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
  status: withdrawalStatus("status").notNull().default("requested"),
  destination: text("destination").notNull(),
  externalReference: text("external_reference").unique(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  ...timestamps
}, (table) => ({
  userStatusIdx: index("withdrawals_user_status_idx").on(table.userId, table.status, table.createdAt),
  amountCheck: check("withdrawals_amount_positive", sql`${table.amount} > 0`)
}));

export const coinProjects = pgTable("coin_projects", {
  id: uuid("id").primaryKey(),
  creatorUserId: uuid("creator_user_id").notNull().references(() => users.id),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps
}, (table) => ({
  creatorIdx: index("coin_projects_creator_idx").on(table.creatorUserId),
  symbolUq: uniqueIndex("coin_projects_symbol_uq").on(table.symbol)
}));

export const coinCreationEntitlements = pgTable("coin_creation_entitlements", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  entitlementType: text("entitlement_type").notNull(),
  status: entitlementStatus("status").notNull().default("granted"),
  source: text("source").notNull().default("initial_free"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  ...timestamps
}, (table) => ({
  oneEntitlementPerType: uniqueIndex("coin_creation_entitlements_user_type_uq").on(table.userId, table.entitlementType)
}));

export const coinCreationRedemptions = pgTable("coin_creation_redemptions", {
  id: uuid("id").primaryKey(),
  entitlementId: uuid("entitlement_id").notNull().references(() => coinCreationEntitlements.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  coinProjectId: uuid("coin_project_id").notNull().references(() => coinProjects.id),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps
});

export const unlockCampaigns = pgTable("unlock_campaigns", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  requiredShareState: shareState("required_share_state").notNull().default("verified"),
  rewardType: text("reward_type").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  ...timestamps
});

export const shareIntents = pgTable("share_intents", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  campaignId: uuid("campaign_id").notNull().references(() => unlockCampaigns.id),
  channel: text("channel").notNull(),
  state: shareState("state").notNull().default("started"),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  verificationData: jsonb("verification_data").$type<Record<string, unknown>>(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps
}, (table) => ({
  userCampaignIdx: index("share_intents_user_campaign_idx").on(table.userId, table.campaignId),
  stateIdx: index("share_intents_state_idx").on(table.state)
}));

export const unlocks = pgTable("unlocks", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  campaignId: uuid("campaign_id").notNull().references(() => unlockCampaigns.id),
  shareIntentId: uuid("share_intent_id").notNull().references(() => shareIntents.id),
  rewardType: text("reward_type").notNull(),
  claimedAt: timestamp("claimed_at" , { withTimezone: true }),
  ...timestamps
}, (table) => ({
  oneUnlockPerUserCampaign: uniqueIndex("unlocks_user_campaign_uq").on(table.userId, table.campaignId)
}));

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey(),
  actorType: actorType("actor_type").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  source: activitySource("source").notNull(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  entityIdx: index("activity_events_entity_idx").on(table.entityType, table.entityId, table.occurredAt),
  actorIdx: index("activity_events_actor_idx").on(table.actorType, table.actorUserId, table.occurredAt)
}));

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey(),
  actorType: actorType("actor_type").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  entityIdx: index("audit_events_entity_idx").on(table.entityType, table.entityId, table.occurredAt)
}));

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  operation: text("operation").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps
});

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  ...timestamps
}, (table) => ({
  unpublishedIdx: index("outbox_events_unpublished_idx").on(table.publishedAt, table.createdAt)
}));

export const ledgerBalanceProjections = pgTable("ledger_balance_projections", {
  accountId: uuid("account_id").primaryKey().references(() => ledgerAccounts.id),
  balance: numeric("balance", { precision: 38, scale: 18 }).notNull().default("0"),
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  balanceCheck: check("ledger_balance_nonnegative", sql`${table.balance} >= 0`)
}));

export const allTables = {
  users,
  identities,
  assets,
  markets,
  ledgerAccounts,
  journalTransactions,
  journalEntries,
  orders,
  trades,
  deposits,
  withdrawals,
  coinProjects,
  coinCreationEntitlements,
  coinCreationRedemptions,
  unlockCampaigns,
  shareIntents,
  unlocks,
  activityEvents,
  auditEvents,
  idempotencyKeys,
  outboxEvents,
  ledgerBalanceProjections
};

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type JournalTransaction = typeof journalTransactions.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type CoinProject = typeof coinProjects.$inferSelect;
