# A4 — Prüfanleitung mit zwei Testkonten

Nach dem Einspielen von `20260830130000_a4_gruppenbeitritt_und_einladungen.sql`.
Zwei Konten: **A** (legt die Gruppe an) und **B** (versucht hinein).

Die Snippets laufen in der Browser-Konsole der laufenden App — dort ist
`supabase` bereits mit der Session des angemeldeten Kontos verbunden. Ein
Aufruf, der über das UI gar nicht erreichbar ist, ist genau der Punkt: geprüft
wird die Datenbank, nicht der Browser.

```js
// In der Konsole verfügbar machen (einmal je Tab):
const { supabase } = await import('/src/js/supabase.js')
```

---

## 1. Invite-only-Gruppe: B kommt nicht mehr rein

**A:** Gruppe anlegen, Beitrittsmodus „Nur mit Einladung". Gruppen-ID notieren
(steht in der URL bzw. `getGroups()`).

**B**, angemeldet, in der Konsole:

```js
await supabase.from('group_members').insert({
  group_id: '<GRUPPEN-ID>', user_id: (await supabase.auth.getUser()).data.user.id, role: 'member'
})
```

**Erwartet:** `error.code === '42501'` (`new row violates row-level security
policy`). Vor A4 lief dieser Aufruf durch — B war Mitglied einer Gruppe, die
laut UI nur auf Einladung zugänglich ist.

Gegenprobe mit `role: 'owner'` in einer **offenen** Gruppe: muss ebenfalls
`42501` liefern. Sonst könnte man sich selbst zum Besitzer fremder Gruppen
machen.

---

## 2. Gesperrtes Konto kommt nicht zurück

**A:** B in eine offene Gruppe aufnehmen lassen, dann B sperren („Sperren" im
Mitglieder-Menü).

**B:**

```js
await supabase.from('group_members').insert({
  group_id: '<GRUPPEN-ID>', user_id: (await supabase.auth.getUser()).data.user.id, role: 'member'
})
```

**Erwartet:** `42501`. Vor A4 kam B einfach zurück — `group_bans` tauchte in
keiner einzigen Policy auf.

Und über den Einlösungsweg, falls A vorher einen Code erzeugt hat:

```js
await supabase.rpc('redeem_invite', { invite_code: '<CODE>' })
```

**Erwartet:** `data === { ok: false, reason: 'banned' }`.

---

## 3. B sieht die Einladungscodes von A nicht mehr

**B:**

```js
await supabase.from('invites').select('*')
```

**Erwartet:** `data` enthält **nur** Codes aus Gruppen, in denen B Owner oder
Mod ist — für ein frisches Testkonto also `[]`. Kein Fehler, eine leere Liste:
so arbeitet RLS.

Vor A4 gab dieselbe Zeile jedem Angemeldeten (und über den Anon-Key sogar
jedem Nicht-Angemeldeten) **alle Codes aller Gruppen**. Der Client hat sie
beim Start sogar aktiv geladen.

Ändern ebenfalls prüfen:

```js
await supabase.from('invites').update({ uses: 0 }).eq('code', '<CODE VON A>')
```

**Erwartet:** `data: []`, keine getroffene Zeile. Es gibt keine
`invites_update`-Policy mehr.

---

## 4. Einlösen funktioniert weiterhin — über die RPC

**A:** Einladungscode für die invite-only-Gruppe erzeugen, an B geben.

**B:** Code im Feld „Einladungscode oder Name suchen" eingeben.

**Erwartet:** Beitritt klappt, Toast „Du bist „…" beigetreten.", Gruppe öffnet
sich. Das läuft jetzt über `redeem_invite()` — B kann die `invites`-Zeile
selbst gar nicht mehr lesen (Punkt 3), die Funktion prüft sie mit
Definer-Rechten.

Zweiter Versuch mit demselben Code:

**Erwartet:** „Du bist bereits Mitglied dieser Gruppe."

---

## 5. Der Zähler ist jetzt dicht

**A:** Code mit **max. Nutzungen = 1** erzeugen.

Zwei Konten lösen ihn gleichzeitig ein — oder einfacher, in **einer** Konsole:

```js
await Promise.all([
  supabase.rpc('redeem_invite', { invite_code: '<CODE>' }),
  supabase.rpc('redeem_invite', { invite_code: '<CODE>' }),
])
```

**Erwartet:** einmal `{ ok: true, … }`, einmal `{ ok: false, reason: 'exhausted' }`
(oder `already_member`, je nachdem welcher Aufruf zuerst durchkommt).

Vor A4 rechnete der Browser `uses = gelesener Wert + 1` und schrieb das Ergebnis
zurück — beide Einlösungen lasen dieselbe 0 und schrieben dieselbe 1. Ein Code
mit max. 1 Nutzung ließ sich zu zweit einlösen.

---

## 6. Beitrittsanfragen: nur Owner/Mod nehmen an

**A:** Gruppe auf „Auf Anfrage" stellen. **B:** Anfrage senden.

**C** (drittes Konto, kein Mitglied) versucht, sie anzunehmen:

```js
await supabase.rpc('accept_join_request', { request_id: '<ANFRAGE-ID>' })
```

**Erwartet:** `{ ok: false, reason: 'not_allowed' }`.

**A** nimmt über das UI an: B ist Mitglied **und** die Anfrage ist aus der Liste
verschwunden. Beides passiert jetzt in einer Transaktion — vorher waren das zwei
Anfragen aus dem Browser, und scheiterte die zweite, stand die erledigte Anfrage
weiter als offen in der Liste.

**B** zieht eine Anfrage zurück (Knopf „Anfrage zurückziehen") — auch direkt
nach dem Senden, ohne Neuladen der Seite.

**Erwartet:** funktioniert. Vorher benutzte der Client dafür eine selbst
erfundene ID (`gr-1724…`) und schickte sie gegen eine `uuid`-Spalte; das gab
bis zum nächsten Neuladen einen Fehler.

---

## 7. Gruppe anlegen geht noch

Der wichtigste Regressionstest dieser Migration:

**A:** neue Gruppe anlegen, beliebiger Beitrittsmodus.

**Erwartet:** Gruppe erscheint, A ist Besitzer, der Kanal „allgemein" ist da.

Wenn hier „new row violates row-level security policy for table
group_members" kommt, fehlt die Policy `gm_insert_owner` — dann ist die
Migration nur halb eingespielt.

---

## 8. Rollen lassen sich nicht mehr hochschrauben

Nach `20260830130500_a4b_rollen_nicht_eskalierbar.sql`.

**A:** B in eine Gruppe aufnehmen und über „Zum Moderator machen" zum Mod
befördern. B ist jetzt Mod, nicht Besitzer.

**B**, in der Konsole:

```js
const uid = (await supabase.auth.getUser()).data.user.id
await supabase.from('group_members').update({ role: 'owner' })
  .eq('group_id', '<GRUPPEN-ID>').eq('user_id', uid).select('id')
```

**Erwartet:** `data: []` — keine getroffene Zeile.

Das war die ernsteste der drei Lücken: `gm_update` hatte nur ein `USING` und
kein `WITH CHECK`. Postgres setzt die `USING`-Bedingung dann auch für die neue
Zeile ein, und die lautete sinngemäß „der Aufrufer ist owner oder mod" — was B
als Mod erfüllt, ganz gleich, was danach in `role` steht. Ein Mod konnte sich
selbst zum Besitzer machen, ohne zweites Konto und ohne Mithilfe.

**B** versucht, den Gründer zu entfernen:

```js
await supabase.from('group_members').delete()
  .eq('group_id', '<GRUPPEN-ID>').eq('user_id', '<UID VON A>').select('id')
```

**Erwartet:** `data: []`. Vorher konnte ein Mod die Gruppe ohne Besitzer
zurücklassen.

**B** versucht, ein drittes Konto als Besitzer einzutragen:

```js
await supabase.from('group_members').insert({
  group_id: '<GRUPPEN-ID>', user_id: '<UID VON C>', role: 'owner'
})
```

**Erwartet:** `error.code === '42501'`.

**Gegenprobe — das muss weiterhin gehen:**

* A macht B zum Mod und wieder zum Mitglied (`toggleMod`)
* B als Mod entfernt ein normales Mitglied
* B tritt selbst aus
* A tritt aus seiner eigenen Gruppe aus

Schlägt eine davon fehl, ist die Policy zu eng geraten.
