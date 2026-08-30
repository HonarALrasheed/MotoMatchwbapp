-- ══════════════════════════════════════════════════════════════════
--  A15 — Laengen- und Formatgrenzen fuer Textfelder
--
--  Bisher hatte kein Textfeld eine Obergrenze. `text` in Postgres ist
--  unbegrenzt (bis ~1 GB je Wert) — ein einzelner Nutzer konnte die
--  Datenbank vollschreiben, ohne eine einzige Regel zu verletzen.
--
--  ⚠  VOR DEM EINSPIELEN EIN FRISCHES BACKUP ZIEHEN.
--
--  ALLE Constraints hier werden als NOT VALID angelegt:
--    · neue und geaenderte Zeilen werden ab sofort geprueft
--    · bestehende Zeilen NICHT — diese Migration kann also nicht an
--      Altbestand scheitern und hinterlaesst keinen halben Zustand
--  Scharf gestellt werden sie in
--  20260830131000_a15_constraints_validieren.sql, nachdem die dortigen
--  Pruef-SELECTs leer zurueckkommen.
--
--  Die DO-Bloecke statt DROP+ADD: existiert ein Constraint schon und ist
--  bereits validiert, wuerde ein DROP+ADD-NOT-VALID es entschaerfen.
-- ══════════════════════════════════════════════════════════════════

-- ── messages.text ≤ 4000 ──────────────────────────────────────────
-- Das Eingabefeld (#mmc-compose-input, community.js) hatte bis eben GAR
-- keine Grenze — 4000 ist deshalb keine Uebernahme aus dem UI, sondern
-- eine gesetzte Grenze; das maxlength im Textfeld ist im selben Zug
-- nachgezogen worden, damit ein zu langer Einfuegevorgang eine deutsche
-- Meldung ergibt und keinen rohen Postgres-Fehler.
-- KEINE Untergrenze: eine reine Sticker-/Anhang-Nachricht hat text = ''.
--
--   SELECT id, author_id, length(text) AS laenge, left(text, 60) AS anfang
--     FROM messages WHERE length(text) > 4000 ORDER BY laenge DESC;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'messages_text_len' AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_text_len
      CHECK (length(text) <= 4000) NOT VALID;
  END IF;
END $$;

-- ── profiles.bio ≤ 500 ────────────────────────────────────────────
-- UI heute: maxlength 190 (community.js:3895) bzw. 160 (account.js:1693).
-- 500 laesst Luft nach oben, ohne das Feld zum Datenspeicher zu machen.
--
--   SELECT id, username, length(bio) AS laenge
--     FROM profiles WHERE length(bio) > 500 ORDER BY laenge DESC;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'profiles_bio_len' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_bio_len
      CHECK (bio IS NULL OR length(bio) <= 500) NOT VALID;
  END IF;
END $$;

-- ── voice_rooms.title ≤ 80 ────────────────────────────────────────
-- UI heute: maxlength 40 (community.js:4491).
--
--   SELECT id, group_id, length(title) AS laenge, left(title, 60) AS anfang
--     FROM voice_rooms WHERE length(title) > 80 ORDER BY laenge DESC;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'voice_rooms_title_len' AND conrelid = 'public.voice_rooms'::regclass) THEN
    ALTER TABLE public.voice_rooms ADD CONSTRAINT voice_rooms_title_len
      CHECK (length(title) <= 80) NOT VALID;
  END IF;
END $$;

-- ── profiles.username: Format ─────────────────────────────────────
-- Zeichenraster identisch zu handle_new_user() und _usernameBase() in
-- src/js/auth.js: [A-Za-z0-9_], mindestens 2 Zeichen.
--
-- Warum 60 und nicht 24, obwohl die Eingabefelder auf 24 begrenzen:
-- der Code selbst erzeugt in Kollisionsfaellen laengere Namen.
--   · handle_new_user(), i = 26:  left(base,8) || '_' || uuid_ohne_striche
--     → 8 + 1 + 32 = 41 Zeichen
--   · _repairMissingProfile() in auth.js: `${base}_${bare}`
--     → bis zu 24 + 1 + 32 = 57 Zeichen
-- Eine Grenze bei 24 wuerde also ausgerechnet den Notnagel gegen
-- Namenskollisionen sprengen — und zwar mitten in der Registrierung.
-- 60 deckt beide Faelle ab und ist zugleich die Breite des
-- Anmeldefelds (auth.js:760).
--
--   SELECT id, username, length(username) AS laenge
--     FROM profiles
--    WHERE username !~ '^[A-Za-z0-9_]{2,60}$'
--    ORDER BY laenge DESC;
--
-- Liefert das Zeilen, dann VOR dem Validieren umbenennen — Namen werden
-- an vielen Stellen als Schluessel benutzt, deshalb nicht automatisch.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'profiles_username_fmt' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_fmt
      CHECK (username ~ '^[A-Za-z0-9_]{2,60}$') NOT VALID;
  END IF;
END $$;

-- ── Die restlichen unbegrenzten Textfelder ────────────────────────
-- Nicht in der urspruenglichen Liste, aber dieselbe Luecke: `text` ohne
-- Grenze. profiles.avatar ist davon das mit Abstand groesste Feld.

-- profiles.avatar ≤ 1 000 000 Zeichen (≈ 730 KB binaer nach base64).
-- compressPhoto() in src/js/account.js liefert 600 px / JPEG 0.72, typisch
-- unter 200 000 Zeichen — die Grenze hat also rund das Fuenffache Luft.
--
-- ACHTUNG BEIM VALIDIEREN: der Upload-Pfad in account.js hat bis zu dieser
-- Umstellung die ROHE Data-URL gespeichert, eine 2-MB-Datei also als ~2,7 Mio.
-- Zeichen. Bestandszeilen koennen die Grenze reissen. Pruefen:
--
--   SELECT id, username, length(avatar) AS zeichen
--     FROM profiles WHERE length(avatar) > 1000000 ORDER BY zeichen DESC;
--
-- Treffer: den Betroffenen das Bild neu hochladen lassen (der neue Pfad
-- komprimiert), oder avatar auf NULL setzen — der Client zeigt dann die
-- Initialen, also genau das, was er ohne Bild ohnehin anzeigt.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'profiles_avatar_len' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_len
      CHECK (avatar IS NULL OR length(avatar) <= 1000000) NOT VALID;
  END IF;
END $$;

-- display_name ≤ 80 (UI: 40 in community.js, 32 in account.js)
-- status_text  ≤ 120 (UI: 60)
-- bike_text    ≤ 120 (UI: 60)
--
--   SELECT id, username, length(display_name), length(status_text), length(bike_text)
--     FROM profiles
--    WHERE length(display_name) > 80
--       OR length(status_text)  > 120
--       OR length(bike_text)    > 120;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'profiles_display_name_len' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_display_name_len
      CHECK (display_name IS NULL OR length(display_name) <= 80) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'profiles_status_text_len' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_text_len
      CHECK (status_text IS NULL OR length(status_text) <= 120) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'profiles_bike_text_len' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_bike_text_len
      CHECK (bike_text IS NULL OR length(bike_text) <= 120) NOT VALID;
  END IF;
END $$;
