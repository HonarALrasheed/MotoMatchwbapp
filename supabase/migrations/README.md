# supabase/migrations — die Wahrheit über das Schema

Ab hier gilt: **was in diesem Verzeichnis steht, ist der Stand der
Datenbank.** `supabase/schema.sql` bleibt als lesbare Gesamtsicht bestehen,
ist aber nur noch Dokumentation — keine Ausführungsanweisung.

## Warum es dieses Verzeichnis gibt

Vorher standen Änderungen für bestehende Datenbanken als *auskommentierte*
Blöcke in `schema.sql`, mit dem Hinweis „einmalig im SQL-Editor ausführen".
Niemand hat notiert, wo welcher Block gelaufen ist. Die Folge stand im
Client: `src/js/community-api.js` hat an **neun** Stellen geraten, wie das
eigene Schema aussieht — Rückfallketten für den Fall, dass eine Spalte oder
Tabelle fehlt. Dieser Ratebetrieb ist mit `20260830120000_a0_…` beendet und
aus dem Client entfernt.

## Reihenfolge

| # | Datei | Was |
|---|---|---|
| 0 | `20260810000000_baseline.sql` | Ist-Zustand der Produktionsdatenbank — **noch Platzhalter**, siehe unten |
| 1 | `20260830120000_a0_bestandsangleichung.sql` | Spalten/Tabellen, auf die der Client bisher geraten hat |
| 2 | `20260830120500_a3_rls_dm_und_email.sql` | A3: `email_for_username`, `msg_insert_dm`, `msg_update` |
| 3 | `20260830121500_a5_avatar_color_format.sql` | A5: Formatzwang auf `avatar_color` |
| 4 | `20260830122000_a7_dsgvo_export.sql` | A7: `export_my_data()` |
| 5 | `20260830122500_a11_registrierung_trigger.sql` | A11: `handle_new_user()` + Trigger |
| 6 | `20260830123000_a13_message_reactions.sql` | A13: Tabelle, Policies, Übernahme der Bestandsdaten, Realtime |
| 7 | `20260830123500_a15_indizes.sql` | A15: acht fehlende Indizes |
| 8 | `20260830124000_a15_laengen_constraints.sql` | A15: Längen/Format für neun Spalten, alle `NOT VALID` |
| 9 | `20260830124500_a15_beta_feedback.sql` | A15: kein anonymes Feedback mehr |
| 10 | `20260830130000_a4_gruppenbeitritt_und_einladungen.sql` | A4: `gm_insert`, `gm_insert_owner`, `invites_*`, zwei RPCs |
| 11 | `20260830130500_a4b_rollen_nicht_eskalierbar.sql` | A4b: `gm_insert_mod`, `gm_update`, `gm_delete` — Rollen sind nicht mehr eskalierbar |
| 12 | `20260830131000_a15_constraints_validieren.sql` | A15: Constraints scharf stellen — **zuletzt, nach Prüf-SELECTs** |

Achtung bei der Reihenfolge: A4 trägt einen späteren Zeitstempel als A15,
läuft also nach den Indizes und vor dem Validieren — nicht dort, wo A4 in der
Prompt-Nummerierung stünde. Das ist Absicht, siehe unten.

Die Zeitstempel im Dateinamen sind die Reihenfolge; die Supabase-CLI
sortiert danach.

## Die Baseline

`20260810000000_baseline.sql` enthält aktuell nur einen `RAISE EXCEPTION`. Sie
wird ersetzt durch:

```bash
supabase db dump --linked --schema public -f supabase/migrations/20260810000000_baseline.sql
```

Der Platzhalter ist Absicht: eine fehlende Datei fällt niemandem auf, ein
abgebrochenes `supabase db push` mit klarer Meldung schon. Bevor der Dump nicht
drin ist, laufen die folgenden Migrationen nicht gegen eine Datenbank, von der
niemand weiß, was in ihr steht — genau der Zustand, der diese Umstellung
ausgelöst hat.

## Warum A4 am Ende steht

`A4` (Gruppenbeitritt und Einladungen serverseitig durchsetzen) war beim
Aufsetzen dieser Migrationen **nie eingespielt worden** — `gm_insert` stand
noch auf `WITH CHECK (user_id = auth.uid())`, `invites_select` und
`invites_update` auf `USING (true)`, die Funktionen gab es nirgends im Repo.

Nachgeholt ist es jetzt, aber mit einem Zeitstempel **hinter** allen anderen.
Migrationen laufen in der Reihenfolge, in der sie geschrieben wurden, nicht in
der, in der sie geplant waren. Ein Zeitstempel, der sich zwischen `a3` und `a5`
schiebt, würde auf jeder Datenbank, die dort schon vorbei ist, einfach
übersprungen — die Änderung käme nie an.

Ein Punkt daran ist leicht zu übersehen: `gm_insert` verlangt jetzt
`role = 'member'` und eine offene Gruppe. Damit fällt der Ersteller einer neuen
Gruppe durch, der sich unmittelbar nach `createGroup()` als `owner` einträgt.
Dafür gibt es die zusätzliche Policy `gm_insert_owner`, die sich auf
`groups.created_by` stützt. Ohne sie ist das Anlegen einer Gruppe kaputt.

## Warum die alten Migrationen nochmal laufen dürfen

Die Baseline ist ein Abzug der Produktionsdatenbank und enthält alles, was
dort schon steht — A3, A5, A7, A11, A13 also vermutlich bereits. Die Dateien
2–6 sind trotzdem da, und zwar bewusst: sie sind **idempotent** geschrieben
(`CREATE OR REPLACE`, `DROP POLICY IF EXISTS` + `CREATE`, `IF NOT EXISTS`,
`DO`-Blöcke mit Existenzprüfung). Auf der Produktion ändern sie nichts. Auf
einer frischen Datenbank, einem zweiten Supabase-Projekt oder einem
zurückgespielten Backup von vor dem Audit stellen sie denselben Stand her.

Genau das war vorher nicht möglich, und genau deshalb hat der Client geraten.

## Bedienung

```bash
supabase link --project-ref <ref>     # einmalig
supabase migration list               # was ist wo eingespielt
supabase db push                      # ausstehende Migrationen einspielen
supabase db push --dry-run            # nur zeigen, nichts tun
```

Nach dem Anlegen der Baseline muss sie als „bereits eingespielt" markiert
werden, sonst versucht die CLI, den Dump gegen die Produktion zu fahren:

```bash
supabase migration repair --status applied 20260810000000
```
