-- ══════════════════════════════════════════════════════════════════
--  A16 — Chat-Anhaenge privat stellen
--
--  Vorher: Der Bucket `chat-attachments` stand auf public = true, und die
--  Leseregel lautete USING (bucket_id = 'chat-attachments') — ohne jede
--  Einschraenkung. Damit konnte jeder Beliebige, auch ohne Anmeldung, saemtliche
--  Anhaenge abrufen und auflisten, einschliesslich der Dateien aus privaten
--  Direktnachrichten. Die Objekte liegen unter <uid>/…, die Auflistung war
--  also nach Person sortiert.
--
--  Nachher: privater Bucket, Lesen nur fuer den Hochladenden und fuer die,
--  die die zugehoerige Nachricht ohnehin lesen duerfen. Der Client holt die
--  Adresse per createSignedUrl() (src/js/community-api.js).
-- ══════════════════════════════════════════════════════════════════

-- 1. Bucket privat. Ab hier greifen die Policies auch beim Lesen.
UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

-- 2. Bestandsnachrichten tragen nur die alte oeffentliche Adresse. Den Pfad
--    daraus einmalig nachziehen, damit die Policy unten nur ein Feld pruefen
--    muss und den Index nutzen kann.
UPDATE messages
SET attachment = jsonb_set(
      attachment, '{path}',
      to_jsonb(split_part(attachment->>'url', '/object/public/chat-attachments/', 2))
    )
WHERE attachment ? 'url'
  AND NOT (attachment ? 'path')
  AND attachment->>'url' LIKE '%/object/public/chat-attachments/%';

-- 3. Ohne Index laeuft die Policy bei jedem Dateizugriff ueber die ganze Tabelle.
CREATE INDEX IF NOT EXISTS messages_attachment_path_idx
  ON messages ((attachment->>'path'))
  WHERE attachment ? 'path';

-- 4. Die eigentliche Regel. Die Beteiligten-Pruefung spiegelt bewusst
--    msg_select_dm und msg_select_channel — wer die Nachricht sehen darf, darf
--    ihren Anhang sehen, und sonst niemand.
DROP POLICY IF EXISTS "chat_attach_read" ON storage.objects;
CREATE POLICY "chat_attach_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      -- eigener Ordner: immer
      (storage.foldername(name))[1] = auth.uid()::text
      -- oder: es gibt eine Nachricht mit diesem Anhang, die ich lesen darf
      OR EXISTS (
        SELECT 1 FROM messages m
        WHERE m.attachment->>'path' = storage.objects.name
          AND (
            (m.dm_thread IS NOT NULL AND (
                m.dm_thread LIKE auth.uid()::text || ':%' OR
                m.dm_thread LIKE '%:' || auth.uid()::text))
            OR (m.channel_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM channels c
                JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = auth.uid()
                WHERE c.id = m.channel_id))
          )
      )
    )
  );
