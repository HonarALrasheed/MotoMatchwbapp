-- ══════════════════════════════════════════════════════════════════
--  A15 — Fehlende Indizes
--
--  Vor dieser Migration hatte das Schema drei Indizes ausserhalb der
--  Primaer-/Unique-Schluessel: messages(channel_id, created_at),
--  messages(dm_thread, created_at) und api_usage(day).
--
--  CREATE INDEX IF NOT EXISTS ist idempotent. Bewusst ohne CONCURRENTLY:
--  das kann nicht in einer Transaktion laufen, die Supabase-CLI packt
--  aber jede Migration in eine. Bei der aktuellen Datenmenge (Beta) ist
--  die kurze Schreibsperre irrelevant. Sollte eine Tabelle spaeter
--  Millionen Zeilen haben, den betreffenden Index einmalig von Hand mit
--  CONCURRENTLY anlegen — dann findet IF NOT EXISTS ihn hier schon vor.
-- ══════════════════════════════════════════════════════════════════

-- friendships: UNIQUE (user_a, user_b) deckt user_a bereits ab (fuehrende
-- Spalte eines mehrspaltigen Index). Nur user_b fehlt.
CREATE INDEX IF NOT EXISTS friendships_user_b_idx        ON public.friendships (user_b);

-- friend_requests: UNIQUE (from_user, to_user) deckt from_user ab.
CREATE INDEX IF NOT EXISTS friend_requests_to_user_idx   ON public.friend_requests (to_user);

-- group_members: UNIQUE (group_id, user_id) deckt group_id ab.
-- user_id wird bei jedem Ladevorgang und in jeder Gruppen-Policy gefiltert.
CREATE INDEX IF NOT EXISTS group_members_user_id_idx     ON public.group_members (user_id);

-- push_subscriptions: UNIQUE steht auf endpoint, nicht auf user_id.
-- Diese Spalte wird bei JEDER Nachricht abgefragt
-- (api/push-trigger.js:105 und 148) — der wichtigste Index in dieser Datei.
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions (user_id);

-- channels / voice_rooms: nur der Primaerschluessel auf id, group_id ist
-- die Spalte, ueber die tatsaechlich gefiltert wird.
CREATE INDEX IF NOT EXISTS channels_group_id_idx         ON public.channels (group_id);
CREATE INDEX IF NOT EXISTS voice_rooms_group_id_idx      ON public.voice_rooms (group_id);

-- group_rsvps: PRIMARY KEY (group_id, user_id) deckt group_id ab.
CREATE INDEX IF NOT EXISTS group_rsvps_user_id_idx       ON public.group_rsvps (user_id);

-- messages: gebraucht von export_my_data() und vom ON-DELETE-CASCADE
-- beim Loeschen eines Kontos.
CREATE INDEX IF NOT EXISTS messages_author_id_idx        ON public.messages (author_id);

-- ── Bewusst NICHT angelegt ────────────────────────────────────────
-- Drei der urspruenglich genannten elf Spalten sind bereits indiziert,
-- weil sie die FUEHRENDE Spalte eines bestehenden Unique-Index sind.
-- Postgres nutzt einen mehrspaltigen B-Tree auch fuer Abfragen, die nur
-- die erste Spalte filtern — ein eigener Index waere reiner Schreib- und
-- Speicher-Aufwand ohne Lesegewinn:
--
--   friendships(user_a) → friendships_user_a_user_b_key
--   blocks(blocker)     → blocks_blocker_blocked_key
--   ignores(ignorer)    → ignores_ignorer_ignored_key
--
-- Nachpruefbar mit:
--   EXPLAIN SELECT * FROM friendships WHERE user_a = gen_random_uuid();
