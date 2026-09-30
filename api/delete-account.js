import { createClient } from "@supabase/supabase-js";
import { checkOriginAndRate, requireUser, sendError, report } from "./_shared.js";

/**
 * Konto endgültig löschen (Art. 17 DSGVO).
 *
 * Vorher gab es diesen Endpoint nicht: src/js/auth.js meldete den Nutzer nur ab
 * und gab einen Fehler zurück, während die Oberfläche einen Knopf
 * "Konto endgültig löschen" anbot. Bestätigt, abgemeldet, Fehlermeldung — Konto
 * weiterhin da. Das ist der Zustand, den diese Datei beendet.
 *
 * WER gelöscht wird, steht ausschließlich im verifizierten Token (requireUser →
 * user.id). Es gibt bewusst keinen uid-Parameter im Body: der wäre ein
 * Löschknopf für fremde Konten hinter einem öffentlich erreichbaren Endpoint.
 *
 * Ablauf:
 *   1. Session prüfen (Anon-Key, RLS-Kontext des Nutzers) — Muster wie
 *      api/livekit-token.js.
 *   2. Storage aufräumen (Service-Role) — die ON-DELETE-CASCADE-Ketten in
 *      supabase/schema.sql räumen die Tabellen ab, den Bucket aber nicht.
 *   3. auth.users-Zeile löschen (Service-Role, Admin-API). Erst dadurch fallen
 *      profiles und über die Kaskade alle übrigen Zeilen.
 *
 * Der Service-Role-Key umgeht RLS vollständig und darf deshalb weder an den
 * Client gehen (nie mit VITE_-Prefix) noch in ein Log oder eine Fehlermeldung.
 */

const ATTACH_BUCKET = "chat-attachments";
const LIST_PAGE = 100;   // Supabase-Storage-Standard, wir paginieren selbst
const REMOVE_CHUNK = 100;

/**
 * Alle Objektpfade unterhalb von `prefix` einsammeln.
 *
 * Anhänge liegen flach unter <uid>/<timestamp>-<name> (community-api.js,
 * _prepareAttachment) — die Rekursion ist Vorsorge, falls dort später
 * Unterordner dazukommen. Ordner liefert Supabase als Platzhalterzeile ohne
 * `id`; nur echte Objekte bekommen einen Pfad.
 *
 * Wirft bei einem Listenfehler, statt eine unvollständige Liste zurückzugeben:
 * ein halb gelesener Bucket würde zu halb gelöschten Anhängen führen, und die
 * hätte danach niemand mehr zuordnen können.
 */
async function listAllPaths(supabase, prefix, depth = 0) {
  if (depth > 4) return [];
  const paths = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage.from(ATTACH_BUCKET).list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const full = `${prefix}/${entry.name}`;
      if (entry.id === null || entry.id === undefined) {
        paths.push(...(await listAllPaths(supabase, full, depth + 1)));
      } else {
        paths.push(full);
      }
    }

    if (data.length < LIST_PAGE) break;
    offset += data.length;
  }

  return paths;
}

export default async function handler(req, res) {
  if (checkOriginAndRate(req, res)) return;

  if (req.method !== "POST") {
    return sendError(res, 405, "method_not_allowed", "Method Not Allowed");
  }

  try {
    const auth = await requireUser(req);
    if (!auth) {
      const hasBearer = (req.headers.authorization || "").startsWith("Bearer ");
      return hasBearer
        ? sendError(res, 401, "invalid_session", "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an — dein Konto wurde nicht gelöscht.")
        : sendError(res, 401, "missing_token", "Bitte melde dich an, um dein Konto zu löschen.");
    }
    const uid = auth.user.id;

    // Konfigurationsprüfung hinter der Anmeldung — gleiche Begründung wie in
    // api/livekit-token.js. Lokal fehlt SUPABASE_SERVICE_ROLE_KEY in .env
    // (nur .env.example und Vercel haben ihn): dann sauber 500 mit klarer
    // Meldung, statt beim createClient() mit einem 500 ohne Body zu sterben.
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      report(new Error("delete-account: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured"));
      return sendError(
        res,
        500,
        "not_configured",
        "Konto-Löschung ist auf diesem Server nicht eingerichtet. Dein Konto wurde NICHT gelöscht."
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 1. Storage ────────────────────────────────────────────────
    // ZUERST die Dateien, DANN der Auth-User. Andersherum wäre der Bucket bei
    // einem Fehler nicht mehr aufräumbar: die Objekte liegen unter der uid,
    // aber es gäbe niemanden mehr, der die Löschung erneut auslösen könnte —
    // und der Bucket ist öffentlich lesbar (schema.sql). Schlägt hier etwas
    // fehl, bricht der Endpoint deshalb ab und lässt das Konto stehen: das ist
    // wiederholbar, ein verwaister öffentlicher Anhang nicht.
    let paths;
    try {
      paths = await listAllPaths(admin, uid);
      for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
        const { error } = await admin.storage
          .from(ATTACH_BUCKET)
          .remove(paths.slice(i, i + REMOVE_CHUNK));
        if (error) throw new Error(`storage remove failed: ${error.message}`);
      }
    } catch (err) {
      report(err, { step: "storage_cleanup", uid });
      return sendError(
        res,
        500,
        "storage_cleanup_failed",
        "Deine Anhänge konnten nicht gelöscht werden. Dein Konto wurde deshalb NICHT gelöscht — bitte versuche es später noch einmal."
      );
    }

    // ── 2. Auth-User ──────────────────────────────────────────────
    // Löst die Kaskade aus: auth.users → profiles → friendships,
    // friend_requests, blocks, ignores, group_members, group_rsvps, messages,
    // message_reports, user_reports, push_subscriptions, notification_mutes,
    // api_usage. Auch groups.created_by hängt an ON DELETE CASCADE — selbst
    // erstellte Gruppen verschwinden also samt Kanälen und allen Nachrichten
    // darin. Der Bestätigungstext im Client benennt das.
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) {
      report(new Error(`admin.deleteUser failed: ${delErr.message}`), { uid });
      return sendError(
        res,
        500,
        "delete_failed",
        "Dein Konto konnte nicht gelöscht werden. Bitte versuche es später noch einmal."
      );
    }

    return res.status(200).json({ ok: true, attachmentsRemoved: paths.length });
  } catch (err) {
    report(err);
    return sendError(res, 500, "server_error", "Konto-Löschung fehlgeschlagen.");
  }
}
