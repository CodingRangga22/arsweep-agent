-- Conversation history per user
CREATE TABLE IF NOT EXISTS agent_conversations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id
  ON agent_conversations (user_id, created_at DESC);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON agent_conversations
  FOR ALL USING (auth.role() = 'service_role');

-- Sweep history
CREATE TABLE IF NOT EXISTS sweep_history (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address   TEXT NOT NULL,
  tokens_swept     INTEGER DEFAULT 0,
  accounts_closed  INTEGER DEFAULT 0,
  sol_recovered    NUMERIC(18, 9) DEFAULT 0,
  mode             TEXT NOT NULL,
  tx_signatures    TEXT[],
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sweep_history_wallet
  ON sweep_history (wallet_address, created_at DESC);

-- Aggregate stats per wallet
CREATE TABLE IF NOT EXISTS sweep_stats (
  wallet_address        TEXT PRIMARY KEY,
  total_sweeps          INTEGER DEFAULT 0,
  total_sol_recovered   NUMERIC(18, 9) DEFAULT 0,
  total_tokens_swept    INTEGER DEFAULT 0,
  total_accounts_closed INTEGER DEFAULT 0,
  last_sweep_at         TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Function to update stats after sweep
CREATE OR REPLACE FUNCTION update_sweep_stats(
  p_wallet   TEXT,
  p_sol      NUMERIC,
  p_tokens   INTEGER,
  p_accounts INTEGER
) RETURNS VOID AS $$
BEGIN
  INSERT INTO sweep_stats (
    wallet_address, total_sweeps, total_sol_recovered,
    total_tokens_swept, total_accounts_closed, last_sweep_at
  )
  VALUES (p_wallet, 1, p_sol, p_tokens, p_accounts, NOW())
  ON CONFLICT (wallet_address) DO UPDATE SET
    total_sweeps          = sweep_stats.total_sweeps + 1,
    total_sol_recovered   = sweep_stats.total_sol_recovered + p_sol,
    total_tokens_swept    = sweep_stats.total_tokens_swept + p_tokens,
    total_accounts_closed = sweep_stats.total_accounts_closed + p_accounts,
    last_sweep_at         = NOW(),
    updated_at            = NOW();
END;
$$ LANGUAGE plpgsql;
