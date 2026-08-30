-- ══════════════════════════════════════════════════════════════════
--  A4 — RLS haerten, Teil 2: Gruppenbeitritt und Einladungen
--  (Audit-Befunde 3.3 / 3.4, Backlog #8, #9 · setzt A3 voraus)
--
--  Diese Migration traegt bewusst einen SPAETEREN Zeitstempel als a13,
--  obwohl A4 in der Prompt-Reihenfolge vor A5 stand: A4 ist nie
--  eingespielt worden. Migrationen laufen in der Reihenfolge, in der sie
--  geschrieben wurden, nicht in der, in der sie geplant waren.
--
--  BEFUND 1 — group_members:
--    CREATE POLICY "gm_insert" … WITH CHECK (user_id = auth.uid());
--    CREATE POLICY "gm_insert_mod" … WITH CHECK (EXISTS (… owner/mod));
--  Postgres verknuepft mehrere permissive INSERT-Policies mit ODER.
--  gm_insert allein genuegte also — "ich trage mich selbst ein" war immer
--  erlaubt. Weder groups.join_mode noch group_bans kamen in irgendeiner
--  Policy vor; die einzige Pruefung stand im Browser. Ergebnis:
--  invite-only-Gruppen waren offen, Sperren wirkungslos, und der ganze
--  group_join_requests-Ablauf war Zierde. Gruppen-IDs sind auch nicht
--  geheim — groups_select_public listet alle.
--
--  BEFUND 2 — invites:
--    CREATE POLICY "invites_select" … USING (true);
--    CREATE POLICY "invites_update" … USING (true);
--  Jeder, auch anon, las alle Einladungscodes aller Gruppen und durfte sie
--  aendern (bei UPDATE ohne WITH CHECK gilt der USING-Ausdruck auch fuer
--  die neue Zeile). Der Client lud sie beim Start sogar aktiv.
-- ══════════════════════════════════════════════════════════════════

-- ── group_members: Selbst-Eintrag nur noch in offene Gruppen ──────
DROP POLICY IF EXISTS "gm_insert" ON public.group_members;
CREATE POLICY "gm_insert" ON public.group_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    -- Ohne diese Zeile traegt man sich selbst als 'owner' oder 'mod' ein.
    AND role = 'member'
    AND EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_members.group_id AND g.join_mode = 'open'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_bans b
      WHERE b.group_id = group_members.group_id AND b.user_id = auth.uid()
    )
  );

-- ── Der Ersteller muss sich als owner eintragen duerfen ───────────
-- WICHTIG: ohne diese Policy ist das Anlegen einer Gruppe kaputt.
-- createGroup() in src/js/community-api.js legt die Gruppe an und traegt
-- sich unmittelbar danach mit role='owner' ein — das lief bisher ueber
-- gm_insert (user_id = auth.uid()), das oben gerade zugemacht wurde.
-- gm_insert_mod greift an dieser Stelle nicht: es verlangt eine bereits
-- bestehende owner/mod-Zeile, die es genau jetzt noch nicht gibt.
-- Der Beleg ist groups.created_by — die Zeile hat der Aufrufer selbst
-- unter der Policy groups_insert (created_by = auth.uid()) erzeugt.
DROP POLICY IF EXISTS "gm_insert_owner" ON public.group_members;
CREATE POLICY "gm_insert_owner" ON public.group_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_members.group_id AND g.created_by = auth.uid()
    )
  );

-- gm_insert_mod bleibt unveraendert: Owner und Mods duerfen weiterhin
-- andere aufnehmen. Fuer join_mode 'request' und 'invite' geht der
-- Selbst-Eintrag ab jetzt gar nicht mehr — dafuer sind die beiden
-- Funktionen weiter unten da.

-- ── invites: Codes gehoeren der Gruppenleitung ────────────────────
DROP POLICY IF EXISTS "invites_select" ON public.invites;
CREATE POLICY "invites_select" ON public.invites FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = invites.group_id
      AND user_id = auth.uid() AND role IN ('owner','mod')
  ));

-- Ersatzlos gestrichen: den Zaehler erhoeht ab jetzt ausschliesslich
-- redeem_invite() mit Definer-Rechten. Niemand sonst hat Grund, eine
-- invites-Zeile zu aendern.
DROP POLICY IF EXISTS "invites_update" ON public.invites;

-- ══════════════════════════════════════════════════════════════════
--  redeem_invite(invite_code text) → jsonb
--
--  Ersetzt den frueheren Ablauf im Browser: select + insert + update.
--  Der zaehlte `uses` clientseitig hoch (uses = gelesener Wert + 1) —
--  zwei gleichzeitige Einloesungen zaehlten damit einmal, ein Code mit
--  max_uses = 1 liess sich zu zweit einloesen.
--
--  Hier erzwingt das UPDATE selbst die Grenze:
--    UPDATE … SET uses = uses + 1 WHERE … AND uses < max_uses
--  Die Zeile ist waehrend des Updates gesperrt, die zweite Anfrage sieht
--  den erhoehten Wert und trifft keine Zeile mehr.
--
--  Rueckgabe ist jsonb statt einer Exception, damit der Client zwischen
--  "Code unbekannt" (die Eingabe war vielleicht ein Gruppenname) und
--  echten Code-Fehlern unterscheiden kann — genau die Unterscheidung,
--  die das UI in community.js ueber `reason` schon trifft.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.redeem_invite(invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_code     text;
  v_group_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Codes werden aus einem gemischten Alphabet erzeugt; das UI vergleicht
  -- case-insensitiv. Erst den exakt gespeicherten Code aufloesen, danach
  -- wird ausschliesslich mit dem gearbeitet.
  SELECT i.code, i.group_id INTO v_code, v_group_id
    FROM invites i
   WHERE lower(i.code) = lower(btrim(invite_code))
   LIMIT 1;

  IF v_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = v_group_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_group');
  END IF;

  -- Bann und bestehende Mitgliedschaft VOR dem Zaehler pruefen: sonst
  -- verbraucht ein abgelehnter Versuch eine Einloesung.
  IF EXISTS (SELECT 1 FROM group_bans b
              WHERE b.group_id = v_group_id AND b.user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'banned');
  END IF;

  IF EXISTS (SELECT 1 FROM group_members m
              WHERE m.group_id = v_group_id AND m.user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_member',
                              'group_id', v_group_id);
  END IF;

  -- Ablauf und max_uses stecken in der WHERE-Bedingung, nicht in einem
  -- vorgelagerten IF: nur so ist das Hochzaehlen gegen zwei gleichzeitige
  -- Einloesungen dicht.
  UPDATE invites
     SET uses = uses + 1
   WHERE code = v_code
     AND (expires_at IS NULL OR expires_at > now())
     AND (max_uses  IS NULL OR uses < max_uses);

  IF NOT FOUND THEN
    -- Nicht getroffen heisst: abgelaufen oder aufgebraucht. Welches von
    -- beidem, sagt ein Blick auf die Zeile — sie ist ja noch da.
    IF EXISTS (SELECT 1 FROM invites i
                WHERE i.code = v_code AND i.expires_at IS NOT NULL AND i.expires_at <= now()) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
  END IF;

  INSERT INTO group_members (group_id, user_id, role)
  VALUES (v_group_id, v_uid, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'group_id', v_group_id);
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_invite(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite(text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════
--  accept_join_request(request_id uuid) → jsonb
--
--  Ersetzt zwei getrennte Client-Schreibvorgaenge ohne Transaktion
--  (erst aufnehmen, dann die Anfrage wegraeumen). Scheiterte der zweite,
--  blieb die Anfrage als erledigt-aber-offen stehen. Hier laeuft beides
--  in EINER Transaktion — die Funktion ist der Transaktionsrahmen.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.accept_join_request(request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_group_id uuid;
  v_from     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT r.group_id, r.from_user INTO v_group_id, v_from
    FROM group_join_requests r
   WHERE r.id = request_id;

  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_request');
  END IF;

  -- SECURITY DEFINER umgeht RLS — die Berechtigung muss deshalb HIER
  -- stehen und nicht in einer Policy.
  IF NOT EXISTS (
    SELECT 1 FROM group_members m
     WHERE m.group_id = v_group_id AND m.user_id = v_uid
       AND m.role IN ('owner','mod')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  -- Eine offene Anfrage eines gesperrten Kontos anzunehmen wuerde den Bann
  -- stillschweigend aufheben. Erst entsperren, dann annehmen.
  IF EXISTS (SELECT 1 FROM group_bans b
              WHERE b.group_id = v_group_id AND b.user_id = v_from) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'banned');
  END IF;

  INSERT INTO group_members (group_id, user_id, role)
  VALUES (v_group_id, v_from, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  -- Das einzige DELETE in diesen Migrationen, und es loescht genau die
  -- Anfrage, die gerade angenommen wurde — so steht es in der Aufgabe.
  DELETE FROM group_join_requests WHERE id = request_id;

  RETURN jsonb_build_object('ok', true, 'group_id', v_group_id, 'user_id', v_from);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_join_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_join_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_join_request(uuid) TO authenticated;
