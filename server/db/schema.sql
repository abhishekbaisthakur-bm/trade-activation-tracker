-- Trade Activation Tracker : PostgreSQL schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  employee_id    TEXT NOT NULL UNIQUE,
  mobile         TEXT UNIQUE,
  email          TEXT UNIQUE,
  role           TEXT NOT NULL CHECK (role IN ('field', 'team_lead', 'city_head', 'regional_head', 'admin')),
  region         TEXT,
  assigned_state TEXT,
  assigned_city  TEXT,
  assigned_area  TEXT,
  manager_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  password_hash  TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  rio_id      TEXT UNIQUE,
  party_alt_code TEXT,
  address     TEXT,
  state       TEXT,
  city        TEXT,
  area        TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS pharmacies_city_idx ON pharmacies (city, area);

-- Pharmacy names are not identifiers. Different retailers may legitimately use
-- the same trading name in the same city; RIO ID is the master-list identifier.
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS pharmacies_city_name_key;
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS pharmacies_city_name_key_key;

ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS rio_id TEXT;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS party_alt_code TEXT;
ALTER TABLE pharmacies ALTER COLUMN state DROP NOT NULL;
ALTER TABLE pharmacies ALTER COLUMN city DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pharmacies_rio_id_key ON pharmacies (rio_id) WHERE rio_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS planned_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state         TEXT NOT NULL,
  city          TEXT NOT NULL,
  area          TEXT NOT NULL,
  planned_shops INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (state, city, area)
);

CREATE TABLE IF NOT EXISTS planned_assets (
  plan_id    UUID NOT NULL REFERENCES planned_targets(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_id, asset_type)
);

CREATE TABLE IF NOT EXISTS activations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL UNIQUE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pharmacy_id        UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  pharmacy_name      TEXT NOT NULL,
  party_code         TEXT,
  party_code_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_party_code_of UUID REFERENCES activations(id) ON DELETE SET NULL,
  shop_key           TEXT NOT NULL,
  address            TEXT,
  state              TEXT NOT NULL,
  city               TEXT NOT NULL,
  area               TEXT,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  latitude           DOUBLE PRECISION NOT NULL,
  longitude          DOUBLE PRECISION NOT NULL,
  gps_accuracy       INTEGER,
  gps_source         TEXT NOT NULL DEFAULT 'device',
  geo_address        TEXT,
  status             TEXT NOT NULL DEFAULT 'Submitted'
                     CHECK (status IN ('Submitted', 'Pending Review', 'Approved', 'Rejected')),
  duplicate_override BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        TIMESTAMPTZ,
  review_note        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activations_when_idx ON activations (occurred_at DESC);
CREATE INDEX IF NOT EXISTS activations_geo_idx ON activations (state, city, area);
CREATE INDEX IF NOT EXISTS activations_user_idx ON activations (user_id, occurred_at DESC);
-- One activation per shop per user per day unless the manager allows a repeat visit.
CREATE UNIQUE INDEX IF NOT EXISTS activations_no_duplicate_idx
  ON activations (user_id, shop_key, occurred_on)
  WHERE duplicate_override = FALSE;

CREATE TABLE IF NOT EXISTS activation_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id UUID NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
  asset_type    TEXT NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (activation_id, asset_type)
);
CREATE INDEX IF NOT EXISTS activation_assets_type_idx ON activation_assets (asset_type);

CREATE TABLE IF NOT EXISTS photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id UUID NOT NULL REFERENCES activations(id) ON DELETE CASCADE,
  asset_type    TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  storage_driver TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  captured_at   TIMESTAMPTZ,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activation_id, asset_type)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_when_idx ON audit_log (created_at DESC);

-- Manager assignment migration for existing databases.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_area TEXT;

ALTER TABLE pharmacies ALTER COLUMN area DROP NOT NULL;
ALTER TABLE activations ALTER COLUMN area DROP NOT NULL;
ALTER TABLE activations ADD COLUMN IF NOT EXISTS party_code TEXT;
ALTER TABLE activations ADD COLUMN IF NOT EXISTS party_code_duplicate BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE activations ADD COLUMN IF NOT EXISTS duplicate_party_code_of UUID REFERENCES activations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS activations_party_code_idx ON activations (lower(trim(party_code))) WHERE party_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_manager_idx ON users (manager_id);

-- Role migration for existing databases.
DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  UPDATE users
  SET role = CASE WHEN assigned_city IS NULL THEN 'regional_head' ELSE 'city_head' END,
      region = COALESCE(region, assigned_state)
  WHERE role = 'manager';
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('field','team_lead','city_head','regional_head','admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE users child
SET region = COALESCE(child.region, parent.region, parent.assigned_state)
FROM users parent
WHERE child.manager_id = parent.id AND child.region IS NULL;

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('user_create','user_deactivate','target_change')),
  payload JSONB NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON approval_requests (status, created_at DESC);

-- Field users are now created directly by their manager. Remove any initial
-- passwords retained by the legacy approval flow and close requests that can
-- no longer be fulfilled after redaction.
UPDATE approval_requests
SET payload = payload - 'password',
    status = CASE WHEN type = 'user_create' AND status = 'pending' THEN 'rejected' ELSE status END,
    reviewed_at = CASE WHEN type = 'user_create' AND status = 'pending' THEN now() ELSE reviewed_at END,
    review_note = CASE
      WHEN type = 'user_create' AND status = 'pending'
        THEN COALESCE(review_note, 'Closed automatically after field-user creation moved to the manager workflow.')
      ELSE review_note
    END
WHERE payload ? 'password';

CREATE TABLE IF NOT EXISTS master_data_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id UUID NOT NULL UNIQUE REFERENCES activations(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS master_data_reviews_manager_idx
  ON master_data_reviews (manager_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS target_history (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID REFERENCES planned_targets(id) ON DELETE SET NULL,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  area TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('base','revision','addition')),
  old_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
