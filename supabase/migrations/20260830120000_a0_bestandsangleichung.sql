-- ══════════════════════════════════════════════════════════════════
--  A0 — Bestandsangleichung
--
--  Bringt JEDE Umgebung auf denselben Stand, bevor die eigentlichen
--  Prompt-Migrationen (A3 …) laufen.
--
--  WARUM DIESE DATEI EXISTIERT
--  Die Spalten und Tabellen hier standen bisher als AUSKOMMENTIERTE
--  "einmalig im SQL-Editor ausfuehren"-Blocks in supabase/schema.sql.
--  Niemand hat aufgeschrieben, wo sie gelaufen sind. Genau deshalb hat
--  src/js/community-api.js an neun Stellen geraten, wie das eigene
--  Schema aussieht ("Migration evtl. noch nicht ausgefuehrt").
--
--  Nach dieser Migration ist jede dieser Fragen beantwortet — erst
--  danach durfte der Rateschalter aus dem Client raus.
--
--  Alles idempotent: die Datei darf beliebig oft laufen. Auf einer
--  Datenbank, die schon alles hat, aendert sie nichts.
-- ══════════════════════════════════════════════════════════════════

-- ── profiles.avatar ───────────────────────────────────────────────
-- Profilbild als Data-URL. Geraten in community-api.js setMyProfile()
-- (Rueckfall bei PGRST204).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar text;

-- ── groups.event_at / groups.meeting_point ────────────────────────
-- Termin und Treffpunkt einer Tour. Geraten in _loadGroups(),
-- createGroup() und updateGroup().
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS event_at      timestamptz;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS meeting_point text;

-- ── messages.mentions / messages.attachment ───────────────────────
-- @-Erwaehnungen und Datei-/Sticker-Anhaenge. Geraten in
-- _selectMessages(), sendGroupMessage() und sendDM().
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS mentions   uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment jsonb;

-- ── group_rsvps ("Ich fahre mit") ─────────────────────────────────
-- Geraten in _loadGroups() (Embed-Rueckfallkette).
CREATE TABLE IF NOT EXISTS public.group_rsvps (
  group_id   uuid NOT NULL REFERENCES public.groups(id)   ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
ALTER TABLE public.group_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvp_select" ON public.group_rsvps;
CREATE POLICY "rsvp_select" ON public.group_rsvps FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.group_members WHERE group_id = group_rsvps.group_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.groups WHERE id = group_rsvps.group_id AND join_mode = 'open'
  ));

DROP POLICY IF EXISTS "rsvp_insert" ON public.group_rsvps;
CREATE POLICY "rsvp_insert" ON public.group_rsvps FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "rsvp_delete" ON public.group_rsvps;
CREATE POLICY "rsvp_delete" ON public.group_rsvps FOR DELETE USING (user_id = auth.uid());

-- ── voice_rooms (Sprachkanaele) ───────────────────────────────────
-- Nur Metadaten; wer live drin ist, laeuft ueber Realtime-Presence.
-- Geraten in _loadGroups() (zweite Stufe der Rueckfallkette).
CREATE TABLE IF NOT EXISTS public.voice_rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.groups(id)   ON DELETE CASCADE,
  title      text NOT NULL,
  capacity   int  NOT NULL DEFAULT 4,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.voice_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vr_select" ON public.voice_rooms;
CREATE POLICY "vr_select" ON public.voice_rooms FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.group_members WHERE group_id = voice_rooms.group_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.groups WHERE id = voice_rooms.group_id AND join_mode = 'open'
  ));

DROP POLICY IF EXISTS "vr_insert" ON public.voice_rooms;
CREATE POLICY "vr_insert" ON public.voice_rooms FOR INSERT
  WITH CHECK (created_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.group_members WHERE group_id = voice_rooms.group_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "vr_delete" ON public.voice_rooms;
CREATE POLICY "vr_delete" ON public.voice_rooms FOR DELETE
  USING (created_by = auth.uid() OR EXISTS (
    SELECT 1 FROM public.group_members WHERE group_id = voice_rooms.group_id
    AND user_id = auth.uid() AND role IN ('owner','mod')
  ));

-- ── Storage-Bucket fuer Chat-Anhaenge ─────────────────────────────
-- Oeffentlich lesbar: die Nachricht speichert eine dauerhafte URL,
-- signierte URLs wuerden ablaufen und Anhaenge in alten Nachrichten
-- toeten. Aufraeumen beim Kontoloeschen macht api/delete-account.js —
-- storage.objects haengt an keinem Fremdschluessel auf profiles.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', true, 26214400)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat_attach_read"   ON storage.objects;
CREATE POLICY "chat_attach_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-attachments');

DROP POLICY IF EXISTS "chat_attach_insert" ON storage.objects;
CREATE POLICY "chat_attach_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "chat_attach_delete" ON storage.objects;
CREATE POLICY "chat_attach_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
