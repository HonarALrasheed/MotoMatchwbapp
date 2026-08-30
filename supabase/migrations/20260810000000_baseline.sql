-- ══════════════════════════════════════════════════════════════════
--  BASELINE — Ist-Zustand der Produktionsdatenbank
--
--  ⚠  DIESE DATEI IST NOCH EIN PLATZHALTER.
--
--  Sie wird ERSETZT durch den Abzug der Produktionsdatenbank:
--
--    supabase link --project-ref <deine-project-ref>
--    supabase db dump --linked --schema public \
--      -f supabase/migrations/20260810000000_baseline.sql
--
--  Danach einmalig als "bereits eingespielt" markieren, sonst versucht
--  die CLI, den Dump gegen die Produktion zu fahren:
--
--    supabase migration repair --status applied 20260810000000
--
--  Der Zeitstempel im Dateinamen (2026-08-10) entspricht dem ersten
--  Commit, der supabase/schema.sql angelegt hat, und liegt damit vor
--  allen nachfolgenden Migrationen.
--
--  Warum ein Platzhalter statt einer fehlenden Datei: eine leere Stelle
--  faellt niemandem auf. Der RAISE unten schon — er bricht ein
--  `supabase db push` mit einer klaren Meldung ab, statt die folgenden
--  Migrationen gegen eine Datenbank laufen zu lassen, von der niemand
--  weiss, was in ihr steht. Genau dieser Zustand war der Ausgangspunkt
--  der ganzen Umstellung.
-- ══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE EXCEPTION
    'Baseline nicht befuellt: erst "supabase db dump --linked --schema public -f supabase/migrations/20260810000000_baseline.sql" ausfuehren (siehe supabase/migrations/README.md).';
END $$;
