"""Kurvenstrecken für ganz Deutschland aus OpenStreetMap berechnen.

Verfahren wie bei roadcurvature.com / Kurviger (frei beschrieben, eigene Umsetzung):
für jeden Straßenknoten der Radius des Kreises durch ihn und seine Nachbarn;
Strecke in engen Radien zählt gewichtet als "Kurvigkeit" (Meter):
    Radius < 30 m → ×2,0   < 60 m → ×1,6   < 100 m → ×1,3   < 175 m → ×1,0   sonst 0
Gerade Abschnitte über 2,5 km trennen eine Straße in einzelne Kurvenstrecken.
Behalten werden Stücke mit Kurvigkeit ≥ 600 und mindestens 2 km Länge.

Eingabe:  germany-latest.osm.pbf (download.geofabrik.de, © OpenStreetMap-Mitwirkende, ODbL)
Ausgabe:  public/data/kurven/index.json + public/data/kurven/<lat>_<lng>.json (1°-Kacheln)

Aufruf:   python scripts/kurven/bauen.py <pfad/germany-latest.osm.pbf>
          (braucht das Paket "osmium"; zwei Durchläufe, ~32 GB RAM reichen bequem)
"""

import json
import math
import os
import sys
import time
from array import array
from collections import defaultdict

import osmium

STRASSEN = {'primary', 'secondary', 'tertiary', 'unclassified'}
UNBEFESTIGT = {'unpaved', 'gravel', 'fine_gravel', 'dirt', 'ground', 'earth', 'grass', 'sand', 'mud',
               'compacted', 'pebblestone', 'grass_paver', 'wood', 'woodchips', 'rock'}
GEWICHTE = [(30, 2.0), (60, 1.6), (100, 1.3), (175, 1.0)]
TRENNEN_GERADE_M = 2500
MIN_KURVIG = 600
MIN_LAENGE_M = 2000

ZIEL = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data', 'kurven')


def zeit():
    return time.strftime('%H:%M:%S')


# ── Durchlauf 1: Straßen ────────────────────────────────────────────────────
def lies_wege(pfad):
    wege = []  # (id, schlüssel, name, ref, highway, knoten-array)
    noetig = set()
    # Tag-Filter läuft in C++ — Python sieht nur die vier Straßenklassen
    fp = osmium.FileProcessor(pfad, osmium.osm.WAY).with_filter(
        osmium.filter.TagFilter(*(('highway', h) for h in STRASSEN)))
    for w in fp:
        t = w.tags
        hw = t.get('highway')
        if hw not in STRASSEN:
            continue
        if t.get('area') == 'yes' or t.get('access') in ('no', 'private') or t.get('motor_vehicle') in ('no', 'private'):
            continue
        if t.get('motorcycle') in ('no',):
            continue
        if t.get('surface') in UNBEFESTIGT or t.get('tracktype'):
            continue
        name = t.get('name', '')
        ref = t.get('ref', '')
        knoten = array('q', (n.ref for n in w.nodes))
        if len(knoten) < 2:
            continue
        schluessel = ref or name or f'#{w.id}'
        wege.append((w.id, schluessel, name, ref, hw, knoten))
        noetig.update(knoten)
    return wege, noetig


# ── Durchlauf 2: Koordinaten nur der gebrauchten Knoten ─────────────────────
def lies_knoten(pfad, noetig):
    lat, lng = {}, {}
    fp = osmium.FileProcessor(pfad, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(noetig))
    for n in fp:
        loc = n.location
        lat[n.id] = loc.lat
        lng[n.id] = loc.lon
    return lat, lng


# ── Wege derselben Straße zu Ketten verbinden ───────────────────────────────
def ketten(wege):
    nach_schluessel = defaultdict(list)
    for w in wege:
        nach_schluessel[w[1]].append(w)
    for schluessel, gruppe in nach_schluessel.items():
        offen = {w[0]: list(w[5]) for w in gruppe}
        info = {w[0]: w for w in gruppe}
        an_ende = defaultdict(set)
        for wid, kn in offen.items():
            an_ende[kn[0]].add(wid)
            an_ende[kn[-1]].add(wid)
        while offen:
            wid, kette = offen.popitem()
            for e in (kette[0], kette[-1]):
                an_ende[e].discard(wid)
            erster = info[wid]
            # nach hinten und vorne anhängen, solange ein Weg am Ende anschließt
            for richtung in (1, -1):
                while True:
                    ende = kette[-1] if richtung == 1 else kette[0]
                    kandidaten = [k for k in an_ende[ende] if k in offen]
                    if not kandidaten:
                        break
                    k = kandidaten[0]
                    kn = offen.pop(k)
                    for e in (kn[0], kn[-1]):
                        an_ende[e].discard(k)
                    if richtung == 1:
                        kette.extend(kn[1:] if kn[0] == ende else list(reversed(kn))[1:])
                    else:
                        teil = kn if kn[-1] == ende else list(reversed(kn))
                        kette[:0] = teil[:-1]
            yield erster[2], erster[3], erster[4], kette


# ── Geometrie ───────────────────────────────────────────────────────────────
R = 6371000.0


def xy(lat, lng, lat0):
    return (math.radians(lng) * R * math.cos(math.radians(lat0)), math.radians(lat) * R)


def radius(a, b, c):
    ab = math.dist(a, b)
    bc = math.dist(b, c)
    ca = math.dist(c, a)
    flaeche2 = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))
    if flaeche2 < 1e-6:
        return math.inf
    return ab * bc * ca / (2 * flaeche2)


def gewicht(r):
    for grenze, g in GEWICHTE:
        if r < grenze:
            return g
    return 0.0


def stuecke(punkte):
    """Kette in Kurvenstrecken zerlegen; liefert (kurvigkeit, länge, punkte)."""
    if len(punkte) < 3:
        return
    lat0 = punkte[0][0]
    p = [xy(la, ln, lat0) for la, ln in punkte]
    seg = [math.dist(p[i], p[i + 1]) for i in range(len(p) - 1)]
    beitrag = [0.0] * len(p)
    for i in range(1, len(p) - 1):
        # Knoten in unter 2 m Abstand verfälschen den Radius — dann übersprungen
        if seg[i - 1] < 2 or seg[i] < 2:
            continue
        g = gewicht(radius(p[i - 1], p[i], p[i + 1]))
        if g:
            beitrag[i] = g * (seg[i - 1] + seg[i]) / 2
    start = 0
    gerade = 0.0
    kurvig = 0.0
    laenge = 0.0
    letzte_kurve = 0
    for i in range(1, len(p)):
        laenge += seg[i - 1]
        if beitrag[i]:
            kurvig += beitrag[i]
            gerade = 0.0
            letzte_kurve = i
        else:
            gerade += seg[i - 1]
        if gerade > TRENNEN_GERADE_M or i == len(p) - 1:
            ende = letzte_kurve + 1 if gerade > TRENNEN_GERADE_M else i
            stueck = punkte[start:ende + 1]
            l = sum(seg[start:ende])
            if kurvig >= MIN_KURVIG and l >= MIN_LAENGE_M:
                yield kurvig, l, stueck
            start = i
            gerade = 0.0
            kurvig = 0.0
            laenge = 0.0
            letzte_kurve = i


def vereinfachen(pts, tol_m=8.0):
    if len(pts) < 3:
        return pts
    lat0 = pts[0][0]
    xyl = [xy(la, ln, lat0) for la, ln in pts]
    behalten = [False] * len(pts)
    behalten[0] = behalten[-1] = True
    stapel = [(0, len(pts) - 1)]
    while stapel:
        s, e = stapel.pop()
        (x1, y1), (x2, y2) = xyl[s], xyl[e]
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        best, idx = 0.0, -1
        for i in range(s + 1, e):
            x, y = xyl[i]
            t = ((x - x1) * dx + (y - y1) * dy) / l2 if l2 else 0
            t = max(0.0, min(1.0, t))
            d = math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
            if d > best:
                best, idx = d, i
        if best > tol_m:
            behalten[idx] = True
            stapel.append((s, idx))
            stapel.append((idx, e))
    return [q for q, b in zip(pts, behalten) if b]


def kodieren(pts):
    out = []
    plat = plng = 0
    for la, ln in pts:
        for wert, vorher in ((round(la * 1e5), plat), (round(ln * 1e5), plng)):
            v = wert - vorher
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plng = round(la * 1e5), round(ln * 1e5)
    return ''.join(out)


def main(pfad):
    print(zeit(), 'Durchlauf 1: Straßen …', flush=True)
    wege, noetig = lies_wege(pfad)
    print(zeit(), f'{len(wege):,} Wege, {len(noetig):,} Knoten', flush=True)
    print(zeit(), 'Durchlauf 2: Knoten …', flush=True)
    lat, lng = lies_knoten(pfad, noetig)
    del noetig
    print(zeit(), f'{len(lat):,} Koordinaten', flush=True)

    kacheln = defaultdict(list)
    anzahl = 0
    for name, ref, hw, kette in ketten(wege):
        punkte = [(lat[k], lng[k]) for k in kette if k in lat]
        for kurvig, laenge, stueck in stuecke(punkte):
            einfach = vereinfachen(stueck)
            mitte = einfach[len(einfach) // 2]
            zelle = f'{math.floor(mitte[0])}_{math.floor(mitte[1])}'
            bez = ' '.join(x for x in (ref, name) if x) or ''
            kacheln[zelle].append([bez, round(kurvig), round(laenge), kodieren(einfach)])
            anzahl += 1
    print(zeit(), f'{anzahl:,} Kurvenstrecken in {len(kacheln)} Kacheln', flush=True)

    os.makedirs(ZIEL, exist_ok=True)
    for f in os.listdir(ZIEL):
        if f.endswith('.json'):
            os.remove(os.path.join(ZIEL, f))
    for zelle, liste in kacheln.items():
        liste.sort(key=lambda x: -x[1])
        with open(os.path.join(ZIEL, f'{zelle}.json'), 'w') as fh:
            json.dump(liste, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(ZIEL, 'index.json'), 'w') as fh:
        json.dump({
            'stand': time.strftime('%Y-%m-%d'),
            'quelle': '© OpenStreetMap-Mitwirkende (ODbL), Kurvigkeit berechnet von MotoMatch',
            'kacheln': sorted(kacheln),
            'anzahl': anzahl,
        }, fh)


if __name__ == '__main__':
    main(sys.argv[1])
