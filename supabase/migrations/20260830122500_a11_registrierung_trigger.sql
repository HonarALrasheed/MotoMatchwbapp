-- ══════════════════════════════════════════════════════════════════
--  A11 — Registrierung haerten: Profilanlage per DB-Trigger
--
--  Bisher legte der Client die profiles-Zeile direkt nach signUp() an.
--  Das funktioniert nur, solange "Confirm email" AUS ist: ohne
--  Bestaetigung liefert signUp() keine Session, auth.uid() ist dann NULL,
--  und profiles_insert blockt den INSERT — der Nutzer saehe eine rohe
--  englische Postgres-Meldung.
--
--  Der Trigger loest das: er laeuft als SECURITY DEFINER in derselben
--  Transaktion wie der INSERT auf auth.users — unabhaengig von Session
--  und RLS. Er greift fuer JEDEN neuen Auth-User: E-Mail wie Google-OAuth.
--
--  WICHTIG: Schlaegt diese Funktion fehl, schlaegt die GESAMTE
--  Registrierung fehl ("Database error saving new user"). Deshalb faengt
--  die Schleife Kollisionen auf profiles.username ab, statt den
--  Unique-Constraint durchschlagen zu lassen.
-- ══════════════════════════════════════════════════════════════════

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
  -- Gleiches Zeichenraster wie im Client (siehe _usernameBase in src/js/auth.js).
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
        -- 8 + 1 + 32 = 41 Zeichen. Relevant fuer den Laengen-Check auf
        -- profiles.username (siehe a15_laengen_constraints).
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
