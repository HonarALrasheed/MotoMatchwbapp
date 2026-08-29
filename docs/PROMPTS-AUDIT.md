# MotoMatch — Audit-Prompts für Claude Code

> **Diese Datei = die Abarbeitung des Audits vom 27./28.08.2026.** 15 Prompts,
> ~5–8 Arbeitstage. Nach A1–A8 ist die Beta rechtlich und sicherheitstechnisch
> startfähig; A9–A15 sind das, was sonst bei den ersten echten Nutzern hochkommt.
>
> **Grundlage:** [`AUDIT-REPORT.md`](../AUDIT-REPORT.md) (Befunde mit Fundstellen)
> und [`BACKLOG.md`](../BACKLOG.md) (nummerierte Arbeitsliste). Jeder Prompt nennt
> die zugehörigen Backlog-Nummern — bei Rückfragen dort nachschlagen.
>
> **Verhältnis zu den alten Prompt-Dateien:** [`PROMPTS.md`](PROMPTS.md) war der
> Plan *vor* dem Audit. Sechs Aufgaben daraus sind nachweislich nicht (oder nicht
> zu Ende) erledigt worden — die Audit-Prompts ersetzen sie und sagen jeweils,
> welche. [`PROMPTS-POST-LAUNCH.md`](PROMPTS-POST-LAUNCH.md) bleibt unberührt.
>
> Jeder Prompt ist **self-contained** — du kannst ihn in eine frische Session
> pasten, ohne dass Claude Vorwissen aus einer alten Session braucht.
>
> **Wie benutzen:**
> 1. Neue Claude-Code-Session im Projektroot `/Volumes/Untitled/MotoMatch/moto-match`
> 2. Prompt komplett kopieren und einfügen
> 3. Claude zuerst lesen lassen, dann arbeiten lassen
> 4. Am Ende: `git status` → committen → nächster Prompt
>
> **Vor jedem Prompt selbst prüfen:** `git status` sauber? Wenn nicht, erst A1.

---

## Das machst du selbst — kein Claude Code

Drei Dinge kann Claude nicht für dich erledigen, und zwei davon gehören **vor** A1:

**1. Datenbank sichern (15 Min., vor A3).**
Supabase-Dashboard → *Database → Backups* prüfen. Im Free-Plan gibt es keine
automatischen Sicherungen. Falls keine da ist:
```bash
npx supabase db dump --db-url "<deine-connection-string>" -f backup-$(date +%F).sql
```
Datei außerhalb des Repos ablegen. A3, A4, A11 und A15 ändern Policies — ohne
Sicherung ist jeder Fehler dort endgültig.

**2. Ausgabenlimits setzen (15 Min., sofort).**
Harte Monatslimits in den Dashboards von **OpenAI**, **Tavily**, **LiveKit** und
**Google Cloud**. Befund 4.3 im Report: der Origin-Check der API-Endpunkte lässt
sich mit einem einzigen zusätzlichen HTTP-Header umgehen — das wurde live
reproduziert. A6 schließt das, aber die Limits greifen auch dann noch, wenn A6
sich verzögert oder etwas übersehen wird.

**3. Deine Impressumsdaten zusammenstellen (vor A8).**
Name, Anschrift, E-Mail, ggf. USt-ID und Registereintrag. Claude kann die Seite
bauen, aber die Angaben kommen von dir. Bis dahin steht dort
`[Name des Betreibers]`.

---

## A1 — Repository deploybar machen

> Backlog #3 · Befund 10.1 · **ersetzt T0.1 aus PROMPTS.md** (dort waren es 16
> uncommittete Dateien, inzwischen sind es 29 und vier davon werden importiert)

```
Wir arbeiten am MotoMatch-Projekt (Vanilla JS + Vite 5 + Supabase, siehe CLAUDE.md).
Ein technisches Audit hat ergeben: das Repository ist aktuell nicht deploybar.

Das Problem: `src/js/app.js` importiert in den Zeilen 5-8 vier Module, die nicht
unter Versionskontrolle stehen — nav.js, swipe.js, viewport.js, install.js. Dazu
kommen sechs weitere untrackte Dateien, die zur Laufzeit gebraucht werden
(stickers.js, match-history.js, manifest.webmanifest, icon-192.png, icon-512.png,
apple-touch-icon.png) und 19 modifizierte Dateien, darunter supabase/schema.sql.
Ein `git clone` gefolgt von `npm run build` scheitert deshalb mit
"Failed to resolve import".

Aufgabe: alles committen, sauber gebündelt, und danach beweisen dass ein frischer
Clone baut.

Schritte:
1. `git status` und `git diff --stat` durchgehen. Mir eine Übersicht geben: welche
   Änderung steckt in welcher Datei, und wie würdest du sie thematisch bündeln?
   Erwartete Gruppen ungefähr: (a) PWA/Installation — manifest, icons, install.js,
   sw.js, index.html; (b) Navigation — nav.js, swipe.js, viewport.js, app.js;
   (c) Sticker — stickers.js, community.js; (d) Match-Chronik — match-history.js,
   garage.js, bike-detail.js; (e) Schema — supabase/schema.sql; (f) Rest.
2. Mich pro Commit-Vorschlag um Bestätigung fragen, bevor du `git add`/`git commit`
   ausführst. Commit-Messages im Conventional-Commits-Stil.
3. Nach allen Commits einen echten Beweis erbringen:
   `git clone . /tmp/mm-clean && cd /tmp/mm-clean && npm ci && npm run build`
   Wenn das scheitert: herausfinden welche Datei noch fehlt, nachziehen, wiederholen.
   Erst wenn der Build im frischen Clone durchläuft, ist die Aufgabe erledigt.
4. Mir sagen, auf welchem Branch wir sind und ob der zu Vercel passt. Aktuell steht
   HEAD auf `fix/vercel-lfs`, es gibt außerdem `main` und `deploy/karte-sidebar-batch`.
   Das Vercel-Projekt heißt `moto-matchwbapp`. Du kannst `npx vercel project ls`
   und `npx vercel ls` benutzen (die CLI ist angemeldet) — nur lesend.
5. `git push` erst nach meiner ausdrücklichen Bestätigung.

Wichtig:
- KEIN `git commit --amend`, KEIN Rebase, KEIN Force-Push.
- KEINE .env-Dateien staggen. Vor jedem Commit prüfen, dass keine Secrets drin sind.
- `.gitattributes` deklariert `*.glb filter=lfs`, aber `git lfs ls-files` ist leer.
  Nicht anfassen, nur erwähnen falls dir beim Commit etwas dazu auffällt.
- Die 19 modifizierten Dateien nicht "aufräumen" oder umformatieren — nur committen,
  wie sie sind. Inhaltliche Änderungen kommen in späteren Prompts.

Definition of Done: `git status` sagt "nothing to commit, working tree clean";
`npm run build` läuft in /tmp/mm-clean mit exit 0 durch; ich weiß, welcher Branch
nach Vercel deployt.
```

---

## A2 — Erfundene Händler und Inserate entfernen

> Backlog #4, #5 · Befunde 9.1, 16.4 · **höchste Dringlichkeit nach A1** —
> das ist produktiv sichtbar

```
MotoMatch-Projekt (Vanilla JS + Vite + Supabase). Ein Audit hat zwei Datensätze
gefunden, die Nutzern als echt präsentiert werden, es aber nicht sind. Beides sind
aktive Rückfallebenen, keine Testdaten.

1. `src/js/dealers.js` — 40 erfundene Werkstätten, Händler und Fahrschulen mit
   Namen und Koordinaten. Nachrecherchiert: "Zweirad Hölscher" (Zeile 3-10) ist in
   Wahrheit ein Fahrrad- und E-Bike-Laden in Ascheberg, keine Motorradwerkstatt in
   Lüdinghausen. "Harley-Davidson Münster" (Zeile 68-74) existiert nicht — der
   Vertragshändler sitzt in Telgte. Angezeigt wird die Liste über
   `renderDealerFallbackList()` in `src/js/garage.js:1417`, aufgerufen aus dem
   catch-Block in `garage.js:1406-1414`, wenn Google Maps nicht lädt.
2. `src/js/marketplace.js:13-274` — 30 erfundene Gebrauchtmarkt-Inserate mit
   Preisen, Kilometerständen und "vor 2 Tagen". Angezeigt über
   `getStaticListings()`, gerendert im catch-Block `garage.js:798-813`, wenn die
   Tavily-Suche nichts liefert.

Lies zuerst: src/js/dealers.js, src/js/marketplace.js, src/js/garage.js
(insbesondere 760-830 und 1390-1450), src/js/bike-detail.js:2570-2600.

Aufgabe: beide Rückfallebenen durch ehrliche Leerzustände ersetzen und die
erfundenen Daten löschen.

Schritte:
1. Marktplatz: im catch-Block von `garage.js` statt `staticItems` einen Hinweis
   rendern — "Aktuell keine Angebote abrufbar" plus die drei Suchlinks, die es
   in `buildSearchUrls()` schon gibt (Kleinanzeigen, mobile.de, eBay). Die Links
   werden in `garage.js:777-781` bereits gebaut, du kannst sie wiederverwenden.
2. `getStaticListings()` und das `listings`-Objekt aus marketplace.js entfernen.
   `getLiveListings()` und `buildSearchUrls()` bleiben. Alle Aufrufstellen anpassen.
3. Karte: `renderDealerFallbackList()` so umbauen, dass sie keine erfundenen
   Betriebe mehr zeigt, sondern erklärt, dass die Karte gerade nicht geladen werden
   konnte. Der Text für "keine Ergebnisse" existiert schon in `garage.js:1428-1433`
   — daran orientieren, aber die Ursache ehrlich benennen (Karte nicht verfügbar,
   nicht "keine Ergebnisse in der Nähe").
4. `src/js/dealers.js` komplett löschen, den Import in `garage.js:32` entfernen,
   `FILTER_TO_DEALER_TYPE` prüfen — wenn es nur noch für dealers.js gebraucht wurde,
   auch weg.
5. `npm run build` muss durchlaufen. Danach `npm run dev` starten und mir zeigen,
   wie die beiden Leerzustände aussehen (Screenshot oder Beschreibung).

Wichtig:
- Nichts "ersetzen durch bessere Beispieldaten". Erfundene Betriebe und Preise sind
  genau das Problem, egal wie plausibel sie klingen.
- Die Google-Places-Suche (der Normalfall) nicht anfassen — die liefert echte Daten.
- Falls dir beim Lesen weitere Stellen mit erfundenen Daten auffallen: sammeln und
  mir am Ende nennen, nicht ungefragt mitändern.

Definition of Done: `grep -rn "dealers" src/` findet nichts mehr; marketplace.js
enthält keine hartcodierten Inserate; Build läuft; beide Fehlerfälle zeigen einen
ehrlichen Text mit Weg nach vorn.
```

**Direkt danach selbst erledigen (2 Min.):** `VITE_GMAPS_KEY` in Vercel setzen —
er fehlt dort, weshalb die Karte produktiv gar nicht lädt und der Fallback
überhaupt greift. In der Google Cloud Console per HTTP-Referrer auf deine Domain
beschränken, sonst ist der Key im Bundle für jeden nutzbar.

---

## A3 — RLS härten, Teil 1: E-Mail-Preisgabe und fremde DMs

> Backlog #6, #7 · Befunde 3.1, 3.2 · **Backup vorher ziehen**

```
MotoMatch-Projekt, Supabase-Backend. Ein Sicherheitsaudit hat zwei Row-Level-
Security-Policies gefunden, die nicht halten, was das UI verspricht.

Lies zuerst vollständig: supabase/schema.sql, dann src/js/auth.js (v. a. login()
ab Zeile 297) und src/js/community-api.js (v. a. sendDM ab 1476, canSendDM ab 1468).

BEFUND 1 — schema.sql:410-423, Funktion email_for_username():
Sie ist SECURITY DEFINER, liest auth.users, vergleicht mit `p.username ILIKE uname`
und ist per GRANT an die Rolle `anon` freigegeben. ILIKE behandelt % als Platzhalter.
Ein anonymer Aufruf mit uname='%' liefert also eine fremde E-Mail-Adresse; mit
'a%', 'b%' usw. lässt sich der Bestand abklappern. Der Anon-Key steht im Client-Bundle.

BEFUND 2 — schema.sql:281-282, Policy msg_insert_dm:
  WITH CHECK (author_id = auth.uid() AND dm_thread IS NOT NULL)
Geprüft wird nur WER schreibt, nicht WOHIN. dm_thread ist ein freier String
"uidA:uidB" und muss auth.uid() nicht enthalten. Jeder Angemeldete kann also in
jeden fremden DM-Thread schreiben. Dadurch sind zugleich das Blockieren
(community-api.js:1497, eine einzige Client-Zeile) und dm_policy
(community-api.js:1468-1473) wirkungslos. Dieselbe fehlende Prüfung hat
msg_update (schema.sql:283-288) — dort kann ein Autor sein dm_thread nachträglich
auf einen fremden Thread umschreiben.

Aufgabe: beide Policies reparieren, als wiederholbar ausführbares SQL-Skript.

Schritte:
1. Mir zuerst den geplanten SQL-Text zeigen und erklären, bevor du irgendetwas
   ausführst oder in eine Datei schreibst.
2. email_for_username: ILIKE durch exakten, case-insensitiven Vergleich ersetzen
   (`lower(p.username) = lower(uname)`). Das GRANT an anon MUSS bleiben — der
   Login-Bildschirm braucht die Funktion, bevor jemand angemeldet ist. Der Schutz
   liegt im exakten Match, nicht im Entzug der Rechte.
3. msg_insert_dm: zusätzlich erzwingen, dass auth.uid() in dm_thread vorkommt.
   Dieselbe LIKE-Logik wie in der Lese-Policy msg_select_dm (schema.sql:266-272)
   verwenden, damit beide Seiten konsistent sind. Zusätzlich prüfen, dass der
   Empfänger den Absender nicht blockiert hat (Tabelle `blocks`).
4. msg_update: ein WITH CHECK ergänzen, das dieselbe Teilnahme verlangt.
5. Alles als DROP POLICY IF EXISTS + CREATE POLICY schreiben, damit das Skript
   mehrfach laufen kann. In supabase/schema.sql an der jeweils richtigen Stelle
   ersetzen, NICHT unten anhängen.
6. Mir eine Prüfanleitung geben: wie ich mit zwei Testkonten nachweise, dass
   (a) ein anonymer RPC-Aufruf mit '%' jetzt nichts mehr liefert, (b) Konto C nicht
   mehr in den Thread von A und B schreiben kann. Als konkrete curl- oder
   supabase-js-Schnipsel, die ich ausführen kann.

Wichtig:
- KEIN DROP TABLE, KEIN DELETE FROM, KEIN TRUNCATE. Nur Policies und die eine
  Funktion.
- Das SQL NICHT selbst gegen die Datenbank ausführen — ich spiele es im
  Supabase-SQL-Editor ein, nachdem ich es gelesen habe.
- Prüfen, ob durch die neue msg_insert_dm-Policy ein legitimer Ablauf kaputtgeht:
  geh sendDM() in community-api.js:1476-1522 durch und sag mir, ob der dort gebaute
  thread-String die neue Bedingung erfüllt.
- Wenn dir beim Lesen von schema.sql weitere Policies auffallen, die zu weit sind:
  notieren und mir nennen. Nicht mitändern — Gruppen und Invites kommen in A4.

Definition of Done: geänderter Abschnitt in supabase/schema.sql, idempotent
ausführbar; ich habe eine Prüfanleitung mit zwei Testkonten; du hast mir bestätigt,
dass sendDM() weiterhin funktioniert.
```

---

## A4 — RLS härten, Teil 2: Gruppenbeitritt und Einladungen

> Backlog #8, #9 · Befunde 3.3, 3.4 · setzt A3 voraus

```
MotoMatch-Projekt, Supabase. Fortsetzung der RLS-Härtung aus A3. Zwei weitere
Policies erlauben, was das UI verhindert.

Lies zuerst: supabase/schema.sql (v. a. 91-160 groups/group_members, 302-346
join_requests/invites) und src/js/community-api.js (joinGroup ab 1023, redeemInvite
ab 1400, _loadInvites ab 348, sendJoinRequest ab 1327, banMember ab 1055).

BEFUND 1 — schema.sql:144-149:
  CREATE POLICY "gm_insert" ON group_members FOR INSERT WITH CHECK (user_id = auth.uid());
  CREATE POLICY "gm_insert_mod" ON group_members FOR INSERT WITH CHECK (EXISTS (... role IN ('owner','mod')));
Postgres verknüpft mehrere permissive INSERT-Policies mit ODER. gm_insert allein
genügt also — "ich trage mich selbst ein" ist immer erlaubt. Weder groups.join_mode
('open'|'request'|'invite') noch group_bans kommen in irgendeiner Policy vor. Die
einzige Prüfung steht in community-api.js:1026-1027, also im Browser. Ergebnis:
invite-only-Gruppen sind offen, Sperren wirkungslos, der ganze
group_join_requests-Ablauf ist Zierde. Gruppen-IDs sind auch nicht geheim, weil
groups_select_public (Zeile 103) alle Gruppen listet.

BEFUND 2 — schema.sql:335 und 341:
  CREATE POLICY "invites_select" ON invites FOR SELECT USING (true);
  CREATE POLICY "invites_update" ON invites FOR UPDATE USING (true);
Jeder — auch anon — liest alle Einladungscodes aller Gruppen und darf sie ändern
(bei UPDATE ohne WITH CHECK gilt der USING-Ausdruck auch für die neue Zeile).
Der Client lädt sie sogar aktiv: community-api.js:349 macht select('*') auf invites
beim App-Start. redeemInvite (1400-1418) zählt `uses` im Browser hoch — zwei
gleichzeitige Einlösungen zählen einmal.

Aufgabe: Beitritt und Einladungen serverseitig durchsetzen.

Schritte:
1. Zuerst den Plan zeigen, dann erst schreiben.
2. gm_insert ersetzen: Selbst-Eintrag nur noch für Gruppen mit join_mode='open',
   nur mit role='member', und nur wenn kein group_bans-Eintrag existiert.
   gm_insert_mod bleibt für das Hinzufügen durch Owner/Mods.
3. Für join_mode 'request' und 'invite' geht der Selbst-Eintrag dann nicht mehr —
   das ist gewollt. Stattdessen zwei SECURITY-DEFINER-Funktionen bauen:
   - `accept_join_request(request_id uuid)` — prüft, dass der Aufrufer Owner/Mod
     der Gruppe ist, legt die Mitgliedschaft an, löscht die Anfrage. Atomar.
   - `redeem_invite(invite_code text)` — prüft Existenz, Ablauf, max_uses, Bann und
     bestehende Mitgliedschaft, erhöht `uses` atomar (UPDATE ... SET uses = uses + 1
     ... RETURNING, nicht im Client rechnen), legt die Mitgliedschaft an. Gibt die
     group_id zurück oder eine sprechende Fehlerkennung.
4. invites_select auf Owner/Mods der jeweiligen Gruppe einschränken, invites_update
   entfernen (die RPC macht das jetzt mit Definer-Rechten).
5. Client anpassen: `_loadInvites()` in community-api.js:348 lädt dann nur noch die
   eigenen; `redeemInvite()` ruft die RPC statt select+insert+update;
   `acceptGroupRequest()` (1348) ruft die RPC. Die Rückgabewerte der Funktionen
   müssen zu dem passen, was das UI in community.js erwartet — das bitte prüfen,
   nicht raten.
6. Prüfanleitung mit zwei Testkonten: Konto B kann einer invite-only-Gruppe von
   Konto A nicht mehr beitreten; ein gesperrtes Konto kommt nicht zurück; Konto B
   sieht die Invite-Codes von A nicht mehr.

Wichtig:
- KEIN DROP TABLE, KEIN DELETE FROM. Nur Policies und neue Funktionen.
- SQL nicht selbst ausführen — ich spiele es ein.
- SECURITY DEFINER immer mit `SET search_path = public` (wie bei
  email_for_username in Zeile 414 vorgemacht).
- redeemInvite hat im Offline-Modus einen eigenen Zweig (community-api.js:1414).
  Der muss weiter funktionieren — der Demo-Modus hat kein Supabase.

Definition of Done: geänderte Policies + zwei neue Funktionen in
supabase/schema.sql, idempotent; Client ruft die RPCs; Build läuft; ich habe eine
Prüfanleitung.
```

---

## A5 — Stored XSS in der Community schließen

> Backlog #10, #11 · Befunde 4.1, 4.2

```
MotoMatch-Projekt. Ein Audit hat eine Stored-XSS-Lücke an 20 Render-Stellen
gefunden. Weil die Supabase-Session per persistSession in localStorage liegt
(src/js/supabase.js:18), bedeutet Codeausführung hier Kontoübernahme.

Lies zuerst: src/js/util.js (die esc()-Funktion), src/js/community.js Zeilen
100-120 und 890-920 und 1170-1200, sowie supabase/schema.sql Zeilen 8-31.

BEFUND 1 — community.js:104-107:
  function avatarColor(username) {
    const p = getProfile(username)
    return p.avatarColor || colorFor(username)
  }
p.avatarColor kommt aus der Spalte profiles.avatar_color. Die ist `text` ohne
CHECK, und profiles_update (schema.sql:27) erlaubt jedem, die eigene Zeile zu
ändern — über die REST-API direkt, das UI mit seinen Farbfeldern ist keine Grenze.
Der Wert wird an 20 Stellen OHNE esc() in ein style-Attribut geschrieben, z. B.
community.js:900:
  style="background:${avatarColor(msg.author)}"
Mit avatar_color = `red" onmouseover="..." x="` bricht das aus dem Attribut aus.
Alle 20 Zeilen: 900, 1030, 1476, 1740, 2431, 2555, 2573, 2614, 2715, 3474, 3720,
3790, 4014, 4029, 4051, 4070, 4563, 4755, 4812, 4954.

BEFUND 2 — community.js:1190, in attachmentHtml():
  <a class="mmc-msg-file" href="${esc(att.url)}" download="${esc(name)}">
esc() maskiert < > & " ' — aber kein URL-Schema. att.url stammt aus der
jsonb-Spalte messages.attachment, deren Inhalt keine Policy prüft. Ein Absender
kann {"url":"javascript:...","name":"Rechnung.pdf"} einfügen; die Datei-Karte
sieht harmlos aus.

Aufgabe: beide Lücken schließen, an der Wurzel statt an den Symptomen.

Schritte:
1. avatarColor() in community.js:104 so umbauen, dass sie nur noch gültige
   Farbwerte durchlässt und sonst auf colorFor(username) zurückfällt. Erlaubt sein
   sollen die Formate, die die App selbst erzeugt: die hsl()-Werte aus
   AVATAR_PALETTE (community.js:81-86) und colorFor() (395-399), plus Hex.
   Alles andere wird verworfen. Damit müssen die 20 Aufrufstellen NICHT einzeln
   angefasst werden — bitte trotzdem einmal durchgehen und bestätigen, dass keine
   andere unescapte Nutzereingabe in einem style-Attribut landet.
2. In util.js eine Schwesterfunktion zu esc() ergänzen — z. B. safeUrl(url) — die
   nur http:, https: und data:image/ durchlässt und sonst null liefert.
3. attachmentHtml() (community.js:1174-1198) auf safeUrl() umstellen: liefert sie
   null, den Anhang gar nicht rendern. Betrifft alle drei Zweige (Sticker, Bild,
   Datei-Karte).
4. Prüfen, ob es weitere Stellen gibt, an denen eine URL aus der Datenbank in ein
   href oder src geht — insbesondere in community.js, bike-detail.js und account.js.
   Gefundene Stellen mir nennen; die offensichtlichen (gleiches Muster) mitfixen,
   bei unklaren Fällen fragen.
5. Zusätzlich das Schema absichern, damit die Lücke nicht über einen anderen
   Render-Pfad zurückkommt — als SQL für supabase/schema.sql:
   ALTER TABLE profiles ADD CONSTRAINT avatar_color_fmt
     CHECK (avatar_color IS NULL OR avatar_color ~ '...');
   Muster so wählen, dass die von der App erzeugten Werte durchgehen.
   WICHTIG: vorher ein SELECT mitgeben, mit dem ich prüfe, ob bereits Zeilen
   existieren, die das Constraint verletzen würden — sonst schlägt das ALTER fehl.
6. Einen kleinen Node-Check schreiben (nicht ins Repo, nach /tmp), der die
   Ausgabe der neuen avatarColor() und safeUrl() mit den Angriffs-Nutzlasten
   oben zeigt. Ich will das Vorher/Nachher sehen.

Wichtig:
- Nicht einfach esc() um avatarColor() legen und fertig — das würde zwar den
  Ausbruch verhindern, aber kaputte style-Werte erzeugen. Whitelist ist richtig.
- esc() in util.js NICHT verändern; sie wird an über hundert Stellen für Text
  benutzt und ist dafür korrekt. Nur ergänzen.
- Es gibt drei lokale Kopien von esc() (auth.js:564, feedback.js:25,
  landing.js:24). Die nicht anfassen, das ist A12.

Definition of Done: avatarColor() lässt nur Farbwerte durch; attachmentHtml()
rendert keine javascript:-URLs mehr; SQL-Constraint samt Vorab-SELECT liegt bereit;
Build läuft; ich habe den Vorher/Nachher-Vergleich gesehen.
```

---

## A6 — Serverless-Endpunkte absichern

> Backlog #12, #31, #53 · Befunde 4.3, 4.4, 4.5, 5.1 · **ersetzt T0.3 aus PROMPTS.md**

```
MotoMatch-Projekt, Vercel Serverless Functions in api/. Ein Audit hat gezeigt,
dass der Schutz vor den kostenpflichtigen Upstream-APIs nicht hält.

Lies zuerst vollständig: api/_shared.js, api/ai-match.js, api/search-places.js,
api/livekit-token.js (das ist die Vorlage — dort ist es richtig gemacht),
src/js/ai.js, src/js/marketplace.js.

BEFUND — api/_shared.js hat zwei unabhängige Löcher:
1. Zeile 27-32 prüft den Origin-Header gegen ALLOWED_ORIGINS. Der Header ist
   Browser-Konvention, kein Sicherheitsmerkmal — jeder andere HTTP-Client setzt ihn
   frei. LIVE REPRODUZIERT gegen den Dev-Server:
     curl -X POST .../api/ai-match -d '{}'                        -> 403
     curl -X POST .../api/ai-match -H 'Origin: <erlaubt>' -d '{"answers":{},"bike":{}}'
                                                                  -> 200, echter OpenAI-Call
2. Zeile 4: `const hits = new Map()` als Rate-Limit-Speicher. Auf Vercel hat jede
   Lambda-Instanz ihren eigenen Speicher, Instanzen skalieren und werden kalt
   gestartet. Das Limit von 10/Minute gilt pro Instanz, nicht pro IP.

Zusätzlich: api/ai-match.js:27 destrukturiert `const { answers, bike } = req.body`
ohne jede Validierung und interpoliert die Felder direkt in den Prompt (Zeile 29-40).
Unbegrenzte Eingabelänge = unbegrenzte Token-Kosten, dazu Prompt-Injection.
api/search-places.js:27 hat dasselbe mit bikeName.
Und api/ai-match.js:66 reicht den rohen OpenAI-Fehlertext an den Client durch.

Aufgabe: beide Endpunkte auf das Muster von livekit-token.js heben.

Schritte:
1. api/livekit-token.js Zeile 41-56 ansehen — dort wird der Bearer-Token gegen
   Supabase geprüft und bewusst mit dem Anon-Key im RLS-Kontext des Nutzers
   gearbeitet. Dieses Muster in _shared.js als wiederverwendbare Funktion
   herausziehen, z. B. `requireUser(req)` -> { user } | null.
2. ai-match und search-places darauf umstellen: ohne gültige Session 401. Die
   Aufrufer im Client (src/js/ai.js:35, src/js/marketplace.js:298) müssen dann den
   Authorization-Header mitschicken — so wie voice.js:71-75 es bereits macht.
   Beide Aufrufer anpassen.
3. Den Origin-Check behalten (schadet nicht), aber im Kommentar klarstellen, dass er
   kein Schutz ist, sondern nur Versehen abfängt.
4. Rate-Limit persistent machen, pro Nutzer statt pro IP. Vorschlag: eine Tabelle
   `api_usage (user_id uuid, day date, endpoint text, count int, PRIMARY KEY (user_id, day, endpoint))`
   mit einer SECURITY-DEFINER-Funktion `bump_api_usage(endpoint text, limit int)`,
   die hochzählt und true/false zurückgibt. Das SQL mir zeigen, nicht ausführen.
   Sinnvolles Tageslimit vorschlagen (Größenordnung: das Quiz macht 1 Aufruf pro
   Durchlauf).
5. Eingabevalidierung in beiden Endpunkten: jedes Feld auf Typ prüfen und auf eine
   vernünftige Länge kürzen, bevor es in den Prompt oder die Query geht. Fehlt ein
   Pflichtfeld: 400 mit sprechender Meldung statt TypeError.
6. Fehlerausgabe vereinheitlichen: nach außen nur eine allgemeine Meldung, das
   Detail über die bereits vorhandene report()-Funktion an Sentry. Ein gemeinsames
   Format { error: { code, message } } für alle vier Endpunkte.
7. Am Ende: den curl-Test von oben gegen den lokalen Dev-Server wiederholen und mir
   zeigen, dass er jetzt 401 statt 200 liefert.

Wichtig:
- api/livekit-token.js inhaltlich NICHT verändern — nur die gemeinsame Logik
  herausziehen, wenn das ohne Verhaltensänderung geht. Im Zweifel dort alles lassen
  und in _shared.js eine zweite Funktion bauen.
- api/push-trigger.js hat bewusst KEINEN Origin-Check (es wird von einem
  Supabase-Webhook aufgerufen, nicht aus dem Browser — siehe Kommentar Zeile 16-18).
  Nicht "vereinheitlichen".
- Keine echten Aufrufe an OpenAI oder Tavily zum Testen machen. Der 401-Fall
  reicht als Nachweis, der kostet nichts.

Definition of Done: beide Endpunkte verlangen eine gültige Session; Client schickt
den Token; Eingaben werden validiert und gekürzt; SQL für das persistente Limit
liegt bereit; der curl-Bypass von oben liefert 401.
```

---

## A7 — Kontolöschung und Datenauskunft

> Backlog #13, #16 · Befunde 3.5, 16.5

```
MotoMatch-Projekt. Zwei DSGVO-Pflichten sind technisch nicht erfüllbar, und die
Oberfläche behauptet bei einer davon das Gegenteil.

Lies zuerst: src/js/auth.js (deleteAccount ab 535), src/js/account.js (der
Gefahrenzone-Block ab 1818 und wireSettings ab 1930, Export/Import 1968-2002),
api/livekit-token.js (als Vorlage für einen authentifizierten Endpunkt),
api/push-trigger.js (als Vorlage für Service-Role-Nutzung), supabase/schema.sql
(die ON DELETE CASCADE-Ketten).

BEFUND 1 — auth.js:535-544: deleteAccount() ist online nicht implementiert. Sie
meldet den Nutzer ab und gibt einen Fehler zurück. In account.js:1823-1824 steht
trotzdem ein Knopf "Konto endgültig löschen" mit dem Hinweis "Löscht dein Konto
unwiderruflich". Der Nutzer bestätigt, wird abgemeldet, sieht eine Fehlermeldung —
und sein Konto existiert weiter.

BEFUND 2 — Auskunft (Art. 15 DSGVO) ist nicht möglich. Der Export in
account.js:1968-1982 erfasst nur localStorage-Schlüssel mit mm_-Präfix, also weder
Nachrichten noch Gruppen, Freundschaften, Meldungen oder Feedback aus Supabase.

Aufgabe: beides bauen.

Schritte:
1. Neuen Endpunkt api/delete-account.js: Bearer-Token gegen Supabase prüfen (Muster
   livekit-token.js:41-56), dann mit dem Service-Role-Key
   supabase.auth.admin.deleteUser(uid). SUPABASE_SERVICE_ROLE_KEY ist in Vercel
   bereits gesetzt; lokal fehlt er in .env — bau den Endpunkt so, dass er ohne Key
   sauber 500 mit klarer Meldung liefert statt zu crashen.
2. Vor dem Löschen des Auth-Users die Storage-Objekte des Nutzers aufräumen: der
   Bucket 'chat-attachments' speichert unter <uid>/... (siehe schema.sql:235 und
   community-api.js:1200). Die CASCADE-Ketten im Schema räumen die Tabellen ab, aber
   nicht den Storage.
3. auth.js:deleteAccount() auf den Endpunkt umstellen. Erfolgsfall: abmelden,
   { ok: true }. Fehlerfall: ehrliche Meldung, NICHT abmelden (aktuell wird auch im
   Fehlerfall abgemeldet, das ist der schlechteste Zustand).
4. account.js:1930-1936 anpassen: der Bestätigungstext soll benennen, was gelöscht
   wird — Konto, Profil, Nachrichten, Gruppenmitgliedschaften, Anhänge. Und dass es
   nicht rückgängig zu machen ist. Zweistufige Bestätigung ist hier angemessen
   (Benutzername eintippen o. Ä.), das ist die destruktivste Aktion der App.
5. Auskunft: eine SECURITY-DEFINER-Funktion `export_my_data()` in schema.sql, die
   alle Zeilen zu auth.uid() als ein JSON-Objekt zurückgibt — profiles, messages
   (als Autor), group_members, friendships, friend_requests, blocks, ignores,
   group_rsvps, user_reports, message_reports, beta_feedback, push_subscriptions,
   notification_mutes. Kein Parameter, immer nur die eigenen Daten.
6. Den Export-Knopf in account.js:1968 erweitern: erst die RPC aufrufen, dann die
   localStorage-Schlüssel dazulegen, alles in eine JSON-Datei. Wenn die RPC
   fehlschlägt (offline), wie bisher nur localStorage exportieren — aber es
   dazuschreiben, damit niemand denkt, das sei alles.

Wichtig:
- Den Endpunkt NICHT gegen die echte Datenbank testen. Ich teste ihn selbst mit
  einem Wegwerf-Konto.
- Service-Role-Key niemals an den Client geben, niemals mit VITE_-Prefix, niemals
  loggen.
- Beim Export nichts Fremdes mitgeben: keine E-Mail-Adressen anderer Nutzer, keine
  Nachrichten anderer Autoren. Bei DMs also nur die eigenen Zeilen.
- SQL nur zeigen, nicht ausführen.

Definition of Done: api/delete-account.js existiert und prüft die Session;
deleteAccount() im Client ruft ihn; der Knopf sagt die Wahrheit; export_my_data()
liegt als SQL bereit; der Export-Knopf holt auch die Serverdaten.
```

---

## A8 — Impressum und Datenschutzerklärung

> Backlog #14, #15 · Befunde 16.1, 16.2 · **ersetzt T2.4 aus PROMPTS.md**
> **Voraussetzung:** A2, A12 und A14 sind durch — sonst stimmt die Dienstliste nicht

```
MotoMatch-Projekt. Beide Rechtsseiten sind unausgefüllte Vorlagen und gehen live so
nicht.

Lies zuerst vollständig: public/impressum.html, public/datenschutz.html,
AUDIT-REPORT.md (Abschnitt 4, Tabelle "Externe Dienste" — dort steht die
nachgeprüfte Liste dessen, was der Code tatsächlich kontaktiert).

BEFUND 1 — public/impressum.html:177-227: alle sechs Abschnitte bestehen aus
Platzhaltern wie [Name des Betreibers], [kontakt@example.com]. Zusätzlich sind die
zitierten Normen veraltet: "§ 5 TMG" (Zeile 178) — das TMG wurde am 14.05.2024
durch das DDG abgelöst; "§ 55 Abs. 2 RStV" (Zeile 221) — der RStV wurde 2020 durch
den MStV ersetzt, die Regelung ist § 18 Abs. 2 MStV.

BEFUND 2 — public/datenschutz.html: enthält für Besucher sichtbare
Arbeitsanweisungen, z. B. "[Prüfen: Werden Nutzereingaben an OpenAI übermittelt?]"
und "[Weiterer Dienst]". Und die Dienstliste stimmt nicht mit dem Code überein:
- Gelistet, aber NICHT im Code: Open-Meteo (kein einziger Aufruf in src/).
- Im Code, aber NICHT gelistet: Sentry, LiveKit, KLIPY, gstatic.com (DRACO-Decoder),
  Apple ID JS, Web-Push-Dienste, Supabase Storage für Chat-Anhänge.
- Falls A14 noch nicht durch ist, zusätzlich: fc-moto.com, cdn2.louis.de,
  m.media-amazon.com.

Ich gebe dir meine Impressumsdaten im Chat, sobald du danach fragst.

Aufgabe: beide Seiten auf einen ehrlichen, vollständigen Stand bringen.

Schritte:
1. Zuerst den Code prüfen und mir eine Liste vorlegen: welche externen Dienste
   werden aktuell tatsächlich kontaktiert? Nicht aus der Vorlage abschreiben,
   sondern per grep über src/, api/, index.html und public/ ermitteln. Mir Abweichungen
   von der Liste im Audit-Report nennen — es kann sein, dass A2/A12/A14 inzwischen
   etwas entfernt haben.
2. Mich nach den Impressumsdaten fragen. Nichts erfinden, keine Beispieldaten
   eintragen, keine Platzhalter stehen lassen.
3. impressum.html ausfüllen, Normen aktualisieren (DDG statt TMG, MStV statt RStV).
   Abschnitte, die auf mich nicht zutreffen (Handelsregister, USt-ID), entfernen
   statt "entfällt" stehen zu lassen.
4. datenschutz.html neu strukturieren: alle Arbeitsanweisungen raus, Open-Meteo
   raus, für jeden tatsächlich genutzten Dienst ein Abschnitt mit Betreiber, Zweck,
   Rechtsgrundlage und Link zur dortigen Datenschutzerklärung. Bei den US-Diensten
   den Drittlandtransfer benennen.
5. Zwei Dinge ergänzen, die bisher fehlen und die technisch belegbar sind:
   - Der Storage-Bucket 'chat-attachments' ist öffentlich lesbar (schema.sql:235-239,
     ausdrücklich so kommentiert) — wer die URL kennt, kommt an jede hochgeladene
     Datei. Das gehört in die Erklärung.
   - Betroffenenrechte: sobald A7 durch ist, gibt es echte Wege für Auskunft und
     Löschung. Die dort beschreiben.
6. Die Google-Maps-Einwilligung ist bereits korrekt als 2-Klick-Lösung gebaut
   (src/js/garage.js:832-864). Das im Datenschutztext so beschreiben, wie es
   tatsächlich funktioniert.
7. Beide Seiten im Browser prüfen: kein einziges [Platzhalter]-Element darf übrig
   sein. `grep -c "placeholder" public/*.html` als Kontrolle.

Wichtig:
- Das ist eine Bestandsaufnahme des technisch Vorhandenen, keine Rechtsberatung.
  Am Ende einen Hinweis für mich schreiben, welche Punkte ich mit einem Anwalt
  klären sollte.
- Keine Angaben erfinden. Wenn du etwas nicht aus dem Code oder von mir hast:
  fragen.
- Die Gestaltung der Seiten (CSS im <style>-Block) nicht verändern, nur Inhalte.

Definition of Done: `grep -o "\[.*\]" public/impressum.html public/datenschutz.html`
findet keine Platzhalter mehr; jeder im Code kontaktierte Dienst steht drin; kein
nicht-genutzter Dienst steht drin; ich habe eine Liste offener Punkte für den Anwalt.
```

---

## A9 — Sentry scharf schalten

> Backlog #17, #61 · Befund 12.1 · **schließt T0.2 aus PROMPTS.md ab** (der Code
> wurde damals gebaut, aber nie aktiviert)

```
MotoMatch-Projekt. Die Sentry-Integration ist vollständig gebaut, aber
ausgeschaltet — geprüft mit `vercel env ls production`: weder VITE_SENTRY_DSN noch
SENTRY_DSN sind gesetzt. Ergebnis: wenn die Beta nachts ausfällt, erfahre ich es
gar nicht, und wenn mir jemand schreibt, habe ich keine Daten zur Ursache.

Lies zuerst: src/js/monitoring.js (der ist gut gemacht, inklusive PII-Filterung in
beforeSend), src/main.js, src/js/app.js, api/ai-match.js Zeilen 1-12 (dasselbe
Muster serverseitig).

Aufgabe: Monitoring tatsächlich in Betrieb nehmen und die Lücken schließen, durch
die Fehler heute unbemerkt verschwinden.

Schritte:
1. Mir erklären, was ich im Sentry-Dashboard klicken muss: Projekt anlegen (Platform:
   Browser JavaScript), DSN holen. Ein zweites Projekt für die Serverless-Functions
   oder dasselbe — deine Empfehlung mit Begründung.
2. Mir die exakten Befehle geben, um beide DSN in Vercel zu setzen — für Production
   UND Preview. Ich führe sie selbst aus.
3. src/main.js absichern. Aktuell sind das drei Zeilen ohne jede Absicherung:
     import './styles/main.css'
     import { startApp } from './js/app.js'
     startApp()
   Wenn startApp() wirft, bleibt ein leerer Bildschirm. Einen try/catch drumherum,
   der dem Nutzer eine verständliche Meldung mit Neuladen-Hinweis zeigt und den
   Fehler trotzdem an Sentry weiterreicht (nicht verschlucken).
4. Einen globalen unhandledrejection-Handler ergänzen. Das ist hier die wichtigste
   Fehlerklasse: community-api.js hat rund 28 Stellen mit unbehandelten
   await-Aufrufen (siehe AUDIT-REPORT.md Befund 7.1) — die tauchen heute nirgends auf.
5. Die leeren catch-Blöcke angehen, in denen echte Programmfehler verschwinden.
   NICHT alle 71 — nur diese, wo es um Programmlogik geht und nicht um localStorage:
   src/js/auth.js:219 (Fehler in einem Auth-Listener verschwindet spurlos),
   src/js/community-api.js:578 und 624-626 (Broadcast-Fehler),
   src/js/voice.js:376 und 386 (Gerätewechsel scheitert wortlos),
   src/js/ai.js:44 (schluckt jeden API-Fehler und zeigt "nicht verfügbar").
   Dort jeweils ein console.warn mit Kontext ergänzen, damit Sentry sie sieht.
   Die localStorage-catch-Blöcke NICHT anfassen, die sind bewusst so.
6. Mir sagen, welche zwei Alert-Regeln ich in Sentry einrichten sollte (Vorschlag:
   "neuer Fehlertyp" und ein Schwellwert pro Stunde) und wie.
7. Zum Schluss: mit `npm run dev` und einem absichtlich erzeugten Fehler zeigen,
   dass die Kette funktioniert — sobald ich den DSN gesetzt habe.

Wichtig:
- beforeSend in monitoring.js:30-52 NICHT abschwächen. Die Filterung von E-Mails,
  Tokens und Cookies ist korrekt und muss so bleiben.
- Keine echten Nutzerdaten an Sentry senden, um zu testen. Ein künstlicher Fehler
  reicht.
- tracesSampleRate bleibt 0 — Performance-Monitoring brauchen wir in der Beta nicht
  und es kostet Kontingent.

Definition of Done: main.js fängt Bootstrap-Fehler ab und meldet sie weiter;
unhandledrejection wird erfasst; die sechs genannten catch-Blöcke loggen; ich habe
eine Schritt-für-Schritt-Anleitung für Dashboard und Vercel-Variablen.
```

---

## A10 — Die vier stillen Fehler

> Backlog #18, #19, #23, #35 · Befunde 7.3, 8.2, 16.8, 16.6 · vier kleine,
> unabhängige Korrekturen in einer Sitzung

```
MotoMatch-Projekt. Vier Fehler, die jeder für sich klein sind, aber alle dieselbe
Eigenschaft haben: niemand merkt, dass etwas nicht stimmt.

Lies vorab die jeweils genannten Stellen. Die vier Punkte sind unabhängig
voneinander — bitte einzeln umsetzen und einzeln committen.

FEHLER 1 — src/js/community.js:217 und 226:
  const session = getSession(); if (!session?.id) return
Die Session hat kein Feld `id`. In src/js/auth.js:90 wird sie als { username, uid }
gebaut. `session?.id` ist also immer undefined, die Funktion kehrt jedes Mal sofort
zurück, und die Tabelle notification_mutes bleibt dauerhaft leer.
api/push-trigger.js:104-110 und 143-151 fragen sie ab, finden nie etwas und senden.
Wer einen Chat stummschaltet, bekommt die Push-Nachricht trotzdem.
Fix: `session?.uid` an beiden Stellen. Danach bitte prüfen, ob der Rest der
Funktion (der upsert) mit dem Schema notification_mutes in schema.sql:464-474
zusammenpasst — der Pfad war nie aktiv und ist ungetestet.

FEHLER 2 — src/js/community-api.js:144:
  const { data } = await supabase.from('profiles').select('*')
Lädt beim App-Start ALLE Profile aller Nutzer, inklusive der Spalte `avatar`, in der
base64-Bilder als Data-URL liegen (schema.sql:15, keine Größenbegrenzung).
Bei 500 Nutzern mit je 1,5 MB Avatar sind das 750 MB pro Seitenaufruf.
Fix: select('*') durch eine explizite Feldliste OHNE avatar ersetzen. Dann prüfen,
wo avatarImg tatsächlich gebraucht wird (getProfile in Zeile 842, avatarInner in
community.js:112) und einen Weg bauen, das Bild für einzelne Nutzer bei Bedarf
nachzuladen — z. B. beim Öffnen eines Profils. Für die Beta reicht auch:
Avatare erstmal nur für Freunde und Mitglieder der offenen Gruppe laden.
Wenn du eine einfachere Lösung siehst, die den Traffic ähnlich stark senkt: vorschlagen.

FEHLER 3 — src/js/gear.js:
Jeder Eintrag hat priceMin, priceMax und teils ein Feld `price`. Bei 32 von 64
Einträgen mit `price` liegt der Wert außerhalb des eigenen Bereichs. Beispiele:
"Held Thermo Sturmhaube" Bereich 10-20 EUR, price 4.95; "Klim Badlands Pro"
Bereich 400-650 EUR, price 1015; "Alpinestars Techstar" Bereich 200-350 EUR,
price 34.95. Es gibt keinen Mechanismus, der die Preise aktualisiert.
Fix: das Feld `price` aus allen Einträgen entfernen und in der Anzeige nur noch
den Bereich zeigen, klar als Schätzung gekennzeichnet ("ca. 150-250 EUR").
Die Anzeigestellen findest du über grep nach `price` in bike-detail.js und garage.js.

FEHLER 4 — src/js/quiz.js:188:
  const LS_KEY = 'motoMatchAnswers';
Das ist der einzige localStorage-Schlüssel im ganzen Projekt ohne mm_-Präfix
(geprüft über alle localStorage-Aufrufe in src/js/). Der Schlüssel enthält
Führerscheinklasse, Fahrerfahrung, Budget, Körpergröße und Beifahrer-Angabe.
"Alle lokalen Daten löschen" in account.js:1952-1958 löscht nur mm_*-Schlüssel,
der Export in 1970-1973 erfasst nur mm_*. Die Quiz-Antworten überleben also das
Löschen und fehlen im Export.
Fix: umbenennen in mm_quiz_answers_v1, mit einmaliger Übernahme des alten Werts.
Das Migrationsmuster steht in src/js/match-history.js:41-45
(migrateFromPrimaryBike) — daran orientieren. Alle Lesestellen mitziehen,
insbesondere match-history.js:16 (LS_ANSWERS).

Wichtig:
- Vier separate Commits, damit ich jeden einzeln zurückrollen kann.
- Bei Fehler 1: der upsert nutzt onConflict 'user_id,mute_key'. Prüfen, ob dafür
  ein passender Unique-Constraint existiert (schema.sql:468: PRIMARY KEY
  (user_id, mute_key)) — falls ja, ist alles gut, falls nein sagen.
- Bei Fehler 2: nichts kaputt machen. Wenn getProfile() an einer Stelle einen
  Avatar erwartet und keinen bekommt, muss der Initialen-Fallback greifen
  (community.js:112-115 macht das schon richtig).
- Bei Fehler 3: die URLs zu den Shops bleiben, nur die Preisangabe ändert sich.

Definition of Done: vier Commits; Push-Stummschaltung schreibt jetzt in
notification_mutes; _loadProfiles lädt keine base64-Avatare mehr; keine
Euro-Beträge mehr in gear.js; Quiz-Antworten werden von "Alle Daten löschen"
erfasst; Build läuft.
```

---

## A11 — Registrierung härten

> Backlog #20, #21, #29, #30 · Befunde 3.6, 3.6b, 4.8, 3.7 · **Reihenfolge ist hier
> entscheidend**

```
MotoMatch-Projekt, Supabase Auth. Ein Audit hat vier zusammenhängende Probleme im
Registrierungsablauf gefunden. Die Reihenfolge der Fixes ist wichtig — Schritt 3
darf erst nach Schritt 2 kommen, sonst ist die Registrierung sofort kaputt.

Lies zuerst: src/js/auth.js (register ab 335, _onSignedIn ab 77, login ab 297),
src/js/supabase.js, supabase/schema.sql Zeilen 8-31.

BEFUND 1 — geprüft über GET /auth/v1/settings des Projekts:
  { "mailer_autoconfirm": true, "disable_signup": false }
Die Bestätigungsmail ist abgeschaltet, jede Registrierung gilt sofort als verifiziert.
Wer max@fremde-firma.de einträgt, hat ein Konto auf diese Adresse. Der echte
Inhaber kann sich danach nicht mehr registrieren (auth.js:354 "E-Mail bereits
verwendet") und bekommt über requestPasswordReset (auth.js:515) Reset-Links für ein
Konto, das er nie angelegt hat.

BEFUND 2 — auth.js:361-370: Die Profilanlage hängt an einer Session.
  if (data.session) await supabase.auth.setSession(data.session)   // Zeile 361
  const { error: profErr } = await supabase.from('profiles').insert({...})  // 364, läuft IMMER
Ohne Session ist auth.uid() null, die Policy profiles_insert (schema.sql:26) blockt,
und der Nutzer sieht eine rohe englische Postgres-Meldung. Heute fällt das nicht
auf, weil autoconfirm immer eine Session liefert. Es ist eine Falle, die genau dann
zuschnappt, wenn wir Befund 1 beheben.

BEFUND 3 — supabase.js:13: `export const OFFLINE_MODE = !url || !key`
Fehlt eine Supabase-Variable im Produktions-Build, scheitert nichts — die App
startet als localStorage-Demo. Und in dem Modus speichert auth.js:388 Passwörter
im Klartext (auth.js:323 vergleicht sie im Klartext). Das ist kein Randfall:
geprüft mit `vercel env ls`, die Variablen existieren nur für Production, jeder
Preview-Deploy läuft also genau so.

BEFUND 4 — Passwort-Mindestlänge ist 4 (auth.js:340, 486, 527 und die
minlength-Attribute in auth.js:647 und community.js:635), während Supabase
standardmäßig 6 erzwingt. Ein 5-Zeichen-Passwort passiert den Client und scheitert
am Server mit englischer Meldung.

Aufgabe: in genau dieser Reihenfolge.

Schritte:
1. Passwort-Minimum an allen fünf Stellen auf 8 anheben. Mir sagen, wo ich die
   Supabase-Einstellung auf denselben Wert setze.
2. Profilanlage in einen Datenbank-Trigger verlegen: eine SECURITY-DEFINER-Funktion
   handle_new_user(), die bei INSERT auf auth.users eine profiles-Zeile anlegt. Den
   Benutzernamen über raw_user_meta_data übergeben — also in auth.js:351 den
   signUp-Aufruf um options.data.username erweitern. Kollisionen beim Benutzernamen
   müssen die Funktion behandeln (der Unique-Constraint auf profiles.username greift
   sonst im Trigger und lässt die ganze Registrierung fehlschlagen). Das SQL zeigen,
   nicht ausführen.
3. auth.js:register() entsprechend vereinfachen: kein manueller profiles-Insert
   mehr. Die Vorabprüfung auf vergebene Benutzernamen (Zeile 345-347) kann bleiben,
   aber bitte auf .eq() statt .ilike() umstellen — ILIKE behandelt _ als Platzhalter,
   weshalb der Name "max_1" fälschlich mit "maxx1" kollidiert.
4. ERST WENN 2 und 3 durch und getestet sind: mir sagen, wo ich "Confirm email" im
   Supabase-Dashboard einschalte. Und den Client darauf vorbereiten — nach signUp
   ohne Session braucht der Nutzer den Hinweis "Bitte bestätige deine E-Mail",
   nicht eine Fehlermeldung.
5. supabase.js: im Produktions-Build laut scheitern statt still in den Demo-Modus
   zu fallen. Etwa:
     if (OFFLINE_MODE && import.meta.env.PROD) throw new Error('...')
   Im Dev-Build bleibt der Demo-Modus wie er ist, der ist nützlich.
6. Im Demo-Modus die Klartext-Passwörter loswerden: entweder gar nicht speichern
   (Session-Flag statt Vergleich) oder wenigstens einen Hash. Deine Empfehlung mit
   Begründung — es ist ein Demo-Modus, Aufwand und Nutzen abwägen.

Wichtig:
- Schritt 4 NICHT vorziehen. Wenn "Confirm email" vor dem Trigger eingeschaltet
  wird, kann sich niemand mehr registrieren.
- Der Google-OAuth-Weg (auth.js:151-178, signInWithOAuth) muss weiter funktionieren.
  _onSignedIn() legt dort für neue Nutzer ein Profil an (Zeile 81-88) — prüfen, ob
  der Trigger das jetzt doppelt macht, und wenn ja, den Client-Pfad entfernen.
- SQL nur zeigen, nicht ausführen.
- Nach jedem Schritt `npm run build`.

Definition of Done: Mindestlänge 8 überall; Trigger-SQL liegt bereit; register()
legt kein Profil mehr selbst an; Produktions-Build scheitert ohne Supabase-Keys
laut; ich habe eine klare Anleitung, wann ich welchen Supabase-Schalter umlege.
```

---

## A12 — Apple-Login und toten Code entfernen

> Backlog #24, #67, #68 · Befunde 1.3, 1.4 · **erweitert T1.1 aus PROMPTS.md**

```
MotoMatch-Projekt. Aufräumarbeit mit einem konkreten Nutzen: weniger Code, ein
Drittanbieter weniger in der Datenschutzerklärung, und ein kaputtes Feature weg.

Lies zuerst: src/js/auth.js (Zeilen 100-207), src/js/util.js, src/main.js,
vite.config.js, package.json.

TEIL 1 — Apple-Login entfernen.
Geprüft über GET /auth/v1/settings des Supabase-Projekts: "apple": false, der
Provider ist serverseitig gar nicht aktiviert. Der Client-Pfad in auth.js:186-207
(loginWithApple) ruft im Erfolgsfall loginOrRegisterFromProvider (132-144) auf, und
die legt ein reines localStorage-Konto an, das in Supabase nie existiert — der
Nutzer wäre "angemeldet", hätte aber kein Konto, keine Community, keine Daten.
Das ist kein halbfertiges Feature, es ist eines, das im Erfolgsfall Schaden anrichtet.
Zu entfernen: loginWithApple, loginOrRegisterFromProvider, decodeJwtPayload,
loadScriptOnce, die Konstante APPLE_CLIENT_ID (Zeile 106) und der Eintrag
VITE_APPLE_CLIENT_ID in .env.example.
Vorher prüfen: gibt es UI, die loginWithApple aufruft? Wenn ja, mit entfernen.
Der Google-Weg (renderGoogleButton, Zeile 151-178) bleibt unverändert — der läuft
über supabase.auth.signInWithOAuth und funktioniert.
GOOGLE_CLIENT_ID (Zeile 105) wird gelesen, aber nirgends verwendet — auch weg.

TEIL 2 — toten Code entfernen. Alle vorher noch einmal per grep gegenprüfen:
- src/counter.js (9 Zeilen, Vite-Starter-Template, nirgends importiert)
- src/style.css (296 Zeilen, Vite-Starter; main.js:1 importiert nur styles/main.css)
- src/assets/vite.svg und src/assets/javascript.svg
- copy-bikes.mjs und copy-assembly.js (in keinem npm-Script, keiner Config)
- vite.config.js Zeilen 7-67: `const isLocal = existsSync('D:/MotoMatch/Bilder')` —
  ein Windows-Pfad, der auf macOS immer false ergibt. Der ganze davon abhängige
  Block ist toter Code. Zeilen 81-125 (das serve-hero-video-Plugin) hängen ebenfalls
  an isLocal — prüfen und mitentfernen, wenn nichts übrig bleibt.
- .env: die Variablen VITE_TURN_URL, VITE_TURN_USER, VITE_TURN_CREDENTIAL werden
  nirgends im Code gelesen (Relikt des WebRTC-Mesh vor der LiveKit-Migration).
  In .env kann ich sie selbst löschen — sag mir Bescheid.

TEIL 3 — dreifache esc()-Kopie zusammenführen.
Es gibt vier identische Implementierungen: die exportierte in src/js/util.js:2 und
lokale Kopien in auth.js:564, feedback.js:25 und landing.js:24. Die drei lokalen
löschen und stattdessen aus util.js importieren. Grund: wenn eine gehärtet wird
(siehe A5), werden die anderen drei sonst vergessen.

Wichtig:
- Vor jedem Löschen per grep beweisen, dass nichts darauf verweist. Mir das
  Ergebnis zeigen, bevor du löschst.
- Nach jedem Teil `npm run build` — bei drei separaten Commits merkst du sofort,
  welcher Teil etwas kaputtgemacht hat.
- src/js/dealers.js und die Fake-Inserate sind NICHT Teil dieser Aufgabe, die
  gehören zu A2.
- vite.config.js vorsichtig: der Rest der Datei (defineConfig, das devApi-Plugin)
  muss unverändert bleiben.

Definition of Done: drei Commits; grep findet keine Verweise auf die gelöschten
Dateien; nur noch eine esc()-Implementierung im Projekt; Build läuft; du hast mir
gesagt, welche .env-Zeilen ich selbst löschen soll.
```

---

## A13 — Reaktionen reparieren und Schreibfehler sichtbar machen

> Backlog #25, #26 · Befunde 7.2, 7.1 · größter Prompt, plan zwei Sitzungen ein

```
MotoMatch-Projekt. Ein Audit hat das häufigste Fehlermuster der Codebasis gefunden:
optimistische lokale Updates, deren Serverfehler verworfen wird. Die Oberfläche
meldet Erfolg, die Datenbank hat nichts.

Lies zuerst vollständig: src/js/community-api.js, dazu supabase/schema.sql
Zeilen 215-300 (messages und die zugehörigen Policies).

BEFUND 1 — der Fall, der GARANTIERT immer fehlschlägt:
community-api.js:1278-1294 (toggleReactionInGroup) und 1543-1563
(toggleReactionInDM) schreiben eine Reaktion per
  supabase.from('messages').update({ reactions: msg.reactions }).eq('id', msgId)
Die Policy msg_update (schema.sql:283-288) erlaubt UPDATE aber nur dem Autor oder
einem Mod. Ein normales Mitglied, das auf eine fremde Nachricht reagiert, trifft
null Zeilen. PostgREST meldet das nicht als Fehler, und der Rückgabewert wird
ohnehin verworfen. Der Nutzer sieht sein Emoji, nach dem Neuladen ist es weg. Auf
eigene Nachrichten funktioniert es — was die Fehlersuche zusätzlich verwirrt.
Nebenbei: zwei gleichzeitige Reaktionen überschreiben sich, weil beide das ganze
reactions-Objekt schreiben.

BEFUND 2 — dasselbe Muster ohne Fehlerprüfung an 28 Stellen:
961, 996, 1042, 1052, 1062, 1063, 1071, 1083, 1133, 1268, 1275, 1293, 1307, 1316,
1355, 1356, 1362, 1386, 1397, 1415, 1416, 1531, 1540, 1561, 1594, 1604, 1671, 1677,
1708, 1729, 1749.
Beispiel kickMember (1046-1053): die Mitgliederliste wird lokal gefiltert, dann
folgt ein `await supabase...delete()` dessen Ergebnis niemand ansieht. Der Moderator
sieht den Nutzer verschwinden, der Nutzer ist weiter Mitglied.
Zwei Funktionen machen es RICHTIG und sind die Vorlage: joinGroup (1030-1034) und
sendFriendRequest (1654-1661) — beide rollen bei Fehler lokal zurück.

Aufgabe: Teil A zuerst, Teil B danach. Gern in zwei Sitzungen.

TEIL A — Reaktionen in eine eigene Tabelle.
1. Eine Tabelle message_reactions (message_id, user_id, emoji) mit
   PRIMARY KEY (message_id, user_id, emoji) und einer Policy, die jedem erlaubt,
   die EIGENEN Reaktionen anzulegen und zu löschen — und zu lesen, was er auch als
   Nachricht lesen darf. Das SQL zeigen, nicht ausführen.
2. toggleReactionInGroup und toggleReactionInDM auf insert/delete statt update
   umstellen. Damit verschwindet auch das Überschreibungsproblem.
3. Die Ladepfade anpassen: _loadGroups (179-217) und _loadDMs (293-297) holen die
   Reaktionen als Embed mit. _mapMessage (249-265) entsprechend anpassen.
4. Migration für Bestandsdaten: die vorhandene jsonb-Spalte messages.reactions in
   die neue Tabelle überführen. Als SQL zeigen. Die alte Spalte NICHT löschen —
   erst wenn wir sicher sind, dass alles läuft.
5. Prüfen, dass _handleMessageUpdate (704-737) und die Realtime-Anbindung weiter
   funktionieren — Reaktionen kommen dann nicht mehr als messages-UPDATE.

TEIL B — Schreibfehler sichtbar machen.
6. Einen Helfer in community-api.js bauen, der ein optimistisches Update mit
   Rollback kombiniert. Ungefähr:
     async function write(op, rollback) {
       const { error } = await op()
       if (error) { rollback(); console.error('[API]', error.message)
                    return { ok: false, error: error.message } }
       return { ok: true }
     }
   Signatur gern anders, wenn du eine bessere siehst — Hauptsache, der Rollback ist
   verpflichtend und nicht optional.
7. Die 28 Stellen darauf umstellen. Für jede: was ist das lokale Update, und wie
   sieht der Rollback aus? Bei manchen (z. B. banMember, das zwei Tabellen anfasst)
   ist das nicht trivial — dort lieber vorher fragen als raten.
8. Die Aufrufer in community.js prüfen: sie müssen jetzt res.ok auswerten und im
   Fehlerfall toast() zeigen. Das sind viele Stellen — mir eine Liste geben und
   priorisieren: destruktive Aktionen (kicken, sperren, löschen) zuerst, kosmetische
   später.

Wichtig:
- Teil A und Teil B getrennt committen.
- Die Offline-Zweige (`if (OFFLINE_MODE || !_myUid) { ... lsWrite ... return }`) in
  jeder Funktion müssen weiter funktionieren. Der Helfer darf sie nicht umgehen.
- SQL nur zeigen, nicht ausführen.
- Wenn eine der 28 Stellen sich als unkritisch herausstellt (Fehler ist dort
  wirklich egal): sagen und begründen statt stur umzubauen.
- Nach Teil A einmal manuell prüfen: Reaktion auf eine fremde Nachricht setzen,
  Seite neu laden, ist sie noch da?

Definition of Done: message_reactions existiert als SQL samt Migration; Reaktionen
auf fremde Nachrichten überleben ein Neuladen; der write-Helfer ist im Einsatz; die
destruktiven Aktionen zeigen im Fehlerfall eine Meldung; Build läuft.
```

---

## A14 — Assets abspecken und Drittanbieter-Bilder holen

> Backlog #22, #27, #28 · Befunde 8.1, 16.3 · **Voraussetzung für A8**

```
MotoMatch-Projekt. Zwei Probleme mit denselben Dateien: die Bilder sind zu groß,
und ein Teil davon liegt bei Dritten.

Lies zuerst: src/js/gear.js, src/js/matching.js (die image-Felder),
src/js/landing.js (FEATURED_BIKES und DISCOVER_CATS), src/js/bike-detail.js:4501,
src/js/garage.js:417, src/js/quiz.js:170.

BEFUND 1 — public/ ist 98 MB. Größte Dateien:
  13,61 MB  public/hdri/studio.hdr
   8,76 MB  public/bikes/Quiz Bike/akira_guy_on_motorcycle_animated.glb
   7,97 MB  public/bikes/harley_seventytwo_2015.png
   7,72 MB  public/bikes/haendler_beratung.png
   7,72 MB  public/bikes/"Händler & beratung .png"   <- dieselbe Datei nochmal
   4,45 MB  public/rider/Front.png
Auch "Community & Gear .png" und "community_gear.png" sind dieselbe Datei zweimal.
harley_seventytwo_2015.png steckt in matching.js:150 und wird auf einer
Entdecken-Kachel von wenigen hundert Pixeln angezeigt.

BEFUND 2 — src/js/gear.js verlinkt 64 Produktbilder direkt von fremden Servern:
34x www.fc-moto.com, 23x cdn2.louis.de, 7x m.media-amazon.com. Jedes davon
überträgt IP, User-Agent und Referrer des Besuchers an den fremden Server — ohne
Einwilligung und ohne Erwähnung in der Datenschutzerklärung. Beim Testabruf hat
louis.de bereits mit HTTP 403 geantwortet, die Verlinkung ist also auch technisch
nicht verlässlich.
Dazu wird der DRACO-Decoder an drei Stellen von https://www.gstatic.com geladen
(bike-detail.js:4501, garage.js:417, quiz.js:170) — auch ein Google-Request ohne
Einwilligung.

Aufgabe: Bilder verkleinern, fremde Bilder holen, den Decoder mitliefern.

Schritte:
1. Zuerst eine Bestandsaufnahme: alle Bilder in public/ mit Größe und der Stelle,
   wo sie im Code referenziert werden. Bilder ohne Referenz mir nennen — die sind
   Kandidaten zum Löschen, aber nicht ungefragt löschen.
2. Die vier Duplikate identifizieren (per Prüfsumme, nicht nach Dateiname) und
   jeweils eines behalten. Alle Referenzen auf den verbleibenden Namen ziehen.
   Die Dateinamen mit Leerzeichen und Umlauten dabei loswerden.
3. Ein einmaliges Konvertierungsskript nach /tmp (nicht ins Repo): alle
   Bike-Bilder und Lifestyle-Fotos zu WebP, max. 1600px Kantenlänge, Qualität ~80.
   Mit sharp oder @squoosh/cli. Vorher/Nachher-Größen zeigen.
4. Alle Pfade im Code auf .webp umstellen — matching.js, landing.js, gear.js,
   garage.js, bike-detail.js. Ein PNG-Fallback ist 2026 nicht mehr nötig.
5. Die 64 fremden Produktbilder herunterladen, gleich behandeln (WebP, kleiner),
   unter public/gear/ ablegen und gear.js auf lokale Pfade umstellen. Die
   Produkt-URLs (das Feld `url`) bleiben, nur `image` wird lokal.
   Falls ein Download fehlschlägt: den Eintrag ohne Bild lassen, nicht abbrechen.
   Mir am Ende sagen, welche fehlgeschlagen sind.
6. DRACO-Decoder aus dem npm-Paket ausliefern statt von gstatic:
   three/examples/jsm/libs/draco/ nach public/draco/ kopieren (am besten als
   Build-Schritt in vite.config.js oder als npm-Script, nicht von Hand) und die drei
   setDecoderPath-Aufrufe umstellen.
7. studio.hdr (13,6 MB): prüfen, wo sie benutzt wird und wofür. Für
   Karosserie-Spiegelungen reicht eine deutlich kleinere Umgebungsmap. Vorschlag
   machen — kleinere HDRI, oder eine prozedurale Umgebung aus three.js, oder ganz
   weglassen. Mir das Ergebnis zeigen, bevor du es ersetzt: die 3D-Ansicht ist ein
   Kernfeature und darf nicht schlechter aussehen.
8. Das Fahrermodell (8,76 MB) wird laut landing.js:653-675 beim Quiz vorgeladen.
   Prüfen, ob es auch im Konfigurator geladen wird — wenn ja, dort weglassen.

Wichtig:
- Die 3D-Ansicht bleibt. Wir machen sie billiger, nicht kaputt. Nach jeder Änderung
  an den Modellen einmal im Browser prüfen.
- Die Originaldateien nicht überschreiben, bevor die WebP-Variante geprüft ist.
- Bilder von Dritten herunterladen: nur die 64 aus gear.js, nichts anderes. Ein
  freundlicher User-Agent und ein Delay zwischen den Requests, kein Hämmern.
- `npm run build` nach jedem Teilschritt; die Bundle-Ausgabe vergleichen.

Definition of Done: public/ deutlich unter 20 MB; keine externen Bild-URLs mehr in
gear.js; DRACO kommt aus dem eigenen Verzeichnis; keine Duplikate mehr; die
3D-Ansicht sieht unverändert aus; Build läuft.
```

---

## A15 — Migrationen, Indizes und Constraints

> Backlog #32, #34, #39, #40 · Befunde 2.1, 2.2, 2.3, 4.6 · **nach allen
> Schema-Prompts** (A3, A4, A5, A7, A11, A13)

```
MotoMatch-Projekt, Supabase. Nachdem die vorherigen Prompts das Schema mehrfach
geändert haben, bringen wir es auf einen wartbaren Stand.

Lies zuerst vollständig: supabase/schema.sql und src/js/community-api.js
(insbesondere die Stellen mit Migrations-Fallbacks: 181-190, 202-212, 922-929,
1013-1020, 1238-1250, 1503-1519).

BEFUND 1 — schema.sql ist nicht wiederholbar ausführbar. Die 47 CREATE POLICY sind
nicht idempotent (CREATE TABLE IF NOT EXISTS schon), ein zweiter Lauf bricht mit
"policy already exists" ab — mitten im Skript, mit halb angewendetem Zustand.
Migrationen für bestehende Datenbanken stehen AUSKOMMENTIERT daneben, mit dem
Hinweis "einmalig im SQL-Editor ausführen" (Zeilen 29-31, 111-114, 298-300). Es gibt
keine Aufzeichnung, welche wo gelaufen sind. Deshalb enthält community-api.js an
sechs Stellen Fallback-Code, der rät, wie das eigene Schema aussieht.

BEFUND 2 — es gibt genau ZWEI Indizes im ganzen Schema (Zeilen 295-296). Nicht
indiziert, aber in jedem Ladevorgang gefiltert: friendships(user_a), friendships(user_b),
group_members(user_id), friend_requests(to_user), push_subscriptions(user_id),
channels(group_id), voice_rooms(group_id), group_rsvps(user_id), blocks(blocker),
ignores(ignorer), messages(author_id). push_subscriptions(user_id) wird bei JEDER
Nachricht abgefragt (api/push-trigger.js:115 und 157).

BEFUND 3 — kein Textfeld hat eine Obergrenze: profiles.username (Zeile 10),
profiles.bio (12), messages.text (221), voice_rooms.title (193). Ein Nutzer kann
die Datenbank vollschreiben.

BEFUND 4 — schema.sql:438-439, Policy bf_insert_auth auf beta_feedback:
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL)
Die anon-Rolle darf mit user_id NULL unbegrenzt einfügen. Kein Limit, kein CAPTCHA.

Aufgabe: Migrationen aufsetzen, dann die drei kleineren Punkte.

Schritte:
1. Supabase-CLI-Migrationen einrichten. Mir die Befehle geben, mit denen ich eine
   Baseline aus dem IST-Zustand der Produktionsdatenbank ziehe (supabase db diff
   oder db dump --schema-only) — ich führe sie aus und gebe dir das Ergebnis.
2. Daraus supabase/migrations/ aufbauen: eine Baseline-Migration, danach die
   Änderungen aus A3, A4, A5, A7, A11 und A13 als einzeln nummerierte Dateien.
   supabase/schema.sql bleibt als lesbare Gesamtsicht bestehen — aber mit einem
   Kopfkommentar, dass die Migrationen die Wahrheit sind.
3. Alle CREATE POLICY auf DROP POLICY IF EXISTS + CREATE POLICY umstellen, damit
   das Gesamtskript wiederholbar wird.
4. Die sechs Fallback-Zweige in community-api.js entfernen, sobald die Migrationen
   stehen. Das ist der eigentliche Gewinn: die Anwendung muss nicht mehr raten.
   Vorsichtig vorgehen — jeden einzeln, mit Begründung, warum er jetzt entbehrlich ist.
5. Indizes anlegen (CREATE INDEX IF NOT EXISTS, das ist idempotent) für die elf
   oben genannten Spalten. Als eigene Migration.
6. Constraints ergänzen: Längen für messages.text, profiles.bio, voice_rooms.title;
   ein Format-Check für profiles.username. Zu JEDEM Constraint vorher ein SELECT
   mitgeben, mit dem ich prüfe, ob bestehende Zeilen es verletzen würden — sonst
   schlägt das ALTER fehl. Die Grenzen an dem ausrichten, was das UI heute erlaubt
   (feedback.js:16 begrenzt auf 2000, das Namensfeld in auth.js:638 auf 60).
7. bf_insert_auth so ändern, dass anonymes Feedback nicht mehr geht, plus einen
   Längen-Check auf beta_feedback.text.

Wichtig:
- KEIN DROP TABLE, KEIN DELETE FROM, KEIN TRUNCATE, kein DROP COLUMN.
- SQL nur zeigen, nicht ausführen. Ich spiele es ein und melde zurück.
- Vor Schritt 6 ausdrücklich darauf hinweisen, dass ich ein frisches Backup
  brauche.
- Die Migrationen müssen in der Reihenfolge laufen, in der die vorherigen Prompts
  gearbeitet haben. Wenn du unsicher bist, welche Änderung wann kam: git log der
  Datei supabase/schema.sql ansehen.

Definition of Done: supabase/migrations/ existiert mit Baseline und nummerierten
Migrationen; schema.sql ist wiederholbar ausführbar; die sechs Fallback-Zweige sind
weg; Indizes und Constraints liegen als Migration bereit; ich weiß genau, in welcher
Reihenfolge ich was einspiele.
```

---

## Reihenfolge

**Woche 1 — was die Beta blockiert**

| Reihenfolge | Prompt | Aufwand | Warum hier |
|---|---|---|---|
| — | Backup + Ausgabenlimits (selbst) | 30 Min. | Muss vor allem anderen stehen |
| 1 | **A1** Repository deploybar | 1–2 h | Ohne das kannst du nichts ausliefern |
| 2 | **A2** Erfundene Daten raus | 1 h | Produktiv sichtbare Falschaussage |
| 3 | **A3** RLS Teil 1 | 2–3 h | E-Mail-Preisgabe und fremde DMs |
| 4 | **A4** RLS Teil 2 | 3–4 h | Braucht A3 |
| 5 | **A5** XSS | 2–3 h | Kontoübernahme |
| 6 | **A6** API absichern | 3–4 h | Braucht A1 |

**Woche 2 — was vor echten Nutzern weg muss**

| Reihenfolge | Prompt | Aufwand | Warum hier |
|---|---|---|---|
| 7 | **A9** Sentry scharf | 1–2 h | Ab jetzt siehst du, was schiefgeht |
| 8 | **A10** Vier stille Fehler | 2–3 h | Unabhängig, hoher Nutzen pro Zeile |
| 9 | **A12** Apple-Login + toter Code | 1–2 h | Muss vor A8, ändert die Dienstliste |
| 10 | **A14** Assets abspecken | 4–6 h | Muss vor A8, ändert die Dienstliste |
| 11 | **A7** Löschung + Auskunft | 3–4 h | DSGVO, braucht A1 |
| 12 | **A8** Impressum + Datenschutz | 2–3 h | Braucht A2, A12, A14 |

**Woche 3 — Fundament**

| Reihenfolge | Prompt | Aufwand | Warum hier |
|---|---|---|---|
| 13 | **A11** Registrierung härten | 3–4 h | Reihenfolge im Prompt beachten |
| 14 | **A13** Reaktionen + Fehlerbehandlung | 1–2 Tage | Größter Brocken, zwei Sitzungen |
| 15 | **A15** Migrationen + Indizes | 4–6 h | Zum Schluss, wenn das Schema steht |

Nach A8 ist die Beta startfähig. A11, A13 und A15 sind das, was du sonst in den
ersten Wochen mit echten Nutzern nachträglich reparierst — A13 ist der Grund, warum
in deiner Git-Historie neun von fünfzehn Community-Commits „Fix" heißen.

---

## Was NICHT in diesen Prompts steht

Alles darunter (Backlog #41–#80) ist P2/P3 und gehört nach der Beta. Insbesondere:
Paginierung der Community-Ladepfade (#41), ESLint und Tests (#44, #45),
Barrierefreiheit (#48, #49), SEO und echte Routen (#47, #78), das Aufteilen von
`community.js` und `main.css` (#76, #77).

Zwei bewusste Nicht-Entscheidungen: der **Bike-Katalog** bleibt im Code, bis es mehr
als ~30 Modelle sind (#79), und **Amazon-Affiliate-Tags** kommen erst, wenn der
Ausrüstungsbereich nachweislich genutzt wird (#80) — sie bringen sofort
Kennzeichnungspflichten mit, aber bei Beta-Reichweite keinen Ertrag.

---

## Meta-Regel für alle Audit-Prompts

Wenn Claude während einer Aufgabe etwas findet, das nicht zur Aufgabe gehört:
**notieren und am Ende nennen, nicht ungefragt mitändern.** Die Prompts sind so
geschnitten, dass jeder für sich zurückrollbar ist — das geht verloren, sobald
zwei Themen in einem Commit landen.

Und: Wenn ein Prompt SQL erzeugt, wird es **gezeigt, nicht ausgeführt.** Du spielst
es selbst im Supabase-SQL-Editor ein, nachdem du es gelesen hast. Bei
Policy-Änderungen ist der Unterschied zwischen „funktioniert" und „alle Daten offen"
eine Zeile.
