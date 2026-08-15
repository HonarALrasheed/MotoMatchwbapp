import * as Sentry from "@sentry/node";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";
import { checkOriginAndRate } from "./_shared.js";

if (process.env.SENTRY_DSN && !Sentry.getClient()) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, sendDefaultPii: false });
}

function report(err, extra) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, { extra });
  }
}

export default async function handler(req, res) {
  if (checkOriginAndRate(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(500).json({ error: "LIVEKIT_API_KEY/LIVEKIT_API_SECRET not configured" });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  try {
    const { roomId } = req.body || {};
    if (!roomId || typeof roomId !== "string") {
      return res.status(400).json({ error: "roomId required" });
    }

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!accessToken) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    // Client agiert im RLS-Kontext des anfragenden Nutzers (nicht Service-Role) —
    // dieselben Policies wie im Frontend gelten hier, kein privilegierter Zugriff.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Invalid session" });
    }
    const user = userData.user;

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.username) {
      return res.status(403).json({ error: "No profile" });
    }

    // vr_select-RLS (schema.sql) spiegeln: nur Mitglieder ODER offene Gruppen dürfen
    // den Raum überhaupt sehen — schlägt select fehl (0 Zeilen), ist der Zugriff verweigert.
    const { data: room, error: roomErr } = await supabase
      .from("voice_rooms")
      .select("id, group_id")
      .eq("id", roomId)
      .maybeSingle();
    if (roomErr || !room) {
      return res.status(403).json({ error: "Room not found or not accessible" });
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
    return res.status(500).json({ error: err.message });
  }
}
