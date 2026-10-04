-- a18: Standort teilen ("Wo ist" für Freunde, Öffentlich für alle).
-- Im Supabase-SQL-Editor ausführen. Mehrfach ausführbar.
--
-- Jeder hat höchstens eine Zeile: seine letzte Position. Geteilt wird nur,
-- wer es in der Karte selbst einschaltet (Standard: aus). Ausschalten löscht
-- die Zeile. Freunde sehen die genaue Position, alle anderen nur über
-- oeffentliche_standorte() und nur auf ~1 km gerundet. Wer in verborgen_vor
-- steht, sieht die Position gar nicht.

CREATE TABLE IF NOT EXISTS standorte (
  user_id      uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  lat          double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  tempo        real CHECK (tempo IS NULL OR tempo BETWEEN 0 AND 400),  -- km/h
  unterwegs    boolean NOT NULL DEFAULT false,
  sichtbar     text NOT NULL DEFAULT 'freunde' CHECK (sichtbar IN ('freunde', 'oeffentlich')),
  aktualisiert timestamptz NOT NULL DEFAULT now()
);
-- Vor einzelnen Freunden verbergen (uids, die mich nicht sehen dürfen)
ALTER TABLE standorte ADD COLUMN IF NOT EXISTS verborgen_vor uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE standorte DROP CONSTRAINT IF EXISTS standorte_verborgen_max;
ALTER TABLE standorte ADD CONSTRAINT standorte_verborgen_max CHECK (cardinality(verborgen_vor) <= 500);

CREATE INDEX IF NOT EXISTS standorte_oeffentlich_idx ON standorte (aktualisiert) WHERE sichtbar = 'oeffentlich';

ALTER TABLE standorte ENABLE ROW LEVEL SECURITY;

-- Eigene Zeile: lesen, anlegen, ändern, löschen
DROP POLICY IF EXISTS "standorte_eigen" ON standorte;
CREATE POLICY "standorte_eigen" ON standorte FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Freunde: genaue Position, höchstens 24 h alt
DROP POLICY IF EXISTS "standorte_freunde" ON standorte;
CREATE POLICY "standorte_freunde" ON standorte FOR SELECT USING (
  aktualisiert > now() - interval '24 hours'
  AND NOT (auth.uid() = ANY (verborgen_vor))
  AND EXISTS (
    SELECT 1 FROM friendships f
     WHERE (f.user_a = auth.uid() AND f.user_b = standorte.user_id)
        OR (f.user_b = auth.uid() AND f.user_a = standorte.user_id)
  )
);

-- Zeitstempel setzt der Server, nicht der Client
CREATE OR REPLACE FUNCTION standorte_zeit() RETURNS trigger AS $$
BEGIN
  NEW.aktualisiert := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS standorte_zeit ON standorte;
CREATE TRIGGER standorte_zeit BEFORE INSERT OR UPDATE ON standorte
  FOR EACH ROW EXECUTE FUNCTION standorte_zeit();

-- Öffentlich: nur angemeldete Nutzer, nur die letzten 30 min, gerundet auf
-- 0,01° (~1 km), ohne Gesperrte in beide Richtungen, höchstens 300 Treffer.
CREATE OR REPLACE FUNCTION oeffentliche_standorte(s double precision, w double precision, n double precision, o double precision)
RETURNS TABLE (username text, display_name text, avatar_color text, lat double precision, lng double precision, unterwegs boolean, aktualisiert timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.username, p.display_name, p.avatar_color,
         round(st.lat::numeric, 2)::double precision,
         round(st.lng::numeric, 2)::double precision,
         st.unterwegs,
         date_trunc('minute', st.aktualisiert)
    FROM standorte st
    JOIN profiles p ON p.id = st.user_id
   WHERE auth.uid() IS NOT NULL
     AND st.user_id <> auth.uid()
     AND st.sichtbar = 'oeffentlich'
     AND st.aktualisiert > now() - interval '30 minutes'
     AND st.lat BETWEEN s AND n
     AND st.lng BETWEEN w AND o
     AND NOT (auth.uid() = ANY (st.verborgen_vor))
     AND NOT EXISTS (
       SELECT 1 FROM blocks b
        WHERE (b.blocker = auth.uid() AND b.blocked = st.user_id)
           OR (b.blocker = st.user_id AND b.blocked = auth.uid())
     )
   ORDER BY st.aktualisiert DESC
   LIMIT 300;
$$;
REVOKE ALL ON FUNCTION oeffentliche_standorte(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION oeffentliche_standorte(double precision, double precision, double precision, double precision) TO authenticated;

-- Alte Positionen aufräumen (läuft bei jedem Schreiben mit, kein Cron nötig)
CREATE OR REPLACE FUNCTION standorte_aufraeumen() RETURNS trigger AS $$
BEGIN
  DELETE FROM standorte WHERE aktualisiert < now() - interval '7 days';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS standorte_aufraeumen ON standorte;
CREATE TRIGGER standorte_aufraeumen AFTER INSERT ON standorte
  FOR EACH STATEMENT EXECUTE FUNCTION standorte_aufraeumen();
