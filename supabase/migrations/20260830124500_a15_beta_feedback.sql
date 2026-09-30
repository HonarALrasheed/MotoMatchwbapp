-- ══════════════════════════════════════════════════════════════════
--  A15 — beta_feedback: kein anonymes Einfuegen mehr
--
--  Vorher:
--    CREATE POLICY "bf_insert_auth" ON beta_feedback FOR INSERT
--      WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
--
--  Der zweite Zweig gab der Rolle `anon` ein unbegrenztes INSERT-Recht.
--  Der Anon-Key steht im Client-Bundle, es gibt kein Rate-Limit und kein
--  CAPTCHA: ein Skript konnte die Tabelle in Ruhe vollschreiben. Und weil
--  beta_feedback bewusst KEINE SELECT-Policy hat, faellt das erst im
--  Dashboard auf.
--
--  Nachher: nur angemeldete Nutzer, nur mit der eigenen uid.
--  `user_id = auth.uid()` schliesst NULL automatisch aus (NULL = NULL
--  ergibt NULL, nicht true), das explizite TO authenticated macht die
--  Absicht sichtbar.
--
--  ⚠  CLIENT-SEITE: src/js/feedback.js schickte fuer Gaeste und
--  Abgemeldete user_id = null. Dieser Aufruf laeuft ab jetzt in einen
--  RLS-Fehler. Die Funktion submitFeedback() faengt das im selben
--  Arbeitsschritt vorher ab und sagt es auf Deutsch, statt die rohe
--  PostgREST-Meldung anzuzeigen. Beide Teile gehoeren zusammen.
-- ══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "bf_insert_auth" ON public.beta_feedback;
CREATE POLICY "bf_insert_auth" ON public.beta_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── beta_feedback.text ≤ 4000 ─────────────────────────────────────
-- UI heute: MAX_LEN = 2000 (feedback.js:16). 4000 laesst Luft und macht
-- aus dem Feld trotzdem keinen Ablageort.
-- NOT VALID wie bei den uebrigen Constraints — Pruef-SELECT:
--
--   SELECT id, user_id, length(text) AS laenge, left(text, 60) AS anfang
--     FROM beta_feedback WHERE length(text) > 4000 ORDER BY laenge DESC;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'beta_feedback_text_len' AND conrelid = 'public.beta_feedback'::regclass) THEN
    ALTER TABLE public.beta_feedback ADD CONSTRAINT beta_feedback_text_len
      CHECK (length(text) <= 4000) NOT VALID;
  END IF;
END $$;
