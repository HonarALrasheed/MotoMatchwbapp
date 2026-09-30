-- ══════════════════════════════════════════════════════════════════
--  A7 — Kontoloeschung und Datenauskunft (DB-Seite)
--  DSGVO Art. 15 — Auskunft: export_my_data()
--
--  Die Loeschung (Art. 17) laeuft ueber api/delete-account.js mit dem
--  Service-Role-Key und braucht keine Migration: die ON-DELETE-CASCADE-
--  Ketten haengen bereits an auth.users. Der Storage-Bucket haengt an
--  keinem Fremdschluessel — den raeumt api/delete-account.js explizit ab.
-- ══════════════════════════════════════════════════════════════════

-- Gibt alle Zeilen zum aufrufenden Nutzer als EIN jsonb-Objekt zurueck.
--
-- SICHERHEIT — der Nutzer kommt aus auth.uid(), NICHT aus einem Parameter.
-- Die Funktion hat bewusst gar keinen Parameter: SECURITY DEFINER umgeht RLS,
-- eine uid von aussen waere damit ein Auskunftsrecht ueber fremde Konten.
--
-- ABGRENZUNG "nur eigene Daten" — bewusste Entscheidungen:
--   · messages: nur author_id = uid. Ein DM-Verlauf gehoert auch dem Gegenueber.
--   · blocks:   nur blocker = uid. Zeilen mit blocked = uid wuerden offenlegen,
--               wer den Nutzer blockiert hat — fremde Schutzhandlung, Art. 15 Abs. 4.
--   · user_reports: nur from_user = uid, aus demselben Grund.
--   · friend_requests/friendships: beide Richtungen — das zeigt die App ohnehin.
--   · Fremde E-Mail-Adressen kommen nirgends vor.
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'export_my_data: not authenticated' USING ERRCODE = '28000';
  END IF;

  RETURN jsonb_build_object(
    'exported_at', now(),
    'user_id',     v_uid,

    -- Eigene Zeile aus auth.users. Bewusst nur diese vier Felder — nicht
    -- to_jsonb(au), das enthielte auch den Passwort-Hash und Tokens.
    'account', (
      SELECT to_jsonb(a) FROM (
        SELECT au.id, au.email, au.created_at, au.last_sign_in_at
        FROM auth.users au WHERE au.id = v_uid
      ) a
    ),

    'profile', (SELECT to_jsonb(p) FROM profiles p WHERE p.id = v_uid),

    'messages', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at)
      FROM messages m WHERE m.author_id = v_uid
    ), '[]'::jsonb),

    'group_members', COALESCE((
      SELECT jsonb_agg(to_jsonb(gm) ORDER BY gm.joined_at)
      FROM group_members gm WHERE gm.user_id = v_uid
    ), '[]'::jsonb),

    'friendships', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id)
      FROM friendships f WHERE f.user_a = v_uid OR f.user_b = v_uid
    ), '[]'::jsonb),

    'friend_requests', COALESCE((
      SELECT jsonb_agg(to_jsonb(fr) ORDER BY fr.created_at)
      FROM friend_requests fr WHERE fr.from_user = v_uid OR fr.to_user = v_uid
    ), '[]'::jsonb),

    'blocks', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id)
      FROM blocks b WHERE b.blocker = v_uid
    ), '[]'::jsonb),

    'ignores', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
      FROM ignores i WHERE i.ignorer = v_uid
    ), '[]'::jsonb),

    'group_rsvps', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at)
      FROM group_rsvps r WHERE r.user_id = v_uid
    ), '[]'::jsonb),

    'user_reports', COALESCE((
      SELECT jsonb_agg(to_jsonb(ur) ORDER BY ur.created_at)
      FROM user_reports ur WHERE ur.from_user = v_uid
    ), '[]'::jsonb),

    'message_reports', COALESCE((
      SELECT jsonb_agg(to_jsonb(mr) ORDER BY mr.created_at)
      FROM message_reports mr WHERE mr.reported_by = v_uid
    ), '[]'::jsonb),

    -- Eigene Reaktionen. Frueher steckten sie in messages.reactions und kamen
    -- damit nur im Export DESSEN mit, der die Nachricht geschrieben hat — die
    -- eigene Reaktion auf eine fremde Nachricht fehlte im eigenen Export.
    'message_reactions', COALESCE((
      SELECT jsonb_agg(to_jsonb(mrx) ORDER BY mrx.created_at)
      FROM message_reactions mrx WHERE mrx.user_id = v_uid
    ), '[]'::jsonb),

    'beta_feedback', COALESCE((
      SELECT jsonb_agg(to_jsonb(bf) ORDER BY bf.created_at)
      FROM beta_feedback bf WHERE bf.user_id = v_uid
    ), '[]'::jsonb),

    'push_subscriptions', COALESCE((
      SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.created_at)
      FROM push_subscriptions ps WHERE ps.user_id = v_uid
    ), '[]'::jsonb),

    'notification_mutes', COALESCE((
      SELECT jsonb_agg(to_jsonb(nm) ORDER BY nm.mute_key)
      FROM notification_mutes nm WHERE nm.user_id = v_uid
    ), '[]'::jsonb)
  );
END;
$$;

-- REVOKE gegen PUBLIC allein reicht bei Supabase NICHT: das Projekt setzt
-- ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS TO anon, authenticated,
-- jede neue Funktion in `public` bekommt also einen EIGENEN Grant an anon.
REVOKE ALL ON FUNCTION public.export_my_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.export_my_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
