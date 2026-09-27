#!/usr/bin/env python3
"""
MotoMatch — Katalog für das Matching der Website (2026-09-17).

Nutzer: „ich möchte das durch die auswahl der quiz fragen in diesem csv nach filter den perfekten bike finden auch mit
preisen". Bisher wählte matching.js aus 35 Bikes. Dieses Skript baut daraus den ganzen deutschen Markt:

  bikes.de.json (Bikez-CSV, Marken mit DE-Vertrieb, ab 2010, Baujahr-Varianten zu Familien zusammengefasst)
  + out/preise/preise_de.json (1000PS de-de: Marktpreise je Modelljahr, Führerschein, Sitzhöhe, Gewicht fahrbereit,
    Tank, Gänge, Höchstgeschwindigkeit, Assistenz — preise_1000ps.py)
  + bikes.100.json (die 227 handverlesenen Bikes der Bildwerkstatt: geprüfte Kategorie, Bilder sobald freigegeben)
  + src/js/freigegebene-bikes.js (freigegebene Bikes mit Bildern)
  = public/data/katalog-de.json   (die Website lädt ihn nach und filtert damit die Quizantworten)

Aufgenommen wird, was nachweislich in Deutschland gehandelt wird: ein Modell mit Marktpreis bei 1000PS oder ein Bike
der Bildwerkstatt-Liste. Ohne diesen Nachweis stehen im CSV vor allem Modelle anderer Märkte (Yamaha Crypton, BWS …).

Preise (Nutzerwunsch „neu und gebraucht und daraus die mitte ungefähr"):
  gebraucht = Marktpreis des Modelljahrs · neu = Marktpreis des jüngsten Modelljahrs, solange das Modell noch gebaut
  wird · preis = Mitte aus beidem. Für den Budget-Filter zählt der Gebrauchtpreis (so teuer ist der Einstieg), für die
  Anzeige alle drei.

Verbreitung (`pop`, 0–1) entscheidet bei gleichem Score, welches Bike oben steht: Neuzulassungen 2021–2024 (KBA-Zahlen,
Quellen in erweiterung_de200.py), sonst die Zahl der ausgewerteten Inserate bei 1000PS und die Bikez-Bewertung.

    .venv/bin/python matching_katalog.py            # baut die Datei und zeigt die Bilanz
    .venv/bin/python matching_katalog.py --csv      # zusätzlich das CSV mit Preisspalten (daten/)
"""
import argparse
import csv
import json
import math
import re
from datetime import date
from pathlib import Path

import plausi as P
from csv_de import ps_modell_passt   # eine Prüfung, eine Stelle: falsche 1000PS-Zuordnung erkennen

HERE = Path(__file__).parent
SITE = HERE.parent.parent
DE = HERE / "bikes.de.json"
LISTE = HERE / "bikes.100.json"
PREISE = HERE / "out" / "preise" / "preise_de.json"
FREI = SITE / "src" / "js" / "freigegebene-bikes.js"
ZIEL = SITE / "public" / "data" / "katalog-de.json"
CSV_EIN = Path("/Volumes/Untitled/Dokument mac/MotoMatch_Data_Pipeline/all_bikez_curated.csv")
CSV_AUS = HERE / "daten" / "all_bikez_mit_preisen.csv"
# Seit 2026-09-19 die Wahrheit für Technik und Preise: csv_de.py führt dort 1000PS de-de, aufbereitetes und
# rohes Bikez zusammen und behält nur Modelle mit Handelsnachweis (Katalogpreis oder echtes Gebrauchtinserat).
CSV_DE = HERE / "daten" / "bikes_de.csv"

# Bikez-Kategorie → (Stil, Einsatz) der Website (wie einbau.py, ergänzt um die Kategorien des Vollkatalogs)
STIL = {
    "Naked bike": ("Naked", "Pendeln"), "Sport": ("Sportbike", "Rennstrecke"),
    "Custom / cruiser": ("Cruiser", "Cruisen"), "Enduro / offroad": ("Enduro", "Touring"),
    "Classic": ("Klassiker", "Touring"), "Touring": ("Touring", "Touring"),
    "Sport touring": ("Touring", "Touring"), "Scooter": ("Roller", "Pendeln"),
    "Allround": ("Naked", "Touring"), "Super motard": ("Supermoto", "Pendeln"),
    "Cross / motocross": ("Enduro", "Gelande"), "Trial": ("Enduro", "Gelande"),
    "Minibike, sport": ("Naked", "Pendeln"), "Speedway": ("Enduro", "Gelande"),
}
# Einzelfall-Overrides je Slug: die Bikez-Sammelkategorie "Allround" mischt echte Naked-/Retro-Bikes mit
# Adventure-/Cruiser-/Klassiker-Modellen, die STIL pauschal nicht trennen kann. Geprüft am 25.09. (Nutzer-
# Test "Naked ausgewählt, aber kein Naked Bike"): 62 von 264 finalen "Naked"-Bikes kamen aus "Allround",
# diese hier eindeutig falsch. Die Royal-Enfield-Fälle sind durch die eigene Baureihe belegt: "Classic 350"
# und "Continental GT 650" stehen bereits korrekt als Klassiker, ihre hier gelisteten Geschwister nicht.
STIL_SLUG = {
    "ducati_diavel1260": ("Cruiser", "Cruisen"),
    "ducati_diavel1260s": ("Cruiser", "Cruisen"),
    "ducati_diavelcarbon": ("Cruiser", "Cruisen"),
    # Yamaha SCR950 bewusst NICHT hier: mit 83 cm Sitzhöhe greift stil_pruefen()s Cruiser-Check (Zeile
    # weiter unten, ab 82 cm keiner mehr) sofort wieder und macht "Cruiser" zu "Naked" — ein Scrambler auf
    # dieser Sitzhöhe ist der gemessenen Regel nach tatsächlich kein Cruiser. Die Messung sticht die Vermutung.
    "royalenfield_classic500": ("Klassiker", "Touring"),
    "royalenfield_continentalgt": ("Klassiker", "Touring"),
    "swm_six500": ("Enduro", "Touring"),
    "honda_xadv": ("Roller", "Pendeln"),
    "brixton_crossfire500xc": ("Enduro", "Touring"),
}
# Zweitzwecke: wofür das Bike auch taugt (halbe Punkte im Matching) — eine Reiseenduro fährt auch zur Arbeit,
# ein Klassiker geht auf Tour. Reihenfolge egal, der Hauptzweck steht in STIL.
ZWEITZWECK = {
    "Naked": ["Touring"], "Sportbike": ["Pendeln"], "Cruiser": ["Touring"], "Enduro": ["Gelande", "Pendeln"],
    "Klassiker": ["Pendeln", "Cruisen"], "Touring": ["Cruisen"], "Roller": [], "Supermoto": ["Gelande"],
}

# Reine Sportgeräte ohne Straßenzulassung: im Quiz steht „Gelände/Offroad" für Reise- und Straßenenduros,
# nicht für Motocross oder Kinder-Trialbikes (Beta Evo 80 Junior stand sonst im Ergebnis).
OHNE_STRASSE = {"Cross / motocross", "Trial", "Speedway", "Minibike, cross"}
# Neuzulassungen Deutschland, Stück je Modell (Summe der Jahre, in denen es in einer Bestenliste stand).
# Quellen: motorradundreisen.de — Jahresbilanzen 2021, 2022, 2023, 2024 (KBA-Zahlen), siehe erweiterung_de200.py.
ZULASSUNGEN = {
    ("BMW", "r 1250 gs"): 25436, ("Kawasaki", "z900"): 15365, ("Yamaha", "mt-07"): 9570, ("Kawasaki", "z650"): 9480,
    ("Honda", "cmx500 rebel"): 7313, ("Yamaha", "tenere 700"): 7861, ("Honda", "crf1100 africa twin"): 5626,
    ("Honda", "cb650r"): 5830, ("KTM", "690 smc"): 7043, ("Husqvarna", "701 supermoto"): 6310,
    ("Suzuki", "sv650"): 3726, ("KTM", "390 duke"): 4469, ("Honda", "cbr650r"): 5227, ("BMW", "f 900 r"): 6725,
    ("Yamaha", "mt-09"): 5452, ("KTM", "890 duke"): 3170, ("KTM", "790 duke"): 3282, ("Aprilia", "rs 660"): 3423,
    ("Kawasaki", "ninja 650"): 3179, ("KTM", "1290 super duke r"): 5459, ("BMW", "s 1000 rr"): 3170,
    ("Honda", "cb500f"): 3340, ("Honda", "nc750x"): 3456, ("BMW", "f 750 gs"): 3009, ("BMW", "s 1000 xr"): 3365,
    ("Kawasaki", "z900rs"): 3021, ("Kawasaki", "vulcan s"): 3008, ("Ducati", "multistrada v4"): 3274,
    ("BMW", "r 1250 r"): 2919, ("BMW", "r 1250 rs"): 2718, ("Yamaha", "tracer 900"): 2970,
    ("Honda", "cmx1100 rebel"): 1150, ("Honda", "nt1100"): 1075, ("Yamaha", "yzf-r7"): 1101,
    ("Honda", "cbr500r"): 994, ("BMW", "s 1000 r"): 3204, ("Triumph", "trident 660"): 3082,
    ("Royal Enfield", "classic 350"): 1061, ("Royal Enfield", "meteor 350"): 922, ("BMW", "g 310 r"): 894,
    ("Moto Guzzi", "v85 tt"): 1754, ("Kawasaki", "z650rs"): 844, ("BMW", "r 1250 rt"): 1971,
    ("Suzuki", "gsx-s 1000"): 1257, ("Suzuki", "v-strom 650"): 722, ("Harley-Davidson", "pan america"): 711,
    ("Harley-Davidson", "street bob 114"): 1657, ("Triumph", "tiger 1200"): 704, ("Yamaha", "xsr700"): 691,
    ("Royal Enfield", "himalayan"): 672, ("BMW", "r 18"): 2008, ("Harley-Davidson", "sportster s"): 982,
    ("Harley-Davidson", "sport glide"): 878, ("Harley-Davidson", "breakout 114"): 804,
    ("Ducati", "streetfighter v4"): 731, ("Ducati", "monster"): 1778, ("Ducati", "scrambler"): 804,
    ("KTM", "890 adventure"): 1957, ("KTM", "1290 super adventure"): 3201, ("BMW", "f 900 xr"): 3340,
    ("Honda", "crf300l"): 808, ("Suzuki", "dl 650 v-strom"): 722, ("Triumph", "street triple"): 747,
    ("Honda", "cb500x"): 742, ("Husqvarna", "701 enduro"): 1000, ("KTM", "690 enduro r"): 1000,
    # 125er und Roller (Top 10 der Jahre 2021–2024)
    ("KTM", "125 duke"): 7668, ("Yamaha", "mt-125"): 7633, ("Honda", "cb125r"): 8967, ("Aprilia", "sx 125"): 6811,
    ("Brixton", "bx 125"): 7863, ("Brixton", "cromwell 125"): 7863, ("Beta", "rr  enduro 125 4t lc"): 5236,
    ("Honda", "cb125f"): 2279, ("Hyosung", "gv 125 s aquila"): 2789, ("Yamaha", "yzf-r 125"): 2834,
    ("Kawasaki", "z125"): 2718, ("Suzuki", "gsx-s125"): 2953, ("Yamaha", "xsr 125"): 1111,
    ("Fantic", "125m performance"): 2714, ("KTM", "rc 125"): 1186,
    ("Vespa", "gts 125"): 17591, ("Vespa", "primavera 125"): 12073, ("Honda", "forza 125"): 8604,
    ("Piaggio", "medley 125 abs"): 5100, ("Honda", "sh125i"): 5077, ("Piaggio", "liberty 125 s"): 3247,
    ("Yamaha", "nmax"): 1472, ("Honda", "pcx125"): 2202, ("Vespa", "sprint 125"): 659,
    ("Aprilia", "sr gt 125"): 1986, ("Yamaha", "xmax 125"): 899, ("Honda", "sh mode 125"): 1587,
    ("Peugeot", "tweet 125 active"): 582, ("Vespa", "gts 300"): 21212, ("Piaggio", "mp3 300"): 1394,
    ("Piaggio", "beverly 400 s"): 1320, ("Honda", "sh350i"): 1244, ("Honda", "forza 350"): 1678,
    ("Peugeot", "metropolis"): 606, ("BMW", "c 400 gt"): 583, ("Honda", "sh150i"): 1203,
    ("Honda", "adv350"): 683, ("Yamaha", "x-max 300"): 915, ("Piaggio", "mp3 500"): 771,
}
ROLLER_GANG = "Automatik"


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def freigegebene():
    """Die freigegebenen Bikes der Bildwerkstatt aus dem erzeugten JS-Modul."""
    if not FREI.exists():
        return []
    txt = FREI.read_text()
    a, b = txt.find("["), txt.rfind("]")
    roh = re.sub(r",\s*\]$", "]", txt[a: b + 1].strip())        # einbau.py schreibt ein Komma vor der Klammer
    return json.loads(roh)


def lizenz(technik, specs):
    """Welche Klasse man braucht: die niedrigste, die 1000PS für das Modell nennt; sonst die Ableitung aus dem CSV."""
    rang = {"A1": 1, "B196": 1, "AM": 0, "A2": 2, "A": 3}
    klassen = [k.strip() for k in str(technik.get("fuehrerschein") or "").split(",") if k.strip()]
    klassen = [k for k in klassen if k in rang]
    if klassen:
        return min(klassen, key=lambda k: rang[k])
    return specs.get("license_class") or "A"


def modellname(model, p=None):
    """Anzeigename: der Name des 1000PS-Katalogs, sonst der CSV-Name sauber geschrieben (mt-07 → MT-07,
    v-strom 650 → V-Strom 650, africa twin → Africa Twin)."""
    if p and p.get("id"):
        cache = HERE / "out" / "preise" / "modelle" / f"{p['id']}.json"
        if cache.exists():
            try:
                name = json.loads(cache.read_text()).get("name")
                # Nur, wenn der Name auch zu diesem Bike gehört: die Bolt R-Spec trug sonst „R1"
                # (siehe ps_modell_passt in csv_de.py).
                if name and ps_modell_passt(model, p["id"]):
                    return name
            except json.JSONDecodeError:
                pass
    teile = []
    for wort in (model or "").split():
        stuecke = [t.upper() if (re.search(r"\d", t) or len(t) <= 2) else t.title() for t in wort.split("-")]
        teile.append("-".join(stuecke))
    return " ".join(teile)


def zahl(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def klasse(text, technik, specs):
    """Welche Klasse man braucht: die niedrigste, die genannt wird („A2, A" → A2)."""
    rang = {"AM": 0, "A1": 1, "B196": 1, "A2": 2, "A": 3}
    klassen = [k.strip() for k in str(text or "").split(",") if k.strip() in rang]
    if klassen:
        return min(klassen, key=lambda k: rang[k])
    return lizenz(technik, specs)


def gaenge_text(wert, stil):
    """„6" und „6-speed" → „6-Gang", „Automatic" → „Automatik"."""
    s = str(wert or "").strip()
    if not s:
        return ROLLER_GANG if stil == "Roller" else None
    if s[0].isdigit():
        return f"{int(float(s.split('-')[0]))}-Gang"
    return ROLLER_GANG


def eintrag(b, p, liste_bike, frei_bike, c):
    """Ein Katalogeintrag.

    Technik und Preise kommen aus daten/bikes_de.csv — dort hat csv_de.py die drei Quellen schon in der
    richtigen Reihenfolge zusammengeführt (1000PS de-de vor aufbereitetem Bikez vor rohem Bikez) und nur
    Modelle mit Handelsnachweis behalten. Aus dem 1000PS-Datensatz kommen hier nur noch die Preise je
    Baujahr, aus der Bildwerkstatt Bilder und 3D-Modelle.
    """
    s = b["specs"]
    t = (p or {}).get("technik") or {}
    c = c or {}
    kat = (liste_bike or {}).get("specs", {}).get("category") or c.get("kategorie") or s.get("category") or ""
    # Slug-Override zuerst (Einzelfälle, siehe STIL_SLUG), sonst die Kategorie-Tabelle. Kennt keine der
    # beiden den Wert, wird NICHT mehr still auf "Naked" zurückgefallen (bis 25.09. der Default hier) —
    # main() zählt und schließt den Eintrag aus, statt ihn falsch zu veröffentlichen.
    zuordnung = STIL_SLUG.get(b["slug"]) or STIL.get(kat)
    if zuordnung is None:
        return None, kat
    stil, einsatz = zuordnung
    # Die Ausweichquellen greifen nur, wenn die CSV das Feld nicht hat — und sie muessen denselben
    # Plausibilitaetstest bestehen wie dort (plausi.py). Sonst holt der Fallback genau die Werte zurueck,
    # die csv_de.py eben aussortiert hat: 1000PS liefert fuer die F 800 R „790770820" als Sitzhoehe.
    ps = P.erste_gute("leistung_ps", c.get("leistung_ps"), t.get("ps"), s.get("power_hp"))
    kw = P.erste_gute("leistung_kw", c.get("leistung_kw"), round(ps * 0.7355, 1) if ps else None)
    sitz_mm = P.erste_gute("sitzhoehe_mm", c.get("sitzhoehe_mm"), t.get("sitzhoehe_mm"), s.get("seat_height_mm"))
    gewicht = P.erste_gute("gewicht_fahrbereit_kg", c.get("gewicht_fahrbereit_kg"), t.get("gewicht_kg"),
                           t.get("gewicht_abs_kg"), c.get("gewicht_trocken_kg"), s.get("weight_kg"))
    ccm_roh = P.erste_gute("hubraum_ccm", c.get("hubraum_ccm"), s.get("displacement_ccm"))
    vmax_roh = P.erste_gute("hoechstgeschwindigkeit_kmh", c.get("hoechstgeschwindigkeit_kmh"), t.get("vmax"))
    # Auch hier die Klasse gegen § 6 FeV gegenrechnen, nicht nur uebernehmen: sonst stuende eine 38-kW-V7
    # als A2 im Katalog, sobald die CSV-Spalte einmal leer ist und der Fallback auf die Quelle zurueckfaellt.
    lic = P.fahrerlaubnis(klasse(c.get("fuehrerschein"), t, s), ccm_roh, kw, gewicht, vmax_roh)
    a2 = P.drosselbar(kw, gewicht, P.noetige_klasse(ccm_roh, kw, gewicht, vmax_roh)) == "ja"
    modell = (liste_bike or {}).get("model") or modellname(b["model"], p)
    name = f"{b['make']} {modell}"
    jahre = [zahl(c.get("baujahr_von")), zahl(c.get("baujahr_bis"))]
    e = {
        "slug": b["slug"], "name": (frei_bike or {}).get("name") or name, "brand": b["make"],
        "bgText": modell,
        "model": str(b["year"]),
        "jahre": [int(jahre[0]), int(jahre[1])] if all(jahre) else (
            [b["years_in_csv"][0], b["years_in_csv"][-1]] if b.get("years_in_csv") else None),
        # Gattung und Zweck kommen aus diesem Lauf, nicht aus der Bildwerkstatt: einbau.py leitet sie
        # aus der Bikez-Kategorie ab, hier laufen daneben die gemessenen Korrekturen (Baureihen-Namen,
        # Supermoto-Gewicht, Cruiser-Sitzhoehe, Gelaende als Hauptzweck — 20.09., 63 Bikes umgestuft).
        # Ohne diesen Vorrang machte der Einbau die Korrekturen fuer jedes freigegebene Bike rueckgaengig.
        "style": stil, "use": einsatz,
        "uses": [(frei_bike or {}).get("use") or einsatz] + [z for z in ZWEITZWECK.get(stil, []) if z != einsatz],
        "cc": round(zahl(c.get("hubraum_ccm")) or s.get("displacement_ccm") or 0) or None,
        "ps": round(ps) if ps else None, "kw": round(kw) if kw else None,
        "torque": zahl(c.get("drehmoment_nm")) or zahl(t.get("nm")) or zahl(s.get("torque_nm")),
        "weight": round(gewicht) if gewicht else None,
        "seat_height": round(sitz_mm / 10, 1) if sitz_mm else None,
        "tank": zahl(c.get("tank_l")) or zahl(t.get("tank_l")) or None,
        "gear": gaenge_text(c.get("gaenge") or t.get("gaenge"), stil),
        "topSpeed": zahl(c.get("hoechstgeschwindigkeit_kmh")) or zahl(t.get("vmax")), "accel": None,
        # Für die Passung über die reine Gattung hinaus: Charakter (Zylinder, Antrieb) und laufende Kosten.
        # Zahl und Bauform getrennt (plausi.zylinder_teilen): nach „V2" laesst sich nicht nach
        # Zweizylindern filtern, nach 2 + „V" schon.
        "zylinder": int(P.als_zahl(c.get("zylinder"))) if P.als_zahl(c.get("zylinder")) else None,
        "bauart": (c.get("bauart") or "").strip() or None,
        "antrieb": (c.get("antrieb") or "").strip() or None,
        "verbrauch": zahl(c.get("verbrauch_l_100km")),
        "license": lic, "beginner": lic in ("A1", "A2", "B196") or a2, "a2": a2,
        "has3D": False, "glb": None,
    }
    # Preis. `price` ist die Mitte, mit der die Website rechnet; `priceConfidence` sagt, wie belastbar sie ist:
    # „belegt" = 1000PS-Katalogpreis oder Median aus mindestens drei Inseraten, „einzelangebot" = ein bis zwei
    # echte Inserate. Geschätzt wird nie — in derselben Klasse liegen die Preise um den Faktor vier auseinander.
    if c.get("preis_mitte_eur"):
        e["price"] = int(zahl(c["preis_mitte_eur"]))
        e["priceNew"] = int(zahl(c["preis_neu_eur"])) if c.get("preis_neu_eur") else None
        e["priceUsed"] = int(zahl(c["preis_gebraucht_eur"])) if c.get("preis_gebraucht_eur") else e["price"]
        e["priceFrom"] = int(zahl(c["preis_von_eur"])) if c.get("preis_von_eur") else None
        e["priceTo"] = int(zahl(c["preis_bis_eur"])) if c.get("preis_bis_eur") else None
        e["priceConfidence"] = c.get("preis_sicherheit") or "belegt"
        e["priceYear"] = c.get("preis_jahr") or None
        e["priceSource"] = c.get("preisquelle") or None
        e["listings"] = int(zahl(c.get("angebote_gebraucht")) or zahl(c.get("inserate")) or 0) or None
    if p and p.get("jahre"):
        e["priceYears"] = {y: v for y, v in p["jahre"].items()}
        e["priceYear"] = p.get("jahr_preis") or e.get("priceYear")
    for k in ("image", "image2", "studio"):
        if frei_bike and frei_bike.get(k):
            e[k] = frei_bike[k]
    if frei_bike:
        e["freigegeben"] = True
        for k in ("accel", "topSpeed", "tank", "gear", "weight", "seat_height"):
            if e.get(k) in (None, "") and frei_bike.get(k) not in (None, ""):
                e[k] = frei_bike[k]
        if frei_bike.get("price") and not e.get("price"):
            e["price"] = int(frei_bike["price"])
            e["priceConfidence"] = "einzelangebot"
    return e, kat


# Baureihen, deren Gattung am Namen festgemacht ist (2026-09-20). Die Bikez-Kategorie liegt bei ganzen
# Modellreihen daneben: die Multistrada stand als „Sportbike", die V-Strom 650 als „Naked", die Tiger 1200
# als „Naked". Diese Namen sind keine Vermutung — sie bezeichnen die Bauart der Baureihe selbst, und zwar
# über alle Baujahre hinweg. Geprüft am 20.09.: 67 von 265 so erkannten Bikes standen falsch.
#
# Reiseenduros bleiben „Enduro", nicht „Touring": wer im Quiz „Enduro / Offroad" wählt, erwartet die GS und
# die Africa Twin. Ihren zweiten Zweck (Touring) tragen sie ohnehin in `uses`.
BAUREIHEN = [
    # "Adventure" ergänzt am 25.09.: acht KTM-Modelle (1050/1190/1290 Super Adventure S/T/R, 790 Adventure R
    # u.a.) standen als "Naked" — sie kamen über die Bikez-Sammelkategorie "Allround", die STIL pauschal auf
    # Naked mappt (Nutzer-Test "Naked ausgewählt, aber kein Naked Bike"). Geprüft gegen den ganzen Katalog:
    # trifft ausschließlich KTM/BMW/Honda-Adventure-Modelle, alle davon gehören zur Enduro-Familie.
    ("Enduro", r"\bv-?strom\b|\bvaradero\b|\btransalp\b|\btiger \d|\bt[eé]n[eé]r[eé]\b|\bmultistrada\b"
               r"|\bversys\b|\bnc\d+x\b|\bcrosstourer\b|\bpan america\b|\bnorden\b|\bhimalayan\b"
               r"|\bdesert ?x\b|\b[rfgk] \d+ gs\b|\bgs adventure\b|\bdl\d+\b|\bcaponord\b|\bstelvio\b"
               r"|\bafrica twin\b|\bexplorer\b|\badventure\b"),
    # "Tiger sport" absichtlich hier und NICHT im Enduro-Muster oben: die Sport-Variante der Tiger-Reihe ist
    # straßenorientiert (Triumph selbst führt sie als Sporttourer), die Tiger Sport 660 steht deshalb schon
    # richtig hier — die 1050er stand bisher als "Naked" (Allround-Default) und zieht jetzt nach.
    ("Touring", r"\bfjr\b|\bk 1600\b|\belectra glide\b|\broad glide\b|\bultra\b|\bdeauville\b"
                r"|\bpan european\b|\bst1[13]00\b|\bgtr\b|\bconcours\b|\btrophy\b|\bvoyager\b"
                r"|\bnt\d+\b|\b[rfk] \d+ rt\b|\btracer\b|\bgold ?wing\b(?!.*f6c)|\btiger sport\b"),
    ("Cruiser", r"\bsportster\b|\bsoftail\b|\bfat ?boy\b|\bfat ?bob\b|\bvulcan\b|\bshadow\b|\brebel\b"
                r"|\bbolt\b|\bintruder\b|\bmarauder\b|\bmidnight star\b|\bxvs\d|\bvn ?\d|\bvirago\b"
                r"|\bdrag ?star\b|\bboulevard\b|\bchief\b|\bscout\b|\bmeteor 350\b|\bbobber\b"
                r"|\brocket 3\b|\bgold ?wing f6c\b"),
    ("Sportbike", r"\bpanigale\b|\brsv4\b|\byzf-?r[16]\b|\bzx-?\d+r\b|\bcbr\d+r{0,2}\b|\bgsx-?r\d"
                  r"|\bs 1000 rr\b|\bfireblade\b|\bdaytona\b"),
]


def baureihe_stil(name):
    """Die Gattung, die der Name der Baureihe festlegt — oder None."""
    n = (name or "").lower()
    for stil, muster in BAUREIHEN:
        if re.search(muster, n):
            return stil
    return None



def stil_pruefen(e):
    """Offensichtlich falsche Gattungen geraderücken.

    Die Bikez-Kategorie „Super motard" ist ein Sammelbecken: 40 von 65 so eingeordneten Maschinen sind
    Reiseenduros und Tourer (V-Strom 650, Tracer 900, Transalp, Pan America). Eine Supermoto ist leicht und
    hat einen kleinen Tank — wiegt die Maschine 195 kg oder mehr oder fasst sie 17 Liter, ist sie keine.
    Sie wird dann nach ihrer Sitzhöhe eingeordnet: hoch heißt Enduro, sonst Naked. Geraten wird dabei
    nichts, entschieden wird nach gemessenen Werten aus dem CSV.
    """
    # Gelaendebetonte Enduro: hohe Sitzbank und leicht. Ohne diese Zuordnung traegt kein einziges Bike
    # im Katalog "Gelande" als Hauptzweck - die Quizantwort "Gelaende / Offroad" konnte also nie die
    # volle Punktzahl erreichen, sie kam immer nur ueber den Zweitzweck (60 %). Die Grenze bei 150 kg
    # haelt die Reiseenduros draussen (KTM 950 Adventure: 91,5 cm, aber 198 kg).
    if (e.get("style") == "Enduro" and (e.get("seat_height") or 0) >= 90
            and 0 < (e.get("weight") or 999) <= 150 and e.get("use") != "Gelande"):
        e["use"] = "Gelande"
        e["uses"] = ["Gelande"] + [z for z in ZWEITZWECK.get("Enduro", []) if z != "Gelande"]
        return True

    # Erst der Name: er ist der stärkere Beleg als die Bikez-Kategorie.
    soll = baureihe_stil(e.get("name"))
    if soll and soll != e.get("style"):
        e["style"] = soll
        # „Touring" ist der Wert, den der Katalog sonst führt; das Quiz fragt „Urlaub" und übersetzt
        # ihn (USE_ALIASES in matching.js). Stünde hier „Urlaub", fände die Übersetzung nichts.
        einsatz = {"Enduro": "Touring", "Touring": "Touring", "Cruiser": "Cruisen", "Sportbike": "Rennstrecke"}[soll]
        e["use"] = einsatz
        e["uses"] = [einsatz] + [z for z in ZWEITZWECK.get(soll, []) if z != einsatz]
        return True

    # Ein Cruiser ist über die niedrige Sitzbank definiert. Sitzt die Maschine 82 cm hoch oder
    # höher, ist sie keiner: die Indian FTR 1200 S (84 cm) ist ein Flat-Track-Naked.
    if e.get("style") == "Cruiser" and (e.get("seat_height") or 0) >= 82:
        e["style"] = "Naked"
        e["use"] = "Pendeln"
        e["uses"] = ["Pendeln"] + [z for z in ZWEITZWECK.get("Naked", []) if z != "Pendeln"]
        return True

    if e.get("style") != "Supermoto":
        return False
    schwer = (e.get("weight") or 0) >= 195
    grosser_tank = (e.get("tank") or 0) >= 17
    if not (schwer or grosser_tank):
        return False
    neu = "Enduro" if (e.get("seat_height") or 0) >= 82 else "Naked"
    e["style"] = neu
    einsatz = "Touring" if neu == "Enduro" else "Pendeln"
    e["use"] = einsatz
    e["uses"] = [einsatz] + [z for z in ZWEITZWECK.get(neu, []) if z != einsatz]
    return True


# Reine Motocross-Baureihen an ihrer Werksbezeichnung (2026-09-20). Ueber die Messwerte sind sie nicht
# von zugelassenen Enduros zu trennen: eine KTM 500 EXC-F (106 kg) faehrt mit Kennzeichen, eine Yamaha
# YZ250 (103 kg) nicht, und beide haben weder Hoechstgeschwindigkeit noch Verbrauch im Datensatz. Die
# Hersteller selbst trennen es aber im Namen - YZ, KX, SX, FC/TC, MC, RM-Z und CRF-R sind Motocross,
# WR, KLX, EXC, FE/TE, EC und CRF-L die zugelassenen Schwestern. Bei KTM steht die Zahl vor dem Kuerzel
# (125 SX), sonst traefe es die Aprilia SX 125 und die Kawasaki Ninja H2 SX. Geprueft: 14 Treffer, keiner
# davon eine Strassenmaschine.
#
# Nachtrag 19:55: dazu SMR — KTMs Supermoto-Rennmaschine auf Motocross-Basis (450 SMR: 89,8 cm Sitzhoehe,
# 109 kg, weder Hoechstgeschwindigkeit noch Verbrauch). Die 690 SMC R heisst anders und bleibt. Die Beta
# RR Racing und die Vespa GTS Super Racing Sixties fuehren Verbrauchswerte, sind also zugelassen.
MOTOCROSS = (r"\byz ?\d|\bkx ?\d|(?:^|\s)\d{3} ?sx-?f?(?:\s|$)|\bsx-e\b|\bfc ?\d{3}|\btc ?\d{3}"
             r"|\bmc ?\d{3}|\brm-?z|\bcrf ?\d+ ?rx?\b|\bkxf\b|\bsmr\b")
MOTOCROSS_AUSNAHME = r"yzf|\bklx|\bexc|\bfe ?\d|\bte ?\d|\bec ?\d"


def wettbewerbsmaschine(e):
    """Kinder- und Wettbewerbsmaschinen erkennen, die keine Straßenzulassung haben.

    Nutzer 2026-09-19: „die ohne Straßenzulassung brauchen wir nicht". Über die Bikez-Kategorie
    fallen Motocross und Trial schon weg, „Enduro / offroad" aber nicht — dort standen noch die
    Kinder-Crossmaschinen: Kawasaki KLX 110R (68 cm Sitzhöhe, 76 kg), Yamaha TT-R110E, Honda
    CRF110F und CRF125F, dazu die GASGAS TXT 280 Pro (Trial, 65 cm, 68 kg). Die CRF125F war am
    20.09. sogar das drittsichtbarste Bike ohne Bild — sie wurde Erwachsenen als A1-Enduro
    angeboten.

    Erkannt wird an vier Werten zusammen, nicht an einem: niedrige Sitzhöhe, geringes Gewicht,
    keine Höchstgeschwindigkeit und kein Verbrauch. Die beiden letzten stehen bei jeder
    zugelassenen Maschine im Datensatz — eine Maschine ohne Straßenzulassung wird nicht auf
    Verbrauch geprüft.
    """
    name = (e.get("name") or "").lower()
    if re.search(MOTOCROSS, name) and not re.search(MOTOCROSS_AUSNAHME, name):
        return True
    if e.get("style") not in ("Enduro", "Supermoto"):
        return False
    sitz, gewicht = e.get("seat_height"), e.get("weight")
    if not sitz or not gewicht:
        return False
    # Grenze 80 cm (vorher 75): die Kawasaki KLX 140R sitzt 78 cm hoch und wiegt 93 kg — auch ein
    # Jugend-Crossrad. Gemessen am 20.09.: die Anhebung trifft genau dieses eine Bike zusätzlich,
    # alle Strassenmaschinen in dem Sitzhöhenfenster haben Höchstgeschwindigkeit oder Verbrauch.
    return sitz < 80 and gewicht < 100 and not e.get("topSpeed") and not e.get("verbrauch")



def preis_pruefen(e):
    """Unglaubwürdige Jahrespreise entfernen.

    Alte Baujahre sind billig — eine ZX-6R von 1999 für 1.608 € ist kein Fehler, sondern der Gebrauchtmarkt,
    und genau solche Angebote sollen bleiben (Nutzer: „es dürfen auch alte ich will auch gebrauchte haben").
    Unglaubwürdig ist nur das junge Baujahr weit unter dem eigenen Schnitt: die Indian FTR stand mit 614 €
    für 2023 im Katalog, neben 3.478 € für 2024. Solche Jahre fliegen raus, der Preis wird aus dem jüngsten
    verbliebenen Jahr neu bestimmt.
    """
    jahre = {int(y): v for y, v in (e.get("priceYears") or {}).items() if v}

    # Jahrespreise von vor der Bauzeit gehören zu einem anderen Motorrad. Die Kawasaki Z650 gibt es
    # zweimal: 1976–1983 und wieder ab 2017. 1000PS führt beide unter demselben Modell, und dadurch
    # stand die moderne Z650 (649 ccm, 50 kW, Baujahr 2022) mit 2.450 € aus dem Jahr 1979 im Katalog —
    # das Matching bietet den günstigsten Jahrespreis an, also bekam sie jeder mit kleinem Budget.
    # Die Yamaha R1 von 2021 stand so mit 3.273 € (Jahrgang 1999) da. Betroffen waren 200 von 1200
    # Einträgen (20.09.2026). Ein Jahr Vorlauf bleibt erlaubt: Modelljahre beginnen oft im Herbst davor.
    bauzeit = e.get("jahre") or []
    vorher = 0
    if bauzeit and jahre:
        grenze = int(bauzeit[0]) - 1
        fremd = [y for y in jahre if y < grenze]
        for y in fremd:
            jahre.pop(y)
            e["priceYears"].pop(str(y), None)
        vorher = len(fremd)
        if fremd and jahre:
            # Steht der Preis selbst auf einem verworfenen Jahr, kommt er aus dem ältesten verbliebenen.
            if str(e.get("priceYear") or "").isdigit() and int(e["priceYear"]) < grenze:
                alt_jahr = min(jahre)
                e["price"] = jahre[alt_jahr]
                e["priceUsed"] = jahre[alt_jahr]
                e["priceYear"] = str(alt_jahr)
                e["priceSource"] = f"1000PS Marktpreis {alt_jahr}"

    if len(jahre) < 2:
        return vorher
    mitte = sorted(jahre.values())[len(jahre) // 2]
    frisch = date.today().year - 3
    faul = [y for y, v in jahre.items() if y >= frisch and v < 0.4 * mitte]
    if not faul:
        return vorher
    for y in faul:
        jahre.pop(y)
        e["priceYears"].pop(str(y), None)
    jung = max(jahre)
    if e.get("price") and e["price"] < 0.4 * mitte:
        e["price"] = jahre[jung]
        e["priceUsed"] = jahre[jung]
        e["priceYear"] = str(jung)
        e["priceSource"] = f"1000PS Marktpreis {jung} (unglaubwürdiger Preis für {', '.join(str(y) for y in faul)} verworfen)"
    return vorher + len(faul)


def technik_pruefen(e):
    """Werte geraderuecken, die einander widersprechen. Gibt die Zahl der Korrekturen zurueck.

    Gefunden am 20.09. ueber eine Plausibilitaetspruefung des ganzen Katalogs:

    · Sitzhoehe als Einheitenfehler: die BMW F 800 R stand mit 79.077.082 cm, die Aprilia Tuono V4
      mit 8,7 cm. Steht der Wert knapp unter dem Plausiblen, ist er in Zentimetern statt Millimetern
      angegeben und wird mal zehn genommen; ist er voellig unsinnig, faellt er weg. Geraten wird
      nichts - eine fehlende Sitzhoehe bekommt im Matching die halbe Punktzahl.

    · Fuehrerschein gegen Leistung: acht Maschinen standen als A2 mit 77 bis 84 kW (KTM 790 Duke,
      Kawasaki Z900RS, Yamaha MT-09 SP, Ducati Hypermotard 950). Sie sind als A2 eingetragen, weil es
      sie gedrosselt gibt - dann gehoert das auch so in die Daten: Klasse A, drosselbar. Sonst
      bekommt ein A2-Fahrer die volle Leistung angezeigt und keinen Hinweis auf die Drosselung.
      Umgekehrt kann eine Maschine ueber 125 ccm oder ueber 11 kW keine A1-Maschine sein.
    """
    n = 0
    s = e.get("seat_height")
    if isinstance(s, (int, float)) and s:
        if not (55 <= s <= 110):
            e["seat_height"] = round(s * 10, 1) if 5.5 <= s <= 11 else None
            n += 1

    # Die Klasse zum Schluss noch einmal gegen § 6 FeV rechnen — hier stehen Gewicht und Sitzhoehe final,
    # und nur hier ist das Leistungsgewicht bekannt. Ohne das rutscht die TT-R 125 als A1 durch: 124 ccm und
    # 11 kW halten die Grenzen ein, 11 kW auf 78 kg sind aber 0,14 kW/kg und damit A2.
    kw, cc = e.get("kw"), e.get("cc")
    war = e.get("license")
    e["license"] = P.fahrerlaubnis(war, cc, kw, e.get("weight"), e.get("topSpeed"))
    if e["license"] != war:
        if war == "A2":
            e["a2"] = True                            # als A2 gefuehrt heisst: es gibt sie gedrosselt
        e["beginner"] = e["license"] in ("A1", "A2", "B196") or bool(e.get("a2"))
        n += 1
    return n



def verbreitung(b, p, e, c=None):
    """0–1: Neuzulassungen, sonst die Marktpräsenz (1000PS-Inserate, echte Gebrauchtangebote) und die Bewertung."""
    z = ZULASSUNGEN.get((b["make"], b["model"].lower()))
    teil = []
    if z:
        teil.append(("zulassungen", min(1.0, math.log10(1 + z) / math.log10(1 + 20000)), 0.6))
    inserate = max((p or {}).get("inserate") or 0, int(zahl((c or {}).get("angebote_gebraucht")) or 0))
    teil.append(("markt", min(1.0, math.log10(1 + inserate) / math.log10(1 + 200)), 0.3 if z else 0.7))
    r = zahl(b.get("rating"))
    if r:
        teil.append(("bewertung", max(0.0, min(1.0, (r - 2.5) / 2.0)), 0.1))
    gewicht = sum(w for _, _, w in teil)
    return round(sum(v * w for _, v, w in teil) / gewicht, 3) if gewicht else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", action="store_true", help="zusätzlich das Bikez-CSV mit Preisspalten schreiben")
    a = ap.parse_args()

    familien = json.loads(DE.read_text())
    preise = json.loads(PREISE.read_text()) if PREISE.exists() else {}
    if not CSV_DE.exists():
        raise SystemExit(f"{CSV_DE} fehlt — erst .venv/bin/python csv_de.py laufen lassen.")
    csv_de = {z["slug"]: z for z in csv.DictReader(CSV_DE.open(encoding="utf-8"))}
    liste = json.loads(LISTE.read_text())
    frei = {f["slug"]: f for f in freigegebene()}

    # Listen-Bikes (bikes.100.json) und freigegebene Bilder an die Familien hängen. Zuerst über den genauen
    # CSV-Namen: nach norm() fallen „f 650 gs" (798er Twin) und „f650gs" (652er Einzylinder) zusammen, und der
    # später angehängte Listeneintrag ohne Bild verdeckte das freigegebene (22.09.: F 650 GS, TT-R125 LW E).
    nach_modell, nach_csv = {}, {}
    for lb in liste:
        nach_csv[(norm(lb["make"]), lb["_matched_csv_model"].strip().lower())] = lb
        nach_modell[(norm(lb["make"]), norm(lb["_matched_csv_model"]))] = lb
        nach_modell.setdefault((norm(lb["make"]), norm(lb["model"])), lb)

    katalog, ohne_preis, mit_bild = [], 0, 0
    verworfene_preise = 0
    umgestufte = 0
    ohne_zulassung = 0
    widersprueche = 0
    ohne_stil = 0
    unbekannte_kategorien = set()
    for b in familien:
        p = preise.get(b["slug"])
        c = csv_de.get(b["slug"])
        lb = (nach_csv.get((norm(b["make"]), b["model"].strip().lower()))
              or nach_modell.get((norm(b["make"]), norm(b["model"]))))
        fb = frei.get(lb["slug"]) if lb else None
        if not c and not lb:
            continue                                  # steht nicht im geprüften CSV: kein Handelsnachweis
        if ((c or {}).get("fuehrerschein") == "AM" or (p or {}).get("technik", {}).get("fuehrerschein") == "AM"):
            continue                                  # Mofa/Moped bis 45 km/h — das Quiz kennt die Klasse nicht
        if (b["specs"].get("category") or "") in OHNE_STRASSE and not lb:
            continue                                  # Motocross, Trial: keine Straßenzulassung
        if (b["specs"].get("displacement_ccm") or 999) < 90 and not lb:
            continue                                  # Mopeds und 50er: das Quiz kennt die Klasse AM nicht
        e, kat = eintrag(b, p, lb, fb, c)
        if e is None:
            ohne_stil += 1
            unbekannte_kategorien.add(kat)
            continue                                  # Kategorie weder per Slug noch per STIL zuordenbar
        verworfene_preise += preis_pruefen(e)
        umgestufte += stil_pruefen(e)
        widersprueche += technik_pruefen(e)
        if e["license"] == "AM":
            continue                                  # Mofa/Moped: das Quiz kennt die Klasse nicht
        # Der Schutz gilt den 227 handverlesenen Bikes, nicht den automatisch nach Sichtbarkeit
        # nachgezogenen — die fünf Kinder-Crossmaschinen kamen selbst aus dieser Automatik.
        handverlesen = bool(lb) and not str(lb.get("_quelle") or "").startswith("sichtbarkeit")
        if wettbewerbsmaschine(e) and not handverlesen:
            ohne_zulassung += 1
            continue                                  # Kinder-Cross, Trial: keine Straßenzulassung
        e["pop"] = verbreitung(b, p, e, c)
        if lb:
            e["liste"] = True
        katalog.append(e)
        ohne_preis += not e.get("price")
        mit_bild += bool(fb)

    # Bikez führt dasselbe Modell mehrfach (mt-07 / mt-07 abs, tnt 125 / tnt 125 …). Zusammenfassen: gleiches
    # 1000PS-Modell oder gleicher Anzeigename → der Eintrag mit dem jüngsten Baujahr gewinnt, fehlende Werte
    # kommen aus dem anderen.
    zusammen = {}
    for e in katalog:
        p = preise.get(e["slug"]) or {}
        # Zusammengefasst wird über den Anzeigenamen, nicht über die 1000PS-Nummer: MT-07 und MT-07 TR
        # tragen verschiedene Nummern, heißen aber beide „Yamaha MT-07" — zwei gleich benannte Karten
        # kann auf der Website niemand auseinanderhalten. (Vorher blieben so 296 Doppelgänger stehen.)
        kennung = ("name", norm(e["name"]))
        alt_e = zusammen.get(kennung)
        if not alt_e:
            zusammen[kennung] = e
            continue
        # Dieselbe 1000PS-Nummer steht gelegentlich an zwei verschiedenen Maschinen (CBR250R und CRF250M
        # teilen sich id 1535). Zusammengefasst wird nur, was auch Gattung und Hubraum teilt — sonst
        # erschiene eine Supermoto unter dem Namen eines Sportlers.
        hub_a, hub_b = alt_e.get("cc") or 0, e.get("cc") or 0
        if hub_a and hub_b and abs(hub_a - hub_b) > 0.15 * max(hub_a, hub_b):
            zusammen[("einzeln", e["slug"])] = e
            continue
        neu_e, weg = (e, alt_e) if int(e["model"]) > int(alt_e["model"]) else (alt_e, e)
        for k, v in weg.items():
            if neu_e.get(k) in (None, "", []) and v not in (None, "", []):
                neu_e[k] = v
        neu_e["pop"] = max(neu_e.get("pop") or 0, weg.get("pop") or 0)
        zusammen[kennung] = neu_e
    katalog = list(zusammen.values())

    # Was den Hubraum-Schutz überlebt hat, steht am Ende doppelt unter demselben Namen: die BMW
    # F 650 GS gibt es als 652er Einzylinder und als 798er Twin. Zwei gleich benannte Karten kann
    # auf der Website niemand auseinanderhalten — deshalb bekommt jede den Hubraum in den Namen.
    from collections import Counter as _Counter
    doppelt = {nm for nm, c in _Counter(e["name"] for e in katalog).items() if c > 1}
    for e in katalog:
        if e["name"] in doppelt and e.get("cc"):
            e["name"] = f"{e['name']} ({e['cc']} ccm)"
            e["bgText"] = f"{e.get('bgText') or ''} ({e['cc']} ccm)".strip()

    # Preise nach der Zusammenführung erneut prüfen. Ein Eintrag ohne eigene Jahrespreise erbt sie vom
    # Doppelgänger: die Suzuki GSX-R750 (Eintrag 2008-2022) bekam so die Preise der Baureihe 1996-2007
    # und stand mit 1.200 € da, obwohl ihre Technik die der jüngeren Generation ist. Die erste Prüfung
    # läuft vor der Zusammenführung und kann das nicht sehen.
    for e in katalog:
        verworfene_preise += preis_pruefen(e)
        widersprueche += technik_pruefen(e)
    katalog.sort(key=lambda e: (-e["pop"], e["name"]))
    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    ZIEL.write_text(json.dumps({"stand": date.today().isoformat(),
                                "quelle": "daten/bikes_de.csv (1000PS de-de + Bikez, nur mit Handelsnachweis)",
                                "bikes": katalog}, ensure_ascii=False, separators=(",", ":")))
    kb = ZIEL.stat().st_size / 1024
    from collections import Counter
    if umgestufte:
        print(f"   {umgestufte} Maschinen aus der Sammelkategorie 'Super motard' nach Gewicht und Tank neu eingeordnet")
    if ohne_stil:
        roh = ", ".join(sorted(k or "(leer)" for k in unbekannte_kategorien))
        print(f"   {ohne_stil} Bikes ohne zuordenbare Kategorie ausgeschlossen (Rohkategorien: {roh})")
    if verworfene_preise:
        print(f"   {verworfene_preise} unglaubwürdige Jahrespreise verworfen (junges Baujahr weit unter dem eigenen Schnitt)")
    sicher = Counter(e.get("priceConfidence") for e in katalog if e.get("price"))
    print(f"{len(katalog)} Bikes → {ZIEL.relative_to(SITE)} ({kb:.0f} KB) · {len(katalog) - ohne_preis} mit Preis "
          f"({sicher.get('belegt', 0)} belegt, {sicher.get('einzelangebot', 0)} aus Einzelangeboten) · "
          f"{mit_bild} mit Bildern · {sum(1 for e in katalog if e.get('seat_height'))} mit Sitzhöhe")
    for k, v in Counter(e["style"] for e in katalog).most_common():
        print(f"   {v:5} {k}")
    for k, v in Counter(e["license"] for e in katalog).most_common():
        print(f"   {v:5} Führerschein {k}")

    if a.csv:
        csv_preise(preise, familien)


def csv_preise(preise, familien):
    """Das Bikez-CSV mit drei Preisspalten je Zeile (Nutzer: „ergänze das in dem csv") — das Original bleibt."""
    fam_von = {}
    for b in familien:
        p = preise.get(b["slug"])
        if p:
            fam_von[(norm(b["make"]), norm(b["_matched_csv_model"]))] = p
    rows = list(csv.DictReader(open(CSV_EIN, encoding="utf-8", errors="replace")))
    felder = list(rows[0].keys()) + ["Preis neu (EUR)", "Preis gebraucht (EUR)", "Preis Mitte (EUR)", "Preisquelle"]
    CSV_AUS.parent.mkdir(parents=True, exist_ok=True)
    getroffen = 0
    with open(CSV_AUS, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=felder)
        w.writeheader()
        for r in rows:
            p = fam_von.get((norm(r.get("Brand")), norm(r.get("Model"))))
            if p:
                # Preis des Baujahrs dieser Zeile; hat 1000PS dafür keinen, das nächste Jahr (höchstens ±2),
                # sonst bleibt die Zeile leer — geraten wird nicht.
                jahr = int(r["Year"]) if (r.get("Year") or "").strip().isdigit() else None
                jahre = {int(y): v for y, v in p["jahre"].items()}
                nah = min(jahre, key=lambda y: abs(y - jahr)) if jahr and jahre else None
                gebraucht = jahre.get(nah) if nah is not None and abs(nah - jahr) <= 2 else None
                neu = p["neu"]
                if gebraucht:
                    r["Preis neu (EUR)"] = round(neu) if neu else ""
                    r["Preis gebraucht (EUR)"] = round(gebraucht)
                    r["Preis Mitte (EUR)"] = round((neu + gebraucht) / 2) if neu else round(gebraucht)
                    r["Preisquelle"] = f"1000PS Marktpreis {nah}" + ("" if nah == jahr else f" (nächstes Baujahr zu {jahr})")
                    getroffen += 1
            w.writerow(r)
    print(f"{getroffen}/{len(rows)} CSV-Zeilen mit Preis → {CSV_AUS.relative_to(HERE)}")


if __name__ == "__main__":
    main()
