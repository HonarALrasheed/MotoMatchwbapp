-- ══════════════════════════════════════════════════════════════════
--  MotoMatch — Testgruppen aufräumen
--  Im Supabase-Dashboard unter SQL Editor ausführen.
--
--  Ersetzt Schritt 2 aus startgruppen.sql. Dort stand eine Liste von
--  Namen — sie traf nur einen Teil: in der Datenbank stehen 69
--  Gruppen, davon 61 Tastatur-Tests unter Namen wie „Baum", „ddd",
--  „nnn", „bbbbbb", „BingBong", „Test", „Testtour".
--
--  Deshalb umgekehrt gedacht: Es bleibt, was der Gastgeber
--  kontakt@motomatch.studio angelegt hat. Alles andere geht.
--  Eine Namensliste zu pflegen hiesse, beim naechsten Test von vorn
--  anzufangen.
--
--  An groups haengen Mitglieder, Kanaele und Nachrichten per
--  ON DELETE CASCADE. Was hier faellt, ist weg.
-- ══════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────
--  1 — Was bleibt? (Kontrolle vorab)
-- ──────────────────────────────────────────────────────────────────

SELECT g.category AS kategorie, g.name AS gruppe, g.event_at AT TIME ZONE 'Europe/Berlin' AS termin_ortszeit
FROM groups g
JOIN auth.users u ON u.id = g.created_by
WHERE lower(u.email) = 'kontakt@motomatch.studio'
ORDER BY g.category, g.name;


-- ──────────────────────────────────────────────────────────────────
--  2 — Was faellt? Erst ansehen.
--
--  Die letzte Zeile nimmt die beiden „Nuerburgring"-Touren aus. Die
--  stammen von marie0hartmann@gmail.com, haben drei Mitglieder und
--  eine echte Beschreibung — als einzige sehen sie nicht nach Test
--  aus. Sollen sie auch weg, loesche die Zeile.
-- ──────────────────────────────────────────────────────────────────

SELECT
  p.username                                                      AS ersteller,
  g.category                                                      AS kategorie,
  g.name                                                          AS gruppe,
  (SELECT count(*) FROM group_members m WHERE m.group_id = g.id)  AS mitglieder
FROM groups g
JOIN profiles p ON p.id = g.created_by
WHERE g.created_by <> (SELECT id FROM auth.users WHERE lower(email) = 'kontakt@motomatch.studio')
  AND g.name <> 'Nürburgring'
ORDER BY p.username, g.category, g.name;


-- ──────────────────────────────────────────────────────────────────
--  3 — Loeschen. Erst ausfuehren, wenn die Liste oben stimmt.
--
--  Dieselbe Bedingung wie im SELECT darueber, Wort fuer Wort — wenn
--  du dort die Nuerburgring-Zeile entfernst, hier ebenfalls.
-- ──────────────────────────────────────────────────────────────────

DELETE FROM groups g
WHERE g.created_by <> (SELECT id FROM auth.users WHERE lower(email) = 'kontakt@motomatch.studio')
  AND g.name <> 'Nürburgring';


-- ──────────────────────────────────────────────────────────────────
--  4 — Endstand
-- ──────────────────────────────────────────────────────────────────

SELECT
  g.category                                   AS kategorie,
  g.name                                       AS gruppe,
  p.username                                   AS ersteller,
  g.join_mode                                  AS beitritt,
  g.event_at AT TIME ZONE 'Europe/Berlin'      AS termin_ortszeit,
  g.meeting_point                              AS treffpunkt
FROM groups g
JOIN profiles p ON p.id = g.created_by
ORDER BY g.category, g.name;
