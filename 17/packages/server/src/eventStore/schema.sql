CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  cell_id TEXT,
  user_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  vector_clock_json TEXT NOT NULL,
  sequence INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_doc_id ON events(doc_id);
CREATE INDEX IF NOT EXISTS idx_events_cell_id ON events(cell_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_doc_sequence ON events(doc_id, sequence);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON documents(owner_id);

CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  name TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sheets_doc_id ON sheets(doc_id);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_permissions_doc_id ON permissions(doc_id);
CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON permissions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_doc_user ON permissions(doc_id, user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_doc_id ON snapshots(doc_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_doc_version ON snapshots(doc_id, version DESC);
