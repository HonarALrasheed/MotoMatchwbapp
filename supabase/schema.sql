-- ══════════════════════════════════════════════════════════════════
--  MotoMatch — Supabase-Schema
--  Dieses Skript im Supabase-Dashboard unter SQL-Editor ausführen.
--  Reihenfolge beachten (Fremdschlüssel).
-- ══════════════════════════════════════════════════════════════════

-- ── Profiles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      text UNIQUE NOT NULL,
  display_name  text,
  bio           text DEFAULT 'Motorradfahrer · MotoMatch 🏍',
  status_text   text,
  avatar_color  text,
  avatar        text,                  -- Profilbild als Data-URL (base64), analog zum localStorage-Offline-Modus
  show_bike     boolean DEFAULT false,
  bike_text     text,
  dm_policy     text DEFAULT 'all',     -- 'all' | 'friends'
  show_online   boolean DEFAULT true,
  notif_sounds  boolean DEFAULT true,
  notif_desktop boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select"  ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert"  ON profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update"  ON profiles FOR UPDATE USING (id = auth.uid());

-- Migration für bereits bestehende Datenbanken (obiges CREATE TABLE ist dort ein No-Op,
-- da die Tabelle schon existiert) — einmalig im SQL-Editor ausführen:
-- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar text;

-- ── Friendships ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id      bigserial PRIMARY KEY,
  user_a  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_b  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "friendships_select" ON friendships FOR SELECT
  USING (user_a = auth.uid() OR user_b = auth.uid());
CREATE POLICY "friendships_insert" ON friendships FOR INSERT
  WITH CHECK (user_a = auth.uid() OR user_b = auth.uid());
CREATE POLICY "friendships_delete" ON friendships FOR DELETE
  USING (user_a = auth.uid() OR user_b = auth.uid());

-- ── Friend requests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friend_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (from_user, to_user)
);
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "freq_select" ON friend_requests FOR SELECT
  USING (from_user = auth.uid() OR to_user = auth.uid());
CREATE POLICY "freq_insert" ON friend_requests FOR INSERT
  WITH CHECK (from_user = auth.uid());
CREATE POLICY "freq_delete" ON friend_requests FOR DELETE
  USING (from_user = auth.uid() OR to_user = auth.uid());

-- ── Blocks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  id          bigserial PRIMARY KEY,
  blocker     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (blocker, blocked)
);
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blocks_select" ON blocks FOR SELECT
  USING (blocker = auth.uid() OR blocked = auth.uid());
CREATE POLICY "blocks_insert" ON blocks FOR INSERT WITH CHECK (blocker = auth.uid());
CREATE POLICY "blocks_delete" ON blocks FOR DELETE USING (blocker = auth.uid());

-- ── Ignores ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ignores (
  id          bigserial PRIMARY KEY,
  ignorer     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ignored     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (ignorer, ignored)
);
ALTER TABLE ignores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ignores_select" ON ignores FOR SELECT USING (ignorer = auth.uid());
CREATE POLICY "ignores_insert" ON ignores FOR INSERT WITH CHECK (ignorer = auth.uid());
CREATE POLICY "ignores_delete" ON ignores FOR DELETE USING (ignorer = auth.uid());

-- ── Groups ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  category      text NOT NULL DEFAULT 'gruppen',
  join_mode     text NOT NULL DEFAULT 'open',  -- 'open' | 'request' | 'invite'
  event_at      timestamptz,                   -- Termin der Tour (optional)
  meeting_point text,                          -- Treffpunkt-Text, max. 80 Zeichen im UI (optional)
  created_by    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "groups_select_public" ON groups FOR SELECT USING (true);
CREATE POLICY "groups_insert" ON groups FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "groups_update" ON groups FOR UPDATE
  USING (created_by = auth.uid() OR EXISTS (
    SELECT 1 FROM group_members WHERE group_id = groups.id AND user_id = auth.uid() AND role = 'mod'
  ));
CREATE POLICY "groups_delete" ON groups FOR DELETE USING (created_by = auth.uid());

-- Migration für bereits bestehende Datenbanken (obiges CREATE TABLE ist dort ein No-Op,
-- da die Tabelle schon existiert) — einmalig im SQL-Editor ausführen:
-- ALTER TABLE groups ADD COLUMN IF NOT EXISTS event_at timestamptz;
-- ALTER TABLE groups ADD COLUMN IF NOT EXISTS meeting_point text;

-- ── Group RSVPs ("Ich fahre mit" für Touren mit Termin) ────────────
CREATE TABLE IF NOT EXISTS group_rsvps (
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
ALTER TABLE group_rsvps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rsvp_select" ON group_rsvps FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM group_members WHERE group_id = group_rsvps.group_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM groups WHERE id = group_rsvps.group_id AND join_mode = 'open'
  ));
CREATE POLICY "rsvp_insert" ON group_rsvps FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "rsvp_delete" ON group_rsvps FOR DELETE USING (user_id = auth.uid());

-- ── Group members ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
  id        bigserial PRIMARY KEY,
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member',  -- 'owner' | 'mod' | 'member'
  joined_at timestamptz DEFAULT now(),
  UNIQUE (group_id, user_id)
);
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gm_select" ON group_members FOR SELECT USING (true);
CREATE POLICY "gm_insert" ON group_members FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "gm_insert_mod" ON group_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM group_members gm WHERE gm.group_id = group_members.group_id
    AND gm.user_id = auth.uid() AND gm.role IN ('owner','mod')
  ));
CREATE POLICY "gm_delete" ON group_members FOR DELETE
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM group_members gm WHERE gm.group_id = group_members.group_id
    AND gm.user_id = auth.uid() AND gm.role IN ('owner','mod')
  ));
CREATE POLICY "gm_update" ON group_members FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM group_members gm WHERE gm.group_id = group_members.group_id
    AND gm.user_id = auth.uid() AND gm.role IN ('owner','mod')
  ));

-- ── Channels ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name      text NOT NULL DEFAULT 'allgemein',
  position  int NOT NULL DEFAULT 0
);
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels_select" ON channels FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM group_members WHERE group_id = channels.group_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM groups WHERE id = channels.group_id AND join_mode = 'open'
  ));
CREATE POLICY "channels_insert" ON channels FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM group_members WHERE group_id = channels.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));
CREATE POLICY "channels_delete" ON channels FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM group_members WHERE group_id = channels.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));

-- ── Voice rooms (Sprachkanäle) ────────────────────────────────────
-- Nur Metadaten (Titel, Kapazität) werden persistiert. Wer gerade live im
-- Raum ist, läuft komplett über einen ephemeren Supabase-Realtime-Presence-
-- Channel (`voice:<room_id>`, siehe src/js/voice.js) — keine DB-Zeile nötig.
CREATE TABLE IF NOT EXISTS voice_rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title      text NOT NULL,
  capacity   int NOT NULL DEFAULT 4,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE voice_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vr_select" ON voice_rooms FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM group_members WHERE group_id = voice_rooms.group_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM groups WHERE id = voice_rooms.group_id AND join_mode = 'open'
  ));
CREATE POLICY "vr_insert" ON voice_rooms FOR INSERT
  WITH CHECK (created_by = auth.uid() AND EXISTS (
    SELECT 1 FROM group_members WHERE group_id = voice_rooms.group_id AND user_id = auth.uid()
  ));
CREATE POLICY "vr_delete" ON voice_rooms FOR DELETE
  USING (created_by = auth.uid() OR EXISTS (
    SELECT 1 FROM group_members WHERE group_id = voice_rooms.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));

-- ── Messages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid REFERENCES channels(id) ON DELETE CASCADE,
  dm_thread   text,          -- '<user_a_id>:<user_b_id>' (sorted, kleinste UUID zuerst)
  author_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  text        text NOT NULL,
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  reactions   jsonb DEFAULT '{}',
  mentions    uuid[] NOT NULL DEFAULT '{}',  -- @mentions (nur Gruppenkanäle), clientseitig aufgelöst — s. api/push-trigger.js für serverseitige Re-Validierung vor Push
  edited_at   timestamptz,
  created_at  timestamptz DEFAULT now(),
  CHECK ((channel_id IS NOT NULL) != (dm_thread IS NOT NULL))
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Gruppenkanal: nur Mitglieder
CREATE POLICY "msg_select_channel" ON messages FOR SELECT
  USING (
    channel_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM channels c
      JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = auth.uid()
      WHERE c.id = messages.channel_id
    )
  );
-- DM: nur Beteiligte
CREATE POLICY "msg_select_dm" ON messages FOR SELECT
  USING (
    dm_thread IS NOT NULL AND (
      dm_thread LIKE auth.uid()::text || ':%' OR
      dm_thread LIKE '%:' || auth.uid()::text
    )
  );
CREATE POLICY "msg_insert_channel" ON messages FOR INSERT
  WITH CHECK (
    author_id = auth.uid() AND channel_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM channels c
      JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = auth.uid()
      WHERE c.id = messages.channel_id
    )
  );
CREATE POLICY "msg_insert_dm" ON messages FOR INSERT
  WITH CHECK (author_id = auth.uid() AND dm_thread IS NOT NULL);
CREATE POLICY "msg_update" ON messages FOR UPDATE
  USING (author_id = auth.uid() OR EXISTS (
    SELECT 1 FROM channels c
    JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = auth.uid()
    WHERE c.id = messages.channel_id AND gm.role IN ('owner','mod')
  ));
CREATE POLICY "msg_delete" ON messages FOR DELETE
  USING (author_id = auth.uid() OR EXISTS (
    SELECT 1 FROM channels c
    JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = auth.uid()
    WHERE c.id = messages.channel_id AND gm.role IN ('owner','mod')
  ));
CREATE INDEX IF NOT EXISTS messages_channel_created ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS messages_dm_created ON messages(dm_thread, created_at);

-- Migration für bereits bestehende Datenbanken (obiges CREATE TABLE ist dort ein No-Op,
-- da die Tabelle schon existiert) — einmalig im SQL-Editor ausführen:
-- ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';

-- ── Group join requests ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_join_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  text        text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (group_id, from_user)
);
ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gjr_select" ON group_join_requests FOR SELECT
  USING (from_user = auth.uid() OR EXISTS (
    SELECT 1 FROM group_members WHERE group_id = group_join_requests.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));
CREATE POLICY "gjr_insert" ON group_join_requests FOR INSERT WITH CHECK (from_user = auth.uid());
CREATE POLICY "gjr_delete" ON group_join_requests FOR DELETE
  USING (from_user = auth.uid() OR EXISTS (
    SELECT 1 FROM group_members WHERE group_id = group_join_requests.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));

-- ── Invites ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invites (
  code        text PRIMARY KEY,
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at  timestamptz,
  max_uses    int,
  uses        int NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invites_select" ON invites FOR SELECT USING (true);
CREATE POLICY "invites_insert" ON invites FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM group_members WHERE group_id = invites.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));
CREATE POLICY "invites_update" ON invites FOR UPDATE USING (true);
CREATE POLICY "invites_delete" ON invites FOR DELETE
  USING (created_by = auth.uid() OR EXISTS (
    SELECT 1 FROM group_members WHERE group_id = invites.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));

-- ── Message reports ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  group_id    uuid REFERENCES groups(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE message_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mreports_insert" ON message_reports FOR INSERT WITH CHECK (reported_by = auth.uid());
CREATE POLICY "mreports_select" ON message_reports FOR SELECT
  USING (reported_by = auth.uid() OR EXISTS (
    SELECT 1 FROM group_members WHERE group_id = message_reports.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));

-- ── User reports ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reported    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      text,
  text        text,
  status      text DEFAULT 'open',
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ureports_insert" ON user_reports FOR INSERT WITH CHECK (from_user = auth.uid());
CREATE POLICY "ureports_select" ON user_reports FOR SELECT USING (from_user = auth.uid());

-- ── Group bans (separate from members) ───────────────────────────
CREATE TABLE IF NOT EXISTS group_bans (
  id        bigserial PRIMARY KEY,
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banned_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banned_at timestamptz DEFAULT now(),
  UNIQUE (group_id, user_id)
);
ALTER TABLE group_bans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gbans_select" ON group_bans FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM group_members WHERE group_id = group_bans.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));
CREATE POLICY "gbans_insert" ON group_bans FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM group_members WHERE group_id = group_bans.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));
CREATE POLICY "gbans_delete" ON group_bans FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM group_members WHERE group_id = group_bans.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));

-- ── Login per Benutzername ────────────────────────────────────────
-- profiles enthält keine E-Mail-Spalte (die liegt in auth.users, per RLS
-- nicht direkt abfragbar). Für den Login-Flow "Benutzername ODER E-Mail"
-- braucht das Frontend die zugehörige E-Mail zu einem Benutzernamen —
-- SECURITY DEFINER erlaubt genau diesen einen kontrollierten Lesezugriff.
CREATE OR REPLACE FUNCTION email_for_username(uname text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.email
  FROM auth.users au
  JOIN profiles p ON p.id = au.id
  WHERE p.username ILIKE uname
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION email_for_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION email_for_username(text) TO anon, authenticated;

-- ── Beta-Feedback ─────────────────────────────────────────────────
-- Niedrigschwelliger Kanal für Tester-Feedback (FAB rechts unten).
-- Kein SELECT-Policy: Feedback wird nur im Supabase-Dashboard gelesen
-- (Table Editor → beta_feedback → sort by created_at desc).
CREATE TABLE IF NOT EXISTS beta_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  text        text NOT NULL,
  page        text,
  user_agent  text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE beta_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bf_insert_auth" ON beta_feedback FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- ── Push-Subscriptions (Web Push) ───────────────────────────────────
-- Ein Browser/Gerät pro Zeile (endpoint ist pro Browser-Installation
-- eindeutig). api/push-trigger.js liest diese Tabelle per Service-Role
-- (umgeht RLS bewusst, da es für beliebige Empfänger nachschlagen muss),
-- der Client selbst greift nur über seine eigene RLS-Sicht zu.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_sub_select" ON push_subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "push_sub_insert" ON push_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_sub_delete" ON push_subscriptions FOR DELETE USING (user_id = auth.uid());

-- ── Notification-Mutes (serverseitige Sicht auf lokale Mutes) ───────
-- Spiegelt community.js' isMuted()-Logik (localStorage mm_comm_mutes_v1,
-- Keys: Gruppen-ID oder 'dm/<username>') serverseitig, damit
-- api/push-trigger.js gemutete Chats nicht anstößt. until = NULL heißt
-- für immer gemutet, sonst Zeitpunkt bis zu dem gemutet ist.
CREATE TABLE IF NOT EXISTS notification_mutes (
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mute_key  text NOT NULL,
  until     timestamptz,
  PRIMARY KEY (user_id, mute_key)
);
ALTER TABLE notification_mutes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_mutes_select" ON notification_mutes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notif_mutes_upsert" ON notification_mutes FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_mutes_update" ON notification_mutes FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "notif_mutes_delete" ON notification_mutes FOR DELETE USING (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════
--  Realtime aktivieren (einmalig im Supabase-Dashboard unter
--  Database → Replication → Tables):
--  Tabellen: messages, friend_requests, group_members
-- ══════════════════════════════════════════════════════════════════
