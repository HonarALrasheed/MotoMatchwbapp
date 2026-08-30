-- ══════════════════════════════════════════════════════════════════
--  A15 — Constraints scharf stellen
--
--  ERST EINSPIELEN, wenn die Pruef-SELECTs unten alle 0 Zeilen liefern.
--  Vorher: frisches Backup.
--
--  Bis hierher sind alle CHECKs als NOT VALID angelegt — sie greifen fuer
--  neue und geaenderte Zeilen, lassen den Altbestand aber in Ruhe.
--  VALIDATE CONSTRAINT prueft den Altbestand nach. Findet es eine
--  verletzende Zeile, bricht diese Migration ab (und rollt sich zurueck,
--  die CLI faehrt jede Datei in einer Transaktion) — die uebrigen
--  Migrationen bleiben unberuehrt.
--
--  VALIDATE nimmt nur eine SHARE UPDATE EXCLUSIVE-Sperre: Lesen und
--  Schreiben laufen waehrenddessen weiter.
--
--  ── Pruef-SELECTs (alle muessen 0 Zeilen liefern) ────────────────
--
--    SELECT id, author_id, length(text) FROM messages
--     WHERE length(text) > 4000;
--
--    SELECT id, username, length(bio) FROM profiles
--     WHERE length(bio) > 500;
--
--    SELECT id, group_id, length(title) FROM voice_rooms
--     WHERE length(title) > 80;
--
--    SELECT id, username FROM profiles
--     WHERE username !~ '^[A-Za-z0-9_]{2,60}$';
--
--    SELECT id, user_id, length(text) FROM beta_feedback
--     WHERE length(text) > 4000;
--
--    SELECT id, username, length(avatar) FROM profiles
--     WHERE length(avatar) > 1000000;
--
--    SELECT id, username FROM profiles
--     WHERE length(display_name) > 80
--        OR length(status_text)  > 120
--        OR length(bike_text)    > 120;
--
--    SELECT id, username, avatar_color FROM profiles
--     WHERE avatar_color IS NOT NULL
--       AND avatar_color !~* '^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|hsl\([0-9]{1,3}(\.[0-9]+)?[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%[[:space:]]+[0-9]{1,3}(\.[0-9]+)?%\))$';
--
--  Was tun, wenn eine Abfrage doch Zeilen liefert:
--    · zu lange Texte  → kuerzen (UPDATE … SET text = left(text, 4000)),
--                        aber vorher ansehen, was da steht
--    · avatar zu gross → neu hochladen lassen (der Pfad in account.js
--                        komprimiert jetzt) oder auf NULL setzen; der Client
--                        zeigt dann die Initialen
--    · avatar_color    → auf NULL setzen; der Client faellt dann auf
--                        colorFor(username) zurueck, also genau auf das,
--                        was er bei einem ungueltigen Wert ohnehin anzeigt
--    · username        → von Hand umbenennen. Namen sind an vielen Stellen
--                        Schluessel (DM-Threads, Reaktionen, Mentions) —
--                        das ist nichts fuer ein pauschales UPDATE.
--  Danach diese Datei erneut einspielen.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.messages      VALIDATE CONSTRAINT messages_text_len;
ALTER TABLE public.profiles      VALIDATE CONSTRAINT profiles_bio_len;
ALTER TABLE public.voice_rooms   VALIDATE CONSTRAINT voice_rooms_title_len;
ALTER TABLE public.profiles      VALIDATE CONSTRAINT profiles_username_fmt;
ALTER TABLE public.beta_feedback VALIDATE CONSTRAINT beta_feedback_text_len;
ALTER TABLE public.profiles      VALIDATE CONSTRAINT avatar_color_fmt;
ALTER TABLE public.profiles      VALIDATE CONSTRAINT profiles_avatar_len;
ALTER TABLE public.profiles      VALIDATE CONSTRAINT profiles_display_name_len;
ALTER TABLE public.profiles      VALIDATE CONSTRAINT profiles_status_text_len;
ALTER TABLE public.profiles      VALIDATE CONSTRAINT profiles_bike_text_len;
