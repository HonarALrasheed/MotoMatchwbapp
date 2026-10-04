-- ══════════════════════════════════════════════════════════════════
--  MotoMatch — Testgruppen aufräumen und Startgruppen anlegen
--  Auszuführen im Supabase-Dashboard unter SQL Editor.
--
--  In drei Schritten, und zwar EINZELN nacheinander markieren und
--  ausführen — nicht alles auf einmal. Schritt 2 löscht, und was
--  gelöscht ist, ist weg: an groups hängen Mitglieder, Kanäle und
--  Nachrichten per ON DELETE CASCADE.
-- ══════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────
--  SCHRITT 1 — Bestandsaufnahme. Löscht nichts, zeigt nur.
--  Hier siehst du, was da ist und von wem.
-- ──────────────────────────────────────────────────────────────────

SELECT
  g.name                                   AS gruppe,
  g.category                               AS kategorie,
  p.username                               AS ersteller,
  (SELECT count(*) FROM group_members m WHERE m.group_id = g.id) AS mitglieder,
  (SELECT count(*) FROM messages   n WHERE n.channel_id IN
     (SELECT c.id FROM channels c WHERE c.group_id = g.id))      AS nachrichten,
  g.event_at                               AS termin,
  g.created_at                             AS angelegt
FROM groups g
JOIN profiles p ON p.id = g.created_by
ORDER BY g.created_at DESC;


-- ──────────────────────────────────────────────────────────────────
--  SCHRITT 2 — Aufräumen.
--
--  Die Liste unten enthält die Namen aus deinen Bildern, die
--  erkennbar Tastatur-Tests sind. Bewusst NICHT drin: die beiden
--  „Nürburgring"-Einträge. Die stammen von einer fremden Adresse und
--  haben eine echte Beschreibung — fremde Inhalte lösche ich nicht
--  ungefragt. Willst du sie weg, trag den Namen einfach mit ein.
--
--  Führe zuerst NUR das SELECT aus und sieh dir an, was getroffen
--  wird. Erst wenn die Liste stimmt, das DELETE darunter.
-- ──────────────────────────────────────────────────────────────────

-- 2a) Was würde gelöscht?
SELECT g.name, g.category, p.username AS ersteller, g.created_at
FROM groups g JOIN profiles p ON p.id = g.created_by
WHERE g.name IN ('cfdd', 'eee', 'zzzz', 'TESTTTTT', 'hit', 'Kritiker-Testtour')
ORDER BY g.name;

-- 2b) Wenn die Liste oben stimmt: löschen.
-- DELETE FROM groups
-- WHERE name IN ('cfdd', 'eee', 'zzzz', 'TESTTTTT', 'hit', 'Kritiker-Testtour');


-- ──────────────────────────────────────────────────────────────────
--  SCHRITT 3 — Startgruppen anlegen, Gastgeber ist die Geschäfts-
--  adresse.
--
--  Voraussetzung: kontakt@motomatch.studio hat ein Konto. Falls
--  nicht, einmal auf motomatch.studio → Konto → Anmelden → „Ohne
--  Passwort anmelden" mit dieser Adresse durchlaufen. Das Skript
--  bricht sonst mit einer verständlichen Meldung ab.
--
--  Das Skript darf mehrfach laufen: was schon da ist, wird
--  übersprungen, nichts doppelt angelegt.
-- ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  gastgeber uuid;
  vorhanden uuid;
  neu       uuid;
  eintrag   record;
  angelegt  int := 0;
BEGIN
  SELECT u.id INTO gastgeber
  FROM auth.users u
  WHERE lower(u.email) = 'kontakt@motomatch.studio';

  IF gastgeber IS NULL THEN
    RAISE EXCEPTION 'Kein Konto für kontakt@motomatch.studio. Erst auf motomatch.studio mit dieser Adresse anmelden ("Ohne Passwort anmelden"), dann dieses Skript erneut ausführen.';
  END IF;

  -- groups.created_by zeigt auf profiles, nicht auf auth.users. Die Zeile
  -- legt normalerweise der Trigger handle_new_user() an; fehlt sie, liefe
  -- der INSERT unten in einen unverständlichen Fremdschlüsselfehler.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = gastgeber) THEN
    RAISE EXCEPTION 'Konto gefunden, aber keine profiles-Zeile dazu. Einmal auf der Seite anmelden, dann erneut versuchen.';
  END IF;

  FOR eintrag IN
    SELECT * FROM (VALUES
      -- Kategorie,    Name,
      -- Beschreibung,
      -- Termin (NULL = kein Termin),                              Treffpunkt
      ('touren', 'Sonntagstour Eifel',
       'Gemütliche Runde über die Landstraßen der Eifel, rund 200 km mit Kaffeepause. Tempo so, dass alle mitkommen.',
       ((current_date + 12) + time '09:00') AT TIME ZONE 'Europe/Berlin',
       'Parkplatz Nürburgring, Döttinger Höhe'),

      ('touren', 'Feierabendrunde Münsterland',
       'Kurze Runde nach der Arbeit, etwa 80 km über Landstraßen. Für jede Führerscheinklasse geeignet.',
       ((current_date + 5) + time '18:00') AT TIME ZONE 'Europe/Berlin',
       'Aasee Münster, Parkplatz Torminbrücke'),

      ('events', 'Bike-Night Münster',
       'Abendtreffen auf dem Platz: Maschinen anschauen, quatschen, etwas essen. Kommen und gehen, wann du willst.',
       ((current_date + 19) + time '19:00') AT TIME ZONE 'Europe/Berlin',
       'Hansaplatz Münster'),

      ('stammtische', 'Stammtisch Münsterland',
       'Einmal im Monat zusammensitzen — ohne Anmeldung, einfach vorbeikommen. Auch ohne Maschine vor der Tür.',
       ((current_date + 9) + time '19:30') AT TIME ZONE 'Europe/Berlin',
       'Gasthaus zur Post, Greven'),

      ('gruppen', 'Neu auf dem Motorrad',
       'Frisch den Schein in der Tasche? Hier fragt man alles, ohne sich dumm vorzukommen. Erste Tour, Ausrüstung, Kurventechnik.',
       NULL, NULL),

      ('gruppen', 'A2 und 35 kW',
       'Alles rund um gedrosselte Maschinen: Eintragung, Umbau, Kosten — und welches Bike sich danach noch lohnt.',
       NULL, NULL),

      ('schrauber', 'Schrauber-Treff',
       'Kette, Öl, Bremsen: was man selbst macht, welches Werkzeug es braucht und wann man besser in die Werkstatt fährt.',
       NULL, NULL),

      ('forum', 'Welches Bike passt zu mir?',
       'Ergebnis aus dem Finder unsicher? Schreib dein Budget, deine Größe und deine Klasse — andere schauen drüber.',
       NULL, NULL)
    ) AS t(kategorie, bezeichnung, beschreibung, termin, treffpunkt)
  LOOP
    -- Muss in jedem Durchlauf zurückgesetzt werden: SELECT INTO lässt die
    -- Variable unangetastet, wenn es keinen Treffer gibt — sonst schleppte
    -- der nächste Durchgang die ID des vorherigen mit und legte nichts an.
    vorhanden := NULL;
    SELECT g.id INTO vorhanden
    FROM groups g
    WHERE g.name = eintrag.bezeichnung AND g.created_by = gastgeber;

    CONTINUE WHEN vorhanden IS NOT NULL;

    INSERT INTO groups (name, description, category, join_mode,
                        event_at, meeting_point, created_by)
    VALUES (eintrag.bezeichnung, eintrag.beschreibung, eintrag.kategorie, 'open',
            eintrag.termin, eintrag.treffpunkt, gastgeber)
    RETURNING id INTO neu;

    -- Reihenfolge ist wichtig: die Policy für channels verlangt bereits
    -- einen Eintrag als owner oder mod für diese Gruppe.
    INSERT INTO group_members (group_id, user_id, role)
    VALUES (neu, gastgeber, 'owner');

    INSERT INTO channels (group_id, name, position)
    VALUES (neu, 'allgemein', 0);

    angelegt := angelegt + 1;
  END LOOP;

  RAISE NOTICE '% Startgruppe(n) angelegt, Gastgeber kontakt@motomatch.studio.', angelegt;
END $$;


-- ──────────────────────────────────────────────────────────────────
--  Kontrolle — was steht jetzt drin?
-- ──────────────────────────────────────────────────────────────────

SELECT g.category AS kategorie, g.name AS gruppe, g.join_mode AS beitritt,
       g.event_at AS termin, g.meeting_point AS treffpunkt
FROM groups g
JOIN auth.users u ON u.id = g.created_by
WHERE lower(u.email) = 'kontakt@motomatch.studio'
ORDER BY g.category, g.name;
