#!/usr/bin/env python3
"""
MotoMatch — CSV des deutschen Marktes für die Suche der Website (2026-09-19).

Nutzer: „schreib den csv neu mit dem 5418 modellen neu sauber mit dem preisen damit unser system sauber suchen kann
für die website sitzhöhe usw alle daten müssen sauber übernommen werden den weltweiten tun wir kurz beiseite."

Eine Zeile je Modellfamilie aus bikes.de.json (5 418 — Marken mit deutschem Vertrieb, Baujahre zusammengefasst),
zusammengeführt aus drei Quellen, in dieser Reihenfolge:

  1. out/preise/preise_de.json  — 1000PS de-de: Marktpreise je Modelljahr, dazu Führerschein, Gänge, Tank, Radstand,
     Assistenz. Deutscher Markt, deshalb hat diese Quelle Vorrang.
  2. bikes.de.json              — aufbereitete Bikez-Daten: Kategorie, Hubraum, Leistung, Sitzhöhe, Gewicht.
  3. all_bikez_curated.csv      — der Rest der Technik: Bremsen, Reifen, Federung, Kühlung, Getriebe, Farben.

Leere Felder bleiben leer — geraten wird nichts, und woher ein Preis stammt, steht in „preisquelle". Der weltweite
Datensatz (daten/all_bikez_mit_preisen.csv, 38 472 Zeilen) bleibt unberührt liegen.

    .venv/bin/python csv_de.py                    # → daten/bikes_de.csv
    .venv/bin/python csv_de.py --nur-mit-preis    # nur Modelle mit Marktpreis
"""
import argparse, csv, json, re
from pathlib import Path

import plausi as P

HERE = Path(__file__).parent
DE = HERE / "bikes.de.json"
PREISE = HERE / "out" / "preise" / "preise_de.json"
GEBRAUCHT = HERE / "out" / "preise" / "gebraucht_inserate.json"   # zweite Quelle: Median echter Inserate
BIKEZ = Path("/Volumes/Untitled/Dokument mac/MotoMatch_Data_Pipeline/all_bikez_curated.csv")
AUS = HERE / "daten" / "bikes_de.csv"

# Ohne Straßenzulassung, deshalb nicht im Katalog (Nutzer 2026-09-19: „die ohne Straßenzulassung brauchen wir
# nicht"): reine Wettbewerbsmaschinen. Nur diese beiden Kategorien sind eindeutig — „Enduro / offroad" und
# „Super motard" enthalten auch zugelassene Modelle (KTM 690 Enduro R, Aprilia SX 125) und bleiben deshalb drin.
OHNE_ZULASSUNG = {"Cross / motocross", "Trial"}

# Dieselbe Angabe, zwei Sprachen: „getriebe" kommt englisch von Bikez, „antrieb" deutsch von 1000PS.
ANTRIEB_AUS_EN = {"Chain": "Kette", "Belt": "Riemen", "Shaft drive": "Kardan"}
ANTRIEB_NACH_EN = {v: k for k, v in ANTRIEB_AUS_EN.items()}

SPALTEN = ["slug", "marke", "modell", "baujahr", "baujahr_von", "baujahr_bis", "kategorie",
           "fuehrerschein", "a2_drosselbar", "hubraum_ccm", "leistung_ps", "leistung_kw", "drehmoment_nm",
           "zylinder", "bauart", "gaenge", "antrieb", "getriebe", "kuehlung", "tank_l",
           "gewicht_fahrbereit_kg", "gewicht_trocken_kg", "sitzhoehe_mm", "radstand_mm", "bodenfreiheit_mm",
           "hoechstgeschwindigkeit_kmh", "verbrauch_l_100km", "reichweite_km", "assistenz", "ausstattung",
           "bremse_vorn", "bremse_hinten", "reifen_vorn", "reifen_hinten",
           "federung_vorn", "federung_hinten", "farben", "bewertung",
           "preis_neu_eur", "preis_gebraucht_eur", "preis_mitte_eur", "preis_von_eur", "preis_bis_eur",
           "preis_sicherheit", "preis_jahr", "inserate", "angebote_gebraucht", "preisquelle",
           "in_de_gehandelt", "datenquellen"]


def teile(s):
    """Wörter ab zwei Buchstaben und alle Zahlen. Ein einzelnes „r" sagt nichts, eine „1" schon."""
    return {w for w in re.findall(r"[a-z]+|\d+", (s or "").lower()) if w.isdigit() or len(w) >= 2}


MARKEN_WORTE = ("yamaha", "honda", "suzuki", "kawasaki", "bmw", "ktm", "ducati", "aprilia", "triumph",
                "harley", "davidson", "harleydavidson", "vespa", "piaggio", "benelli", "brixton", "cfmoto",
                "husqvarna", "indian", "kymco", "lambretta", "malaguti", "moto", "guzzi", "mv", "agusta",
                "peugeot", "royal", "enfield", "sym", "zontes", "beta", "fantic", "gasgas", "hyosung",
                "rieju", "daelim", "derbi", "keeway", "mash", "niu", "zero", "sherco", "swm", "voge")


# Von Hand geprueft und bestaetigt: Zuordnungen, die keine Regel trennt, weil beide Namen dasselbe
# Kuerzel tragen, aber verschiedene Maschinen meinen (2026-09-20). Die Honda NC700D Integra ist ein
# Maxiroller (670 ccm, 211 kg, Variomatik), die NC700S ein Naked Bike - im Katalog stand der Roller
# unter dem Namen und mit dem Preis des Nakeds. Der Wachhund zeigte, dass genau dieser Eintrag in
# Ergebnissen auftaucht; die uebrigen Namensabweichungen sind Schreibvarianten derselben Maschine.
VERWECHSLUNGEN = {
    ("nc700dintegra", "nc700s"),
}


def ps_modell_passt(bikez_modell, ps_id):
    """Gehört das 1000PS-Modell wirklich zu diesem Bike?

    Die Zuordnung in preise_1000ps.py trifft fast immer — bei drei von 1.777 Modellen aber nicht, und dann
    erbt ein Bike Namen und Preis eines fremden: die Yamaha Bolt R-Spec (Cruiser, 942 ccm) stand mit Namen
    und Preis der R1 im Katalog. Teilen die beiden Namen kein einziges aussagekräftiges Wort, wird die
    Zuordnung verworfen — lieber kein Preis als der falsche.
    """
    if not ps_id:
        return True
    cache = HERE / "out" / "preise" / "modelle" / f"{ps_id}.json"
    if not cache.exists():
        return True
    try:
        name = json.loads(cache.read_text()).get("name") or ""
    except json.JSONDecodeError:
        return True
    # Die Marke steht im 1000PS-Namen mit drin („yamaha-fjr1300a") und sagt über das Modell nichts.
    for marke in MARKEN_WORTE:
        name = re.sub(rf"\b{re.escape(marke)}\b", " ", name.lower())
    if (norm(bikez_modell), norm(name)) in VERWECHSLUNGEN:
        return False
    a, b = teile(bikez_modell), teile(name)
    if not a or not b:
        return True
    # Die Hubraumzahl allein ist kein Beleg: „1300" teilen sich bei Yamaha XVS, FJR und XJR. Entscheidend
    # sind die Buchstabenkürzel — xvs gegen fjr, wr gegen yz, dr gegen rm sind verschiedene Motorräder.
    # Nur wenn eine Seite gar kein Kürzel hat (Modelle wie „z900"), zählt wieder der ganze Name.
    wa = {w for w in a if not w.isdigit()}
    wb = {w for w in b if not w.isdigit()}
    if wa and wb:
        if not (wa & wb):
            # Kein gemeinsames Kuerzel heisst meist: verschiedene Motorraeder. Es kann aber auch an
            # der Schreibweise liegen — 1000PS nennt die Yamaha D'elight mit Apostroph, daraus wird
            # das Kuerzel „elight", waehrend Bikez „delight 125" fuehrt. Deshalb entscheidet hier
            # noch einmal der ganze Name: steckt einer im anderen, ist es dieselbe Maschine.
            return norm(name) in norm(bikez_modell) or norm(bikez_modell) in norm(name)
        # Gleiche Länge, ein bis zwei Zeichen Unterschied: das ist keine Schreibvariante, sondern
        # die Nachbarversion — „cb125e" gegen „cb125r", „xt660r" gegen „xt660x". Verschiedene
        # Motorräder mit verschiedenen Preisen, und der Name entscheidet, was die KI später malt.
        na, nb = norm(bikez_modell), norm(name)
        if len(na) == len(nb) and 0 < sum(x != y for x, y in zip(na, nb)) <= 2:
            return False
        return True
    return bool(a & b) or norm(name) in norm(bikez_modell) or norm(bikez_modell) in norm(name)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def belastbare_angebote(g):
    """Wie viele Gebrauchtangebote es wirklich zu diesem Modell gibt.

    preise_gebraucht.py haelt zwei Zahlen fest: `angebote` ist die Trefferzahl, die die Suchseite
    meldet, `gesehen` die Zahl der tatsaechlich gelesenen Inserate. Ist die Suche zu weit gefasst,
    liegen sie weit auseinander - die BMW C1 stand mit 1.506 Treffern bei 10 gelesenen Inseraten,
    der Median ueber alle Modelle liegt bei 2. Bei den MV-Agusta-Varianten ist `angebote` die Zahl
    der ganzen Baureihe (135 F4), nicht der Variante (7).

    Diese Zahl entscheidet ueber die Verbreitung (`pop`) und damit bei gleichem Score, welches Bike
    oben steht: die Ducati S4 gewann mit ihren falschen 1.475 Inseraten jedes grosse Budget.
    Ueberschreitet die gemeldete Trefferzahl das Fuenfzehnfache der gelesenen, zaehlt die gelesene.
    Die Grenze ist gemessen, nicht gesetzt: die fehlerhaften Faelle liegen bei 19- bis 151-fach, der
    naechste einwandfreie (Kawasaki Ninja 650, 107 Treffer bei 11 gelesenen) bei 9,7-fach. Dazwischen
    liegt nichts. Betroffen sind 21 von 438 Modellen, davon allein 12 MV-Agusta-Varianten, die sich
    alle dieselbe Markenzahl 135 teilten - auch die F3, die gar nicht zur F4-Baureihe gehoert.
    """
    if not isinstance(g, dict):
        return None
    angebote, gesehen = g.get("angebote"), g.get("gesehen")
    if not angebote:
        return None
    if gesehen and angebote > 15 * gesehen:
        return gesehen
    return angebote



def ps_in_kw(ps):
    """Leistung in kW aus PS (1 PS = 0,7355 kW) — dieselbe Angabe, nur umgerechnet."""
    try:
        return float(ps) * 0.7355 if ps else None
    except (TypeError, ValueError):
        return None


def zahl(v, kommastellen=0):
    """Zahl als sauberer Text; None, leer und 0 bleiben leer (0 PS ist keine Angabe, sondern eine Lücke)."""
    if v in (None, "", 0):
        return ""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v).strip()
    if not f:
        return ""
    return f"{f:.{kommastellen}f}" if kommastellen else str(int(round(f)))


def bikez_zeilen():
    """Technikzeilen des Bikez-Datensatzes je Modell, nach Baujahr sortiert.

    Bikez führt dasselbe Modell für jedes Baujahr einzeln, und die Zeilen sind unterschiedlich vollständig — mal
    fehlt die Sitzhöhe, mal das Gewicht. Deshalb wird nicht nur die Zeile des Baujahrs genommen: fehlt dort ein
    Wert, kommt er aus dem nächstgelegenen Baujahr desselben Modells. Das ist derselbe Motorrad-Jahrgang, kein
    geratener Wert."""
    if not BIKEZ.exists():
        print(f"⚠ {BIKEZ} nicht erreichbar — Bremsen, Reifen und Federung bleiben leer")
        return {}
    nach = {}
    with BIKEZ.open(encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            jahr = (r.get("Year") or "").strip()
            nach.setdefault((norm(r.get("Brand")), norm(r.get("Model"))), []).append(
                (int(jahr) if jahr.isdigit() else 0, r))
    for k in nach:
        nach[k].sort(key=lambda x: x[0])
    return nach


def bikez_feld(zeilen, jahr, feld):
    """Wert eines Felds: aus dem Baujahr selbst, sonst aus dem nächstgelegenen Baujahr desselben Modells."""
    if not zeilen:
        return ""
    for _, r in sorted(zeilen, key=lambda x: abs(x[0] - (jahr or 0))):
        v = (r.get(feld) or "").strip()
        if v:
            return v
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nur-mit-preis", action="store_true", help="Modelle ohne Marktpreis weglassen")
    # Nutzer 2026-09-19: „die motorräder die nicht gehandelt werden wäre sinnlos die anzubieten … prüfe jedes bike
    # die die gehandelt werden noch behalten und die die nicht weg es dürfen auch alte ich will auch gebrauchte
    # haben." Nachweis ist ein Katalogpreis bei 1000PS oder mindestens ein echtes Gebrauchtinserat. Alte Baujahre
    # bleiben, solange sie gehandelt werden.
    ap.add_argument("--ohne-nachweis", action="store_true",
                    help="auch Modelle ohne Handelsnachweis schreiben (sonst werden sie ausgelassen)")
    ap.add_argument("--mit-wettbewerb", action="store_true",
                    help="Motocross und Trial mitschreiben (ohne Straßenzulassung, sonst ausgelassen)")
    ap.add_argument("--aus", default=str(AUS))
    args = ap.parse_args()

    bikes = json.loads(DE.read_text())
    preise = json.loads(PREISE.read_text()) if PREISE.exists() else {}
    inserate = json.loads(GEBRAUCHT.read_text()) if GEBRAUCHT.exists() else {}
    technik_csv = bikez_zeilen()

    aus = Path(args.aus)
    aus.parent.mkdir(parents=True, exist_ok=True)
    mit_preis = mit_technik = ohne_zulassung = 0
    ohne_nachweis = nur_gehandelt = geschrieben = fremdzuordnung = 0
    with aus.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=SPALTEN)
        w.writeheader()
        for b in bikes:
            s = b.get("specs") or {}
            if not args.mit_wettbewerb and (s.get("category") or "") in OHNE_ZULASSUNG:
                ohne_zulassung += 1
                continue
            p = preise.get(b["slug"]) or {}
            if p and not ps_modell_passt(b["model"], p.get("id")):
                fremdzuordnung += 1
                p = {}                                  # falsches 1000PS-Modell: Preise und Technik verwerfen
            t = p.get("technik") or {}
            # Zweite Quelle, wenn der Modellkatalog keinen Durchschnittspreis hat: der Median der tatsächlich
            # inserierten Gebrauchtpreise (preise_gebraucht.py). Nur, wenn genug Angebote da sind.
            g = inserate.get(b["slug"]) or {}
            if not isinstance(g, dict):
                g = {}
            ins = g if not p.get("mitte") else {}
            # Preis: ein Median aus mindestens drei Inseraten oder der 1000PS-Katalogpreis gilt als belegt. Bei
            # ein bis zwei Inseraten steht trotzdem ein echter Angebotspreis da — der zaehlt, wird aber als
            # „einzelangebot" gekennzeichnet, damit das Matching ihn vorsichtiger behandelt als einen Marktpreis.
            # Geschaetzt wird nichts: in derselben Klasse liegen die Preise um den Faktor vier auseinander.
            # Ein 1000PS-Treffer nur ueber den Namen (namensfund_ohne_technikabgleich, preise_1000ps.py: kein
            # Hubraum/Leistung-Abgleich moeglich) zaehlt aus demselben Grund nur als "einzelangebot", nicht als
            # "belegt" — der Modellname war eindeutig, der Preis selbst aber nicht technisch gegengeprueft.
            namensfund = bool(p.get("namensfund_ohne_technikabgleich"))
            # `if/else` statt `and`: `7496 and not False` ergibt True, nicht 7496 — dann landet in
            # preis_mitte_eur eine 1 statt des Preises (war bis 2026-09-27 in 83 % der Zeilen so).
            belegt = (p.get("mitte") if not namensfund else None) or ins.get("gebraucht")
            einzel = (
                round((g["min"] + g["max"]) / 2) if (not belegt and g.get("gehandelt") and g.get("min"))
                else (p.get("mitte") if (not belegt and namensfund and p.get("mitte")) else None)
            )
            von = g.get("min") if g.get("min") else p.get("gebraucht")
            bis = g.get("max") if g.get("max") else p.get("neu")
            # Die Spanne mischt zwei Maerkte: `von` ist ein Gebrauchtpreis, `bis` oft der Neupreis. Liegt ein
            # reales Gebrauchtangebot ueber dem Neupreis (Sondermodelle wie die M 1000 RR), stuende dort
            # von > bis. Die Spanne wird deshalb geordnet und die Mitte hineingezogen, damit von <= mitte <= bis
            # gilt — sonst zeigt die Website eine Spanne an, in der ihr eigener Preis nicht liegt.
            if von is not None and bis is not None and von > bis:
                von, bis = bis, von
            if belegt or einzel:
                mitte = belegt or einzel
                if von is not None:
                    von = min(von, mitte)
                if bis is not None:
                    bis = max(bis, mitte)
            jahre = b.get("years_in_csv") or []
            zeilen = technik_csv.get((norm(b["make"]), norm(b.get("_matched_csv_model")))) or []
            jahr = b.get("year") if isinstance(b.get("year"), int) else None
            bz = {f: bikez_feld(zeilen, jahr, f) for f in
                  ("Engine cylinder", "Gearbox", "Transmission type", "Cooling system", "Fuel capacity (lts)",
                   "Dry weight (kg)", "Wheelbase (mm)", "Seat height (mm)", "Front brakes", "Rear brakes",
                   "Front tire", "Rear tire", "Front suspension", "Rear suspension", "Color options",
                   "Power (hp)", "Torque (Nm)", "Displacement (ccm)", "Rating")}
            if zeilen:
                mit_technik += 1

            # Erst die Zahlen, und zwar je Feld die erste Quelle, die im moeglichen Bereich liegt (plausi.py).
            # „Der erste Treffer gewinnt" reichte nicht: 1000PS verklebt bei der F 800 R drei Sitzhoehen zu
            # „790770820", waehrend Bikez daneben saubere 770 mm hat.
            ccm = P.erste_gute("hubraum_ccm", s.get("displacement_ccm"), t.get("ccm"), bz["Displacement (ccm)"])
            ps = P.erste_gute("leistung_ps", s.get("power_hp"), t.get("ps"), bz["Power (hp)"])
            kw = P.erste_gute("leistung_kw", s.get("power_kw"), ps_in_kw(ps))
            gew_nass = P.erste_gute("gewicht_fahrbereit_kg", t.get("gewicht_kg"), t.get("gewicht_abs_kg"))
            gew_trocken = P.erste_gute("gewicht_trocken_kg", t.get("gewicht_trocken_kg"), s.get("weight_kg"),
                                       bz.get("Dry weight (kg)"))
            # Trocken heisst ohne Sprit und Fluessigkeiten — schwerer als fahrbereit kann es nicht sein.
            # Trifft das zu, ist die Trockenangabe falsch (Bikez fuehrt dort oft ein Nassgewicht) und faellt raus.
            # Verglichen wird gerundet, also so, wie die Werte gleich in der Spalte stehen: 261,7 kg trocken
            # neben 262 kg fahrbereit sind ungerundet zulaessig, geschrieben stuende aber zweimal 262.
            if gew_nass and gew_trocken and round(gew_trocken) >= round(gew_nass):
                gew_trocken = None
            vmax = P.erste_gute("hoechstgeschwindigkeit_kmh", t.get("vmax"))
            # Fuer das Leistungsgewicht zaehlt das Leergewicht; fahrbereit ist die genauere Angabe.
            kg = gew_nass or gew_trocken
            # Fahrerlaubnis nach § 6 FeV gegenrechnen statt der Quelle zu glauben: eine 38-kW-V7 kann kein
            # A2 sein. Angehoben wird nur — eine 34-kW-Enduro mit 0,32 kW/kg braucht trotz „wenig Leistung" A.
            fs = P.fahrerlaubnis(t.get("fuehrerschein") or s.get("license_class", ""), ccm, kw, kg, vmax)
            antrieb = t.get("antrieb", "") or ANTRIEB_AUS_EN.get((bz.get("Transmission type") or "").strip(), "")
            # Anzahl und Bauform getrennt holen: 1000PS liefert die blanke Zahl („2"), die Bauform steht nur
            # bei Bikez („Two cylinder boxer"). Wer beides aus derselben Quelle zieht, verliert eines von
            # beiden — die R 1250 GS stuende sonst als Zweizylinder ohne Boxer da.
            zyl_ps, _ = P.zylinder_teilen(t.get("zylinder"))
            zyl_bz, zyl_bauart = P.zylinder_teilen(bz.get("Engine cylinder"))
            zyl_anzahl = zyl_ps or zyl_bz
            # Widersprechen sich die Quellen in der Zahl, taugt auch die Bauform nichts.
            if zyl_ps and zyl_bz and zyl_ps != zyl_bz:
                zyl_bauart = ""

            zeile = {
                "slug": b["slug"], "marke": b["make"], "modell": b["model"], "baujahr": b.get("year", ""),
                "baujahr_von": jahre[0] if jahre else "", "baujahr_bis": jahre[-1] if jahre else "",
                "kategorie": s.get("category", ""),
                "fuehrerschein": fs,
                # Drosseln darf man hoechstens auf die Haelfte der Ausgangsleistung: ab 70 kW geht es nicht mehr,
                # und wer ohnehin schon A2 faehrt, wird nicht gedrosselt.
                "a2_drosselbar": P.drosselbar(kw, kg, P.noetige_klasse(ccm, kw, kg, vmax)),
                "hubraum_ccm": zahl(ccm),
                "leistung_ps": zahl(ps),
                # kW ist keine eigene Angabe, sondern dieselbe Leistung in anderer Einheit: 1 PS = 0,7355 kW.
                "leistung_kw": zahl(kw),
                "drehmoment_nm": zahl(P.erste_gute("drehmoment_nm", s.get("torque_nm"), t.get("nm"), bz["Torque (Nm)"])),
                # Zahl und Bauform getrennt: „V2" ist zweizylindrig UND ein V — in einer Spalte laesst sich
                # nach keinem von beidem filtern. 1000PS liefert die blanke Zahl, Bikez die Bauform.
                "zylinder": zahl(zyl_anzahl),
                "bauart": zyl_bauart,
                # „6-speed" und „6" meinen dasselbe — als Zahl, damit sich danach filtern laesst. „Automatic"
                # ist keine Gangzahl und bleibt als Wort stehen.
                "gaenge": zahl(P.erste_gute("gaenge", t.get("gaenge"), bz.get("Gearbox"))
                               or (bz.get("Gearbox") or "").strip()),
                # Antrieb und Getriebe sind dieselbe Angabe auf Deutsch und Englisch. 1000PS (deutscher Markt)
                # hat Vorrang; fehlt dort etwas, wird aus dem Bikez-Wort uebersetzt, statt die Luecke zu lassen.
                "antrieb": antrieb,
                # Wo beide Quellen etwas sagen und sich widersprechen, gilt 1000PS: die Indian FTR hat Kette,
                # nicht Riemen, die Crosstourer Kardan, nicht Kette. Die englische Spalte folgt deshalb der
                # deutschen, statt den Widerspruch in der Datei stehen zu lassen.
                "getriebe": ANTRIEB_NACH_EN.get(antrieb, (bz.get("Transmission type") or "").strip()),
                "kuehlung": (bz.get("Cooling system") or "").strip(),
                "tank_l": zahl(P.erste_gute("tank_l", t.get("tank_l"), bz.get("Fuel capacity (lts)")), 1),
                # Zwei Gewichte, weil sie Verschiedenes meinen: fahrbereit (deutscher Katalog, mit Sprit und
                # Fluessigkeiten) und trocken (Bikez). Sie duerfen nicht in eine Spalte.
                "gewicht_fahrbereit_kg": zahl(gew_nass),
                "gewicht_trocken_kg": zahl(gew_trocken),
                # Der deutsche Katalog hat Vorrang: seine Angaben stammen vom Hersteller fuer den DE-Markt.
                "sitzhoehe_mm": zahl(P.erste_gute("sitzhoehe_mm", t.get("sitzhoehe_mm"), s.get("seat_height_mm"),
                                                  bz.get("Seat height (mm)"))),
                "radstand_mm": zahl(P.erste_gute("radstand_mm", t.get("radstand_mm"), s.get("wheelbase_mm"),
                                                 bz.get("Wheelbase (mm)"))),
                "bodenfreiheit_mm": zahl(P.erste_gute("bodenfreiheit_mm", t.get("bodenfreiheit_mm"))),
                "hoechstgeschwindigkeit_kmh": zahl(vmax),
                "verbrauch_l_100km": zahl(P.erste_gute("verbrauch_l_100km", t.get("verbrauch")), 1),
                "reichweite_km": zahl(P.erste_gute("reichweite_km", t.get("reichweite_km"))),
                "assistenz": t.get("assistenz", ""),
                "ausstattung": t.get("ausstattung", ""),
                # Die Bikez-Texte sind teils doppelt kodiert („Ã–hlins" statt „Öhlins") — hier geradegezogen.
                "bremse_vorn": P.text_reparieren((bz.get("Front brakes") or "").strip()),
                "bremse_hinten": P.text_reparieren((bz.get("Rear brakes") or "").strip()),
                "reifen_vorn": (bz.get("Front tire") or "").strip(),
                "reifen_hinten": (bz.get("Rear tire") or "").strip(),
                "federung_vorn": P.text_reparieren((bz.get("Front suspension") or "").strip()),
                "federung_hinten": P.text_reparieren((bz.get("Rear suspension") or "").strip()),
                "farben": P.text_reparieren((bz.get("Color options") or "").strip()),
                "bewertung": zahl(P.erste_gute("bewertung", b.get("rating"), bz["Rating"]), 1),
                "preis_neu_eur": zahl(p.get("neu")),
                "preis_gebraucht_eur": zahl(p.get("gebraucht") or ins.get("gebraucht")),
                "preis_mitte_eur": zahl(belegt or einzel),
                "preis_von_eur": zahl(von),
                "preis_bis_eur": zahl(bis),
                "preis_sicherheit": "belegt" if belegt else ("einzelangebot" if einzel else ""),
                "preis_jahr": p.get("jahr_preis") or (ins.get("stand", "")[:4] if ins else ""),
                "inserate": zahl(p.get("inserate") or belastbare_angebote(ins)),
                "angebote_gebraucht": zahl(belastbare_angebote(g)),
                # Nachweis fuer den deutschen Markt: ein Marktpreis bei 1000PS (de-de) belegt, dass das Modell hier
                # gehandelt wird. Ohne Nachweis kann die Suche das Bike ausblenden, statt einen Preis zu raten.
                "in_de_gehandelt": "ja" if (p.get("mitte") or g.get("gehandelt")) else "",
                "datenquellen": " + ".join(q for q in ("1000PS de-de" if t else "",
                                                       "Bikez aufbereitet" if s else "",
                                                       "Bikez roh" if zeilen else "") if q),
                "preisquelle": (f"1000PS Marktpreis {p.get('jahr_preis')}"
                                + (" (Name ohne Technikabgleich)" if namensfund else "") if p.get("mitte") else
                                (f"1000PS Inserate: Median aus {ins['gesehen']} Angeboten "
                                 f"({ins['min']}–{ins['max']} €, {ins['stand']})" if ins.get("gebraucht") else
                                 (f"1000PS Inserate: {g['angebote']} Angebot(e), zu wenige für einen Median "
                                  f"({g['min']}–{g['max']} €, {g['stand']})" if g.get("gehandelt") else ""))),
            }
            if not (belegt or einzel or g.get("gehandelt")):
                ohne_nachweis += 1
                if not args.ohne_nachweis:
                    continue
            if belegt:
                mit_preis += 1
            elif args.nur_mit_preis:
                continue
            elif g.get("gehandelt"):
                nur_gehandelt += 1
            w.writerow(zeile)
            geschrieben += 1

    wohin = aus.relative_to(HERE) if aus.resolve().is_relative_to(HERE) else aus
    print(f"{geschrieben} Modelle → {wohin}  (von {len(bikes)} geprüften)")
    if ohne_zulassung:
        print(f"  ohne Straßenzulassung weggelassen: {ohne_zulassung} (Motocross, Trial)")
    print(f"  ohne Handelsnachweis {'geschrieben' if args.ohne_nachweis else 'weggelassen'}: {ohne_nachweis}")
    print(f"  mit Marktpreis      {mit_preis}")
    print(f"  nur gehandelt (Inserat ohne Median): {nur_gehandelt}")
    print(f"  mit Bikez-Technik   {mit_technik}")
    if fremdzuordnung:
        print(f"  falsche 1000PS-Zuordnung verworfen: {fremdzuordnung}")


if __name__ == "__main__":
    main()
