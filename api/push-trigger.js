import * as Sentry from "@sentry/node";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

if (process.env.SENTRY_DSN && !Sentry.getClient()) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, sendDefaultPii: false });
}

function report(err, extra) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, { extra });
  }
}

/**
 * Wird von einem Supabase Database Webhook aufgerufen (INSERT auf
 * friend_requests, künftig ggf. messages für DMs) — kein Browser-Origin,
 * daher kein checkOriginAndRate, sondern ein geteiltes Secret im Header.
 * V1-Scope bewusst klein: nur DMs + Freundschaftsanfragen (siehe Plan) —
 * Gruppennachrichten sind ein separater Fast-Follow (Fan-out + Spam-Risiko).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET || req.headers["x-webhook-secret"] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Push not fully configured" });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // Service-Role: bewusst voller DB-Zugriff (RLS umgangen), weil dieser
  // Endpoint für beliebige Empfänger nachschlagen muss, nicht im Kontext
  // eines eingeloggten Nutzers läuft. Niemals an den Client weitergeben.
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { table, record } = req.body || {};
    if (!table || !record) return res.status(400).json({ error: "Malformed webhook payload" });

    let recipientId, title, body, url, tag, muteKey = null;

    if (table === "friend_requests") {
      recipientId = record.to_user;
      const { data: fromProfile } = await supabase.from("profiles").select("username").eq("id", record.from_user).maybeSingle();
      title = "Neue Freundschaftsanfrage";
      body = `${fromProfile?.username || "Jemand"} möchte sich mit dir vernetzen.`;
      url = "/";
      tag = "friend-request";
    } else if (table === "messages" && record.dm_thread) {
      const [uidA, uidB] = record.dm_thread.split(":");
      recipientId = record.author_id === uidA ? uidB : uidA;
      const { data: fromProfile } = await supabase.from("profiles").select("username").eq("id", record.author_id).maybeSingle();
      const senderName = fromProfile?.username || "Jemand";
      title = senderName;
      body = (record.text || "").slice(0, 140);
      url = `/?dm=${encodeURIComponent(senderName)}`;
      tag = `dm-${senderName}`;
      muteKey = `dm/${senderName}`;
    } else {
      // Außerhalb des V1-Scopes (z.B. Gruppennachrichten) — kein Fehler, nur nichts zu tun.
      return res.status(200).json({ skipped: true });
    }

    if (!recipientId || recipientId === record.author_id) {
      return res.status(200).json({ skipped: true });
    }

    if (muteKey) {
      const { data: mute } = await supabase
        .from("notification_mutes")
        .select("until")
        .eq("user_id", recipientId)
        .eq("mute_key", muteKey)
        .maybeSingle();
      if (mute && (mute.until === null || new Date(mute.until) > new Date())) {
        return res.status(200).json({ skipped: true, reason: "muted" });
      }
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", recipientId);

    let sent = 0;
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url, tag })
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          report(err, { subId: sub.id });
        }
      }
    }

    return res.status(200).json({ sent });
  } catch (err) {
    report(err);
    return res.status(500).json({ error: err.message });
  }
}
