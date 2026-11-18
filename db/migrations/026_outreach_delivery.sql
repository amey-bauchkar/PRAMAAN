-- Real delivery tracking for bulk mail: a message is 'sent' only after the mail server accepted it.
ALTER TABLE outreach_messages ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE outreach_messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE outreach_messages ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
