-- Migration: 0001_init.sql
-- Initial schema for Shared Bill Splitter

-- 1. Homes Table
CREATE TABLE IF NOT EXISTS homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Members Table
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  member_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT check_members_order CHECK (member_order >= 1),
  CONSTRAINT uq_members_home_order UNIQUE (home_id, member_order)
);

CREATE INDEX IF NOT EXISTS idx_members_home_order ON members(home_id, member_order ASC);

-- 3. Bills Table
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT check_bills_total_cents CHECK (total_cents > 0 AND typeof(total_cents) = 'integer')
);

CREATE INDEX IF NOT EXISTS idx_bills_home ON bills(home_id);

-- 4. Bill Shares Table
CREATE TABLE IF NOT EXISTS bill_shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT fk_shares_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  CONSTRAINT fk_shares_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  CONSTRAINT check_shares_amount_cents CHECK (amount_cents >= 0 AND typeof(amount_cents) = 'integer')
);

CREATE INDEX IF NOT EXISTS idx_shares_bill ON bill_shares(bill_id);
CREATE INDEX IF NOT EXISTS idx_shares_member ON bill_shares(member_id);

-- 5. Payments Table (Idempotency and Payment Records)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  CONSTRAINT fk_payments_share FOREIGN KEY (share_id) REFERENCES bill_shares(id) ON DELETE CASCADE,
  CONSTRAINT uq_payments_share UNIQUE (share_id),
  CONSTRAINT uq_payments_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payments_share ON payments(share_id);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency_key ON payments(idempotency_key);
