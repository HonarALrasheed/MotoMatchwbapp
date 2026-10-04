-- a17: Kennzeichnung von KI-Mitgliedern (Community-Crew). Vor dem Frontend-Deploy im SQL-Editor ausfuehren.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_ai boolean NOT NULL DEFAULT false;

-- Nutzer duerfen ihr eigenes is_ai nicht setzen; nur der Service-Key (Runner) darf das.
CREATE OR REPLACE FUNCTION profiles_is_ai_schutz() RETURNS trigger AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN NEW.is_ai := false;
    ELSE NEW.is_ai := OLD.is_ai; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_is_ai_schutz ON profiles;
CREATE TRIGGER profiles_is_ai_schutz BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_is_ai_schutz();
