import { AccessToken } from "livekit-server-sdk";
import { checkOriginAndRate, requireUser, sendError, report } from "./_shared.js";

/**
 * LiveKit-Zugangstoken für einen Sprachraum.
 *
 * Die `message` der Fehler hier landet ungefiltert im UI: src/js/voice.js
 * reicht sie an community.js weiter, das sie in einem Modal zeigt. Sie ist
 * deshalb auf Deutsch und für Menschen geschrieben. Der `code` daneben ist das,
 * woran der Client verzweigt — bei `missing_token`/`invalid_session` bietet das
 * Modal zusätzlich einen Anmelden-Knopf an.
 */
export default async function handler(req, res) {
  if (checkOriginAndRate(req, res)) return;

  if (req.method !== "POST") {
    return sendError(res, 405, "method_not_allowed", "Method Not Allowed");
  }

  try {
    // Auth zuerst, noch vor der roomId-Prüfung: ein Fremder soll nicht erst
    // erfahren, welche Raum-Kennungen gültig aussehen. requireUser() arbeitet
    // im RLS-Kontext des Nutzers (Anon-Key, nicht Service-Role) — die
    // Begründung dazu steht in api/_shared.js.
    const auth = await requireUser(req);
    if (!auth) {
      const hasBearer = (req.headers.authorization || "").startsWith("Bearer ");
      return hasBearer
        ? sendError(res, 401, "invalid_session", "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.")
        : sendError(res, 401, "missing_token", "Bitte melde dich an, um einem Talk beizutreten.");
    }
    const { user, supabase } = auth;

    // Konfigurationsprüfung hinter der Anmeldung — so kann niemand von außen
    // abfragen, ob der Dienst überhaupt Schlüssel hinterlegt hat.
    const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
    const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      report(new Error("LIVEKIT_API_KEY/LIVEKIT_API_SECRET not configured"));
      return sendError(res, 500, "not_configured", "Sprachchat ist noch nicht konfiguriert.");
    }

    const { roomId } = req.body || {};
    if (!roomId || typeof roomId !== "string") {
      return sendError(res, 400, "invalid_room", "Kein Raum angegeben.");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.username) {
      return sendError(res, 403, "no_profile", "Für dieses Konto gibt es kein Profil.");
    }

    // Direktanruf zwischen zwei Freunden: Die Raum-ID trägt beide Beteiligten,
    // aufsteigend sortiert — genauso wie friendships (user_a < user_b). Es gibt
    // dafür bewusst keine Zeile in voice_rooms: der Raum existiert nur, solange
    // telefoniert wird. Zugriff bekommt deshalb nur, wer selbst in der ID steht
    // UND mit dem anderen befreundet ist. Blockieren löst die Freundschaft
    // (removeFriendPair in toggleBlock), damit fällt auch der Anruf-Zugang weg.
    // Präfix bewusst nur klein (der Client erzeugt ausschließlich "dm:"), und
    // echte uuid-Form statt bloß 36 erlaubter Zeichen: sonst gäbe es für
    // dasselbe Paar mehrere gültige Raumnamen, und Zeichenfolgen wie "------…"
    // liefen als kaputte uuid in die Datenbankabfrage.
    const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    const dmMatch = new RegExp(`^dm:(${UUID}):(${UUID})$`).exec(roomId);
    if (dmMatch) {
      const [, first, second] = dmMatch.map(s => (s || "").toLowerCase());
      if (first >= second) {
        return sendError(res, 400, "invalid_room", "Ungültige Raum-Kennung.");
      }
      if (user.id !== first && user.id !== second) {
        return sendError(res, 403, "not_participant", "Du gehörst nicht zu diesem Anruf.");
      }
      const { data: friendship } = await supabase
        .from("friendships")
        .select("id")
        .eq("user_a", first)
        .eq("user_b", second)
        .maybeSingle();
      if (!friendship) {
        return sendError(res, 403, "not_friends", "Ihr seid nicht (mehr) befreundet.");
      }
    } else {
      // vr_select-RLS (schema.sql) spiegeln: nur Mitglieder ODER offene Gruppen dürfen
      // den Raum überhaupt sehen — schlägt select fehl (0 Zeilen), ist der Zugriff verweigert.
      const { data: room, error: roomErr } = await supabase
        .from("voice_rooms")
        .select("id, group_id")
        .eq("id", roomId)
        .maybeSingle();
      if (roomErr || !room) {
        return sendError(res, 403, "room_forbidden", "Dieser Talk existiert nicht oder ist für dich nicht offen.");
      }
    }

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      name: profile.username,
      ttl: "6h",
    });
    token.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();
    return res.status(200).json({ token: jwt });
  } catch (err) {
    report(err);
    return sendError(res, 500, "server_error", "Talk-Zugang fehlgeschlagen.");
  }
}
