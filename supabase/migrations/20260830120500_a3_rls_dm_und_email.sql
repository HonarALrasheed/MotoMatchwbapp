-- ══════════════════════════════════════════════════════════════════
--  A3 — RLS haerten, Teil 1: E-Mail-Preisgabe und fremde DMs
--  (Audit-Befunde 3.1 / 3.2, Backlog #6, #7)
-- ══════════════════════════════════════════════════════════════════

-- ── email_for_username(): exakter statt Pattern-Vergleich ─────────
-- Vorher `WHERE p.username ILIKE uname`. ILIKE deutet % als Platzhalter:
-- ein anonymer RPC-Aufruf mit '%' lieferte eine fremde E-Mail-Adresse,
-- mit 'a%', 'b%' … liess sich der Bestand abklappern. Der Anon-Key steht
-- im Client-Bundle, der Aufruf war also fuer jeden moeglich.
--
-- Das GRANT an anon BLEIBT: der Login-Bildschirm braucht die Funktion,
-- bevor jemand angemeldet ist. Der Schutz liegt im exakten Match.
CREATE OR REPLACE FUNCTION public.email_for_username(uname text)
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
REVOKE ALL ON FUNCTION public.email_for_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO anon, authenticated;

-- ── msg_insert_dm: pruefen WOHIN, nicht nur WER ───────────────────
-- Vorher: WITH CHECK (author_id = auth.uid() AND dm_thread IS NOT NULL).
-- dm_thread ist ein freier String — jeder Angemeldete konnte in jeden
-- fremden Thread schreiben. Damit waren zugleich Blockieren und
-- dm_policy wirkungslos, beides stand nur im Browser.
DROP POLICY IF EXISTS "msg_insert_dm" ON public.messages;
CREATE POLICY "msg_insert_dm" ON public.messages FOR INSERT
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
    --     '<A>:<B>:<angreifer>' die Pruefung (1) (endet auf ':<angreifer>'),
    --     und _loadDMs()/_onMessageRow() lesen per split(':')[0] und [1] —
    --     die Zeile landet in der Konversation von A und B. api/push-trigger.js
    --     macht denselben Split und wuerde die Push-Nachricht mit zustellen.
    AND dm_thread ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    -- (3) Empfaenger darf den Absender nicht blockiert haben. Der Empfaenger
    --     ist der Teilnehmer, der nicht auth.uid() ist — statt den String zu
    --     zerlegen wird geprueft: niemand, der mich blockiert hat, ist in
    --     diesem Thread.
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE b.blocked = auth.uid()
        AND (messages.dm_thread LIKE b.blocker::text || ':%'
          OR messages.dm_thread LIKE '%:' || b.blocker::text)
    )
  );

-- ── msg_update: eigenes WITH CHECK ────────────────────────────────
-- Ohne eigenes WITH CHECK setzt Postgres die USING-Bedingung auch fuer
-- die NEUE Zeile ein — die ist bei einer DM aber schon mit
-- author_id = auth.uid() erfuellt, egal welcher dm_thread danach
-- drinsteht. Ein Autor konnte seine Nachricht nachtraeglich in einen
-- fremden Thread umhaengen.
DROP POLICY IF EXISTS "msg_update" ON public.messages;
CREATE POLICY "msg_update" ON public.messages FOR UPDATE
  USING (author_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.channels c
    JOIN public.group_members gm ON gm.group_id = c.group_id AND gm.user_id = auth.uid()
    WHERE c.id = messages.channel_id AND gm.role IN ('owner','mod')
  ))
  WITH CHECK (
    -- Kanalnachrichten: unveraendert (USING greift), damit Mods fremde
    -- Nachrichten weiter moderieren koennen.
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
