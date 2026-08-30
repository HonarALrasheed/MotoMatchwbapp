-- ══════════════════════════════════════════════════════════════════
--  A4b — Rollen in group_members sind nicht mehr eskalierbar
--
--  Nachtrag zu A4. Dort wurde der Selbst-Eintrag zugemacht (gm_insert);
--  die drei uebrigen Policies auf group_members pruefen aber bis jetzt
--  nur WER schreibt, nie WELCHE ROLLE dabei entsteht.
--
--  Was damit ging — jeweils direkt ueber die REST-API, am UI vorbei:
--
--   · gm_insert_mod: WITH CHECK prueft nur, dass der Aufrufer owner/mod
--     ist. Die Rolle der neuen Zeile ist frei — ein Mod konnte ein
--     beliebiges Konto als 'owner' eintragen.
--
--   · gm_update: hat nur ein USING und kein WITH CHECK. Postgres setzt
--     die USING-Bedingung dann auch fuer die NEUE Zeile ein; die ist mit
--     "Aufrufer ist owner/mod" aber schon erfuellt, egal was danach in
--     `role` steht. Ein Mod konnte damit SICH SELBST auf 'owner' setzen.
--     Das ist die eigentliche Rechteausweitung: sie braucht kein zweites
--     Konto und keine Mithilfe.
--
--   · gm_delete: ein Mod konnte die Zeile des Gruenders loeschen und die
--     Gruppe damit ohne Besitzer zuruecklassen.
--
--  Die App selbst vergibt 'owner' AUSSCHLIESSLICH beim Anlegen einer
--  Gruppe (createGroup, ueber gm_insert_owner aus A4); toggleMod schaltet
--  nur zwischen 'member' und 'mod', kickMember und leaveGroup loeschen.
--  gm_insert_mod ruft der Client ueberhaupt nicht auf. Diese Migration
--  nimmt der Datenbank also nichts weg, was die Anwendung braucht.
-- ══════════════════════════════════════════════════════════════════

-- ── Aufnehmen durch Owner/Mods: niemals als 'owner' ───────────────
DROP POLICY IF EXISTS "gm_insert_mod" ON public.group_members;
CREATE POLICY "gm_insert_mod" ON public.group_members FOR INSERT
  WITH CHECK (
    role IN ('member','mod')
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_members.group_id
         AND gm.user_id = auth.uid() AND gm.role IN ('owner','mod')
    )
    -- Ein gesperrtes Konto wieder aufzunehmen hebt den Bann stillschweigend
    -- auf. Erst entsperren, dann aufnehmen — wie in accept_join_request().
    -- Geprueft wird die Sperre des EINGETRAGENEN, nicht die des Aufrufers.
    AND NOT EXISTS (
      SELECT 1 FROM public.group_bans b
       WHERE b.group_id = group_members.group_id AND b.user_id = group_members.user_id
    )
  );

-- ── Rollen aendern: nur zwischen 'member' und 'mod' ───────────────
-- Die Owner-Zeile ist fuer JEDEN tabu, auch fuer den Gruender selbst:
-- es gibt in der App keinen Ablauf, der sie aendert. Wer die Gruppe
-- abgeben will, hat dafuer heute ohnehin keine Oberflaeche — und ein
-- stiller Weg ueber die REST-API ist keine Eigentumsuebergabe, sondern
-- genau die Luecke, die hier zugeht.
DROP POLICY IF EXISTS "gm_update" ON public.group_members;
CREATE POLICY "gm_update" ON public.group_members FOR UPDATE
  USING (
    group_members.role <> 'owner'
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_members.group_id
         AND gm.user_id = auth.uid() AND gm.role IN ('owner','mod')
    )
  )
  -- Ohne dieses WITH CHECK gilt der USING-Ausdruck auch fuer die neue
  -- Zeile — und der sagt nichts ueber `role`.
  WITH CHECK (role IN ('member','mod'));

-- ── Entfernen: die eigene Zeile immer, fremde nur wenn kein Owner ──
DROP POLICY IF EXISTS "gm_delete" ON public.group_members;
CREATE POLICY "gm_delete" ON public.group_members FOR DELETE
  USING (
    -- Austreten: die eigene Zeile darf jeder loeschen, auch der Gruender.
    user_id = auth.uid()
    OR (
      group_members.role <> 'owner'
      AND EXISTS (
        SELECT 1 FROM public.group_members gm
         WHERE gm.group_id = group_members.group_id
           AND gm.user_id = auth.uid() AND gm.role IN ('owner','mod')
      )
    )
  );
