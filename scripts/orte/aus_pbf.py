"""Biker-Treffs und Ortssuch-Index direkt aus dem Deutschland-Auszug berechnen.

Ergänzt scripts/orte/bauen.mjs für die zwei Teile, an denen die öffentlichen
Overpass-Server regelmäßig scheitern (Speicherlimit, Zeitüberschreitung):
  public/data/orte/treff/<lat>_<lng>.json   Biker-Treffs (gleiches Format wie die anderen Kategorien)
  public/data/orte/suche.json               Orte (Stadt/Gemeinde/Dorf/Ortsteil) + PLZ-Mittelpunkte
und trägt "treff" in public/data/orte/index.json ein.

Aufruf: python scripts/orte/aus_pbf.py <pfad/germany-latest.osm.pbf>   (Paket "osmium")
"""

import json
import math
import os
import re
import sys
import time
from collections import defaultdict

import osmium

ZIEL = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data', 'orte')
LOKALE = {'cafe', 'restaurant', 'biergarten', 'pub', 'fast_food', 'bar'}
NAME_MOTO = re.compile(r'motorrad|biker|kradfahrer|moped|\bmoto\b|motocaf|bike', re.I)
FAHRRAD = re.compile(r'fahrrad|rad[- ]?caf|bicycle|e-?bike|mountainbike|\bmtb\b|radler', re.I)
RANG = {'city': 1, 'town': 2, 'suburb': 3, 'village': 4}


def adresse(t):
    strasse = ' '.join(x for x in (t.get('addr:street') or t.get('addr:place'), t.get('addr:housenumber')) if x)
    ort = ' '.join(x for x in (t.get('addr:postcode'), t.get('addr:city') or t.get('addr:suburb')) if x)
    return ', '.join(x for x in (strasse, ort) if x)


def web(t):
    w = t.get('website') or t.get('contact:website') or t.get('url') or ''
    return w if not w or re.match(r'^https?://', w, re.I) else f'https://{w}'


def ist_treff(t):
    if t.get('amenity') not in LOKALE:
        return False
    name = t.get('name', '')
    if t.get('motorcycle') == 'designated' or t.get('biker') == 'yes':
        return not FAHRRAD.search(name)
    return bool(name) and bool(NAME_MOTO.search(name)) and not FAHRRAD.search(name)


def main(pfad):
    t0 = time.time()
    treffs = []          # [id, name, lat, lng, adresse, tel, web, zeiten, marke]
    treff_wege = {}      # way id → (tags-Auszug, erster Knoten)
    orte = []
    plz_summe = defaultdict(lambda: [0.0, 0.0, 0, defaultdict(int)])
    plz_wege = defaultdict(list)  # erster Knoten → [postcode, stadt]

    # Durchlauf 1: Knoten (Orte, Treffs, Adressen) und Wege (Treffs, Adressen) — Wege nur mit erstem Knoten
    for o in osmium.FileProcessor(pfad, osmium.osm.NODE | osmium.osm.WAY).with_filter(osmium.filter.EmptyTagFilter()):
        t = o.tags
        if o.is_node():
            loc = o.location
            if not loc.valid():
                continue
            if t.get('place') in RANG and t.get('name'):
                orte.append([t['name'], round(loc.lat, 4), round(loc.lon, 4), RANG[t['place']], t.get('is_in:county') or ''])
            if ist_treff(t):
                treffs.append([f'n{o.id}', t.get('name', ''), round(loc.lat, 5), round(loc.lon, 5), adresse(t),
                               t.get('phone') or t.get('contact:phone') or '', web(t), t.get('opening_hours') or '', t.get('brand') or ''])
            pc = t.get('addr:postcode')
            if pc and len(pc) == 5 and pc.isdigit():
                s = plz_summe[pc]
                s[0] += loc.lat; s[1] += loc.lon; s[2] += 1
                if t.get('addr:city'):
                    s[3][t['addr:city']] += 1
        else:
            if ist_treff(t) and len(o.nodes):
                treff_wege[o.id] = ({k: t.get(k, '') for k in ('name', 'phone', 'contact:phone', 'website', 'contact:website', 'url', 'opening_hours', 'brand',
                                                            'addr:street', 'addr:place', 'addr:housenumber', 'addr:postcode', 'addr:city', 'addr:suburb')},
                                    o.nodes[0].ref)
            pc = t.get('addr:postcode')
            if pc and len(pc) == 5 and pc.isdigit() and len(o.nodes):
                plz_wege[o.nodes[0].ref].append((pc, t.get('addr:city', '')))
    print(f'Durchlauf 1: {len(orte):,} Orte, {len(treffs)} Treff-Knoten, {len(treff_wege)} Treff-Wege, '
          f'{len(plz_wege):,} Adress-Gebäude ({time.time() - t0:.0f} s)', flush=True)

    # Durchlauf 2: Koordinaten der ersten Knoten dieser Wege
    noetig = set(plz_wege) | {v[1] for v in treff_wege.values()}
    lage = {}
    for n in osmium.FileProcessor(pfad, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(noetig)):
        if n.location.valid():
            lage[n.id] = (n.location.lat, n.location.lon)
    for kn, eintraege in plz_wege.items():
        if kn not in lage:
            continue
        la, ln = lage[kn]
        for pc, stadt in eintraege:
            s = plz_summe[pc]
            s[0] += la; s[1] += ln; s[2] += 1
            if stadt:
                s[3][stadt] += 1
    for wid, (t, kn) in treff_wege.items():
        if kn in lage:
            la, ln = lage[kn]
            treffs.append([f'w{wid}', t['name'], round(la, 5), round(ln, 5), adresse(t), t['phone'] or t['contact:phone'], web(t), t['opening_hours'], t['brand']])
    print(f'Durchlauf 2 fertig ({time.time() - t0:.0f} s)', flush=True)

    # Treffs: entdoppeln (Knoten + Gebäude desselben Lokals) und kacheln
    gesehen = set()
    kacheln = defaultdict(list)
    for e in sorted(treffs, key=lambda e: e[0]):
        schluessel = (e[1].lower(), round(e[2], 3), round(e[3], 3))
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        kacheln[f'{math.floor(e[2])}_{math.floor(e[3])}'].append([v if (i < 4 or v) else 0 for i, v in enumerate(e)])
    ordner = os.path.join(ZIEL, 'treff')
    os.makedirs(ordner, exist_ok=True)
    for f in os.listdir(ordner):
        # ._-Dateien (macOS-Metadaten auf dem externen Laufwerk) verschwinden mit ihrem Partner
        try:
            os.remove(os.path.join(ordner, f))
        except FileNotFoundError:
            pass
    for zelle, liste in kacheln.items():
        with open(os.path.join(ordner, f'{zelle}.json'), 'w') as fh:
            json.dump(liste, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(ZIEL, 'index.json')) as fh:
        index = json.load(fh)
    index['kategorien']['treff'] = {'anzahl': sum(len(v) for v in kacheln.values()), 'kacheln': sorted(kacheln)}
    with open(os.path.join(ZIEL, 'index.json'), 'w') as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(',', ':'))

    plz = []
    for pc, (sla, sln, n, staedte) in sorted(plz_summe.items()):
        if n < 3:
            continue
        stadt = max(staedte, key=staedte.get) if staedte else ''
        plz.append([pc, round(sla / n, 4), round(sln / n, 4), stadt])
    with open(os.path.join(ZIEL, 'suche.json'), 'w') as fh:
        json.dump({'orte': orte, 'plz': plz}, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{index["kategorien"]["treff"]["anzahl"]} Biker-Treffs, {len(orte):,} Orte, {len(plz):,} PLZ ({time.time() - t0:.0f} s)')


if __name__ == '__main__':
    main(sys.argv[1])
