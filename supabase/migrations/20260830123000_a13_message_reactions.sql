-- ══════════════════════════════════════════════════════════════════
--  A13 — Reaktionen in eine eigene Tabelle
--
--  WARUM: Reaktionen liefen frueher als
--    UPDATE messages SET reactions = <ganzes Objekt> WHERE id = …
--  Die Policy msg_update erlaubt UPDATE aber nur dem Autor oder einem Mod.
--  Ein normales Mitglied, das auf eine FREMDE Nachricht reagierte, traf
--  damit null Zeilen. PostgREST meldet null getroffene Zeilen nicht als
--  Fehler — die Reaktion erschien lokal und war nach dem Neuladen weg.
--  Auf eigene Nachrichten funktionierte es, was die Fehlersuche
--  zusaetzlich in die Irre fuehrte.
--
--  Zweiter Grund: zwei gleichzeitige Reaktionen schrieben beide das
--  komplette reactions-Objekt, die spaetere ueberschrieb die fruehere.
--  Mit einer Zeile je Reaktion kann das nicht mehr passieren.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id)  ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- Lesen: genau das, was auch als Nachricht lesbar ist. Der EXISTS-Unterausdruck
-- laeuft mit den Rechten des Aufrufers, es greifen darin also die
-- messages-Policies (msg_select_channel / msg_select_dm). Die Sichtbarkeitsregel
-- steht damit weiterhin an genau EINER Stelle und kann nicht auseinanderlaufen.
DROP POLICY IF EXISTS "mreact_select" ON public.message_reactions;
CREATE POLICY "mreact_select" ON public.message_reactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id));

-- Anlegen: nur die EIGENE Reaktion, und nur an einer Nachricht, die man sehen
-- darf. Ohne den zweiten Teil koennte man Reaktionen an beliebige uuids haengen.
DROP POLICY IF EXISTS "mreact_insert" ON public.message_reactions;
CREATE POLICY "mreact_insert" ON public.message_reactions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id)
  );

-- Loeschen: nur die eigene Reaktion. Bewusst ohne Mod-Ausnahme — eine Reaktion
-- ist kein Nachrichtentext, es gibt nichts zu moderieren.
DROP POLICY IF EXISTS "mreact_delete" ON public.message_reactions;
CREATE POLICY "mreact_delete" ON public.message_reactions FOR DELETE
  USING (user_id = auth.uid());

-- Bewusst KEINE UPDATE-Policy: eine Reaktion wird angelegt oder geloescht,
-- nie geaendert. Ein Umschalten ist DELETE + INSERT.
--
-- Kein zusaetzlicher Index auf message_id noetig: der Primaerschluessel
-- (message_id, user_id, emoji) hat message_id als fuehrende Spalte.
--
-- Kein REPLICA IDENTITY FULL noetig: bei DELETE liefert Postgres die
-- Primaerschluessel-Spalten mit, und das sind hier genau die drei, die der
-- Client zum Nachziehen braucht (_handleReactionChange in community-api.js).

-- ── Bestandsdaten uebernehmen ─────────────────────────────────────
-- Form der alten Spalte: { "<emoji>": ["<username>", …] } — Usernamen,
-- keine uuids; der Join ueber profiles.username macht daraus user_id.
-- Reaktionen geloeschter Konten fallen dabei weg (kein Treffer im Join).
--
-- Diese Uebernahme ist die Voraussetzung dafuer, dass _mapReactions() in
-- community-api.js NICHT mehr auf die alte jsonb-Spalte zurueckfaellt.
-- Idempotent (ON CONFLICT DO NOTHING), darf also beliebig oft laufen.
--
-- messages.reactions bleibt bewusst stehen (kein DROP COLUMN): sie ist ab
-- hier nur noch Altbestand und wird weder gelesen noch geschrieben.
--
-- Die CASE-Ausdruecke sind kein Zierrat: jsonb_each() wirft einen harten
-- Fehler, wenn der Wert kein Objekt ist ("cannot call jsonb_each on a
-- non-object"), und ein WHERE weiter unten schuetzt davor NICHT zuverlaessig —
-- ob es vor dem Funktionsaufruf greift, entscheidet der Planer. Eine einzige
-- Zeile mit reactions = 'null'::jsonb wuerde die Migration sonst umwerfen.
--
-- Der DO-Block haelt die Uebernahme davon ab, ueber eine Datenbank zu
-- stolpern, in der es messages.reactions gar nicht (mehr) gibt.
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'reactions'
  ) THEN
    RAISE NOTICE 'messages.reactions existiert nicht — nichts zu uebernehmen.';
    RETURN;
  END IF;

  INSERT INTO public.message_reactions (message_id, user_id, emoji)
  SELECT m.id, p.id, r.emoji
    FROM public.messages m
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(m.reactions) = 'object' THEN m.reactions
           ELSE '{}'::jsonb END
    ) AS r(emoji, users)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(r.users) = 'array' THEN r.users
           ELSE '[]'::jsonb END
    ) AS u(username)
    JOIN public.profiles p ON p.username = u.username
  ON CONFLICT DO NOTHING;
END $mig$;

-- ── Realtime ──────────────────────────────────────────────────────
-- Bisher ein Haken im Dashboard (Database → Replication) und damit genau
-- die Sorte undokumentierter Handgriff, die diese Migrationen abschaffen.
-- message_reactions MUSS dabei sein: Reaktionen laufen nicht mehr als
-- UPDATE auf messages, sondern als INSERT/DELETE hier. Ohne die
-- Publikation sieht man fremde Reaktionen erst nach einem Neuladen.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE WARNING 'Publikation supabase_realtime fehlt — Realtime bitte im Dashboard pruefen.';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['messages','friend_requests','group_members','message_reactions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Keine Rechte an supabase_realtime — Tabellen bitte im Dashboard unter Database → Replication aktivieren.';
END $$;
