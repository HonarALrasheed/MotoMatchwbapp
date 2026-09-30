#!/usr/bin/env python3
"""
MotoMatch — Abnahme fuer daten/bikes_de.csv (2026-09-27).

Nutzer: „ich will das es wasser dicht mit den klassen, preisen sitzhoehen usw passt."

Prueft die fertige CSV gegen dieselben Regeln, nach denen csv_de.py sie baut (plausi.py). Das Skript kennt
die Quellen nicht — es sieht nur das Ergebnis. Faellt hier etwas auf, ist es wirklich in der Datei gelandet.

Endet mit Rueckgabewert 1, sobald ein harter Verstoss drinsteht. Weiche Befunde (Luecken, alte Preisstaende)
werden nur gezaehlt: sie sind keine Fehler, sondern Abdeckung, und geraten wird nichts.

    .venv/bin/python pruefe_csv.py            # → Bericht, Rueckgabewert 0 oder 1
    .venv/bin/python pruefe_csv.py --zeigen 20
"""
import argparse
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

import plausi as P

CSV = Path(__file__).parent / "daten" / "bikes_de.csv"


def z(r, k):
    return P.als_zahl(r.get(k))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zeigen", type=int, default=5, help="Beispiele je Befund")
    ap.add_argument("--csv", default=str(CSV))
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.csv, encoding="utf-8")))
    hart, weich = Counter(), Counter()
    bsp = defaultdict(list)

    def melde(zaehler, name, r, text=""):
        zaehler[name] += 1
        if len(bsp[name]) < args.zeigen:
            bsp[name].append(f"{r['slug']}{' ' + text if text else ''}")

    slugs = Counter(r["slug"] for r in rows)
    for s, n in slugs.items():
        if n > 1:
            hart["doppelter slug"] += 1
            bsp["doppelter slug"].append(s)

    for r in rows:
        ccm, ps, kw = z(r, "hubraum_ccm"), z(r, "leistung_ps"), z(r, "leistung_kw")
        gn, gt = z(r, "gewicht_fahrbereit_kg"), z(r, "gewicht_trocken_kg")
        kg, vmax = gn or gt, z(r, "hoechstgeschwindigkeit_kmh")

        # --- Zahlenbereiche
        for feld in P.BEREICHE:
            v = r.get(feld)
            if v and str(v).strip() and not P.plausibel(feld, v):
                # „Automatic" in gaenge ist ein Wort, keine kaputte Zahl.
                if feld == "gaenge" and not str(v)[0].isdigit():
                    continue
                # zylinder ist seit der Trennung rein numerisch — Text darin ist jetzt ein Fehler.
                melde(hart, f"{feld} ausserhalb {P.BEREICHE[feld]}", r, str(v))

        # --- Leistung: PS und kW sind dieselbe Angabe
        if ps and kw and abs(ps * 0.7355 - kw) > max(2.0, kw * 0.05):
            melde(hart, "PS und kW passen nicht zueinander", r, f"{ps:.0f} PS / {kw:.0f} kW")

        # --- Fahrerlaubnis nach § 6 FeV
        fs = (r.get("fuehrerschein") or "").strip()
        teile = [t.strip() for t in fs.split(",") if t.strip() in P.RANG]
        if teile and (ccm or kw):
            niedrigste = min(teile, key=lambda k: P.RANG[k])
            noetig = P.noetige_klasse(ccm, kw, kg, vmax)
            if P.RANG[niedrigste] < P.RANG[noetig]:
                melde(hart, "Klasse zu niedrig fuer die Technik", r,
                      f"{fs} statt {noetig} ({ccm:.0f} ccm, {kw:.0f} kW"
                      + (f", {kw / kg:.2f} kW/kg" if kg else "") + ")")
        if fs and not teile:
            melde(hart, "unbekannte Fahrerlaubnisklasse", r, fs)

        # --- Drosselung
        dros = (r.get("a2_drosselbar") or "").strip()
        if dros and dros not in ("ja", "nein"):
            melde(hart, "a2_drosselbar weder ja noch nein", r, dros)
        if dros == "ja":
            if kw and kw > 70.5:
                melde(hart, "als drosselbar gefuehrt, aber ueber 70 kW", r, f"{kw:.0f} kW")
            if kw and kw <= 35.5:
                melde(hart, "als drosselbar gefuehrt, braucht aber gar keine Drosselung", r, f"{kw:.0f} kW")

        # --- Zylinder: Zahl in die eine Spalte, Bauform in die andere
        bau = (r.get("bauart") or "").strip()
        erlaubt = {b for _, b in P.ZYLINDER.values() if b}
        if bau and bau not in erlaubt:
            melde(hart, "unbekannte Bauart", r, bau)
        if (r.get("zylinder") or "").strip() and not str(r["zylinder"])[0].isdigit():
            melde(hart, "zylinder nicht numerisch", r, r["zylinder"])

        # --- Gewichte
        if gn and gt and gt >= gn:
            melde(hart, "Trockengewicht schwerer als fahrbereit", r, f"{gt:.0f} >= {gn:.0f}")

        # --- Antrieb und Getriebe sind dieselbe Angabe
        a, ge = (r.get("antrieb") or "").strip(), (r.get("getriebe") or "").strip()
        if a and ge and P.als_zahl(None) is None:
            erwartet = {"Chain": "Kette", "Belt": "Riemen", "Shaft drive": "Kardan"}.get(ge)
            if erwartet and a != erwartet and a != "direkt":
                melde(weich, "antrieb und getriebe widersprechen sich", r, f"{a} / {ge}")
        if ge and not a:
            melde(hart, "antrieb leer, obwohl getriebe gefuellt ist", r, ge)

        # --- Preise
        neu, geb = z(r, "preis_neu_eur"), z(r, "preis_gebraucht_eur")
        mi, von, bis = z(r, "preis_mitte_eur"), z(r, "preis_von_eur"), z(r, "preis_bis_eur")
        sich = (r.get("preis_sicherheit") or "").strip()
        if mi is not None and mi < 100:
            melde(hart, "preis_mitte unter 100 EUR", r, f"{mi:.0f}")
        if von is not None and bis is not None and von > bis:
            melde(hart, "preis_von groesser als preis_bis", r, f"{von:.0f} > {bis:.0f}")
        if mi is not None and von is not None and mi < von:
            melde(hart, "preis_mitte unter preis_von", r, f"{mi:.0f} < {von:.0f}")
        if mi is not None and bis is not None and mi > bis:
            melde(hart, "preis_mitte ueber preis_bis", r, f"{mi:.0f} > {bis:.0f}")
        if sich and mi is None:
            melde(hart, "preis_sicherheit gesetzt, aber kein Preis", r, sich)
        if mi is not None and not sich:
            melde(hart, "Preis ohne preis_sicherheit", r, f"{mi:.0f}")
        if neu and geb and geb > neu:
            melde(weich, "Gebrauchtpreis ueber Neupreis", r, f"{geb:.0f} > {neu:.0f}")

        # --- Baujahre
        bj, bv, bb = z(r, "baujahr"), z(r, "baujahr_von"), z(r, "baujahr_bis")
        if bv and bb and bv > bb:
            melde(hart, "baujahr_von nach baujahr_bis", r, f"{bv:.0f} > {bb:.0f}")
        if bj and bv and bb and not (bv <= bj <= bb):
            melde(hart, "baujahr ausserhalb der Spanne", r, f"{bj:.0f} nicht in {bv:.0f}..{bb:.0f}")
        pj = z(r, "preis_jahr")
        if bj and pj and pj < bj:
            melde(weich, "Preisstand aelter als das Baujahr", r, f"{pj:.0f} < {bj:.0f}")

        # --- Text
        for feld in ("bremse_vorn", "bremse_hinten", "federung_vorn", "federung_hinten", "farben",
                     "assistenz", "ausstattung", "modell", "marke"):
            v = r.get(feld) or ""
            if any(zz in v for zz in ("Ã", "�")):
                melde(hart, "kaputte Zeichen im Text", r, f"{feld}: {v[:40]}")

    print(f"{len(rows)} Zeilen aus {args.csv}\n")
    if hart:
        print("HARTE VERSTOESSE")
        for name, n in hart.most_common():
            print(f"  {n:5d}  {name}")
            for b in bsp[name]:
                print(f"           {b}")
    else:
        print("HARTE VERSTOESSE: keine")
    print()
    print("ZUR KENNTNIS (kein Fehler, aber schwach)")
    for name, n in weich.most_common():
        print(f"  {n:5d}  {name}")
        for b in bsp[name][:3]:
            print(f"           {b}")

    # Abdeckung: was leer bleibt, ist keine Falschangabe, aber es begrenzt die Suche.
    print("\nABDECKUNG (leere Felder)")
    for feld in ("hubraum_ccm", "leistung_kw", "sitzhoehe_mm", "gewicht_fahrbereit_kg", "tank_l",
                 "preis_mitte_eur", "fuehrerschein", "antrieb"):
        leer = sum(1 for r in rows if not (r.get(feld) or "").strip())
        print(f"  {feld:24s} {leer:5d} leer ({leer / len(rows) * 100:4.1f} %)")

    return 1 if hart else 0


if __name__ == "__main__":
    sys.exit(main())
