"""Übersicht der kurvigsten Strecken für niedrige Zoomstufen.

Weit herausgezoomt zeigt die Karte nur Strecken ab Kurvigkeit 1500. Statt dafür
zwanzig und mehr 1°-Kacheln zu laden, steht alles in einer kleinen Datei:
Linien vereinfacht (Douglas-Peucker, 80 m — bei Zoom < 9,5 ist ein Pixel ≥ 150 m), ids wie in den Kacheln
("<zelle>:<nr>"), damit ein Klick die volle Strecke aus der Kachel holt.

Aufruf (nach bauen.py):  python scripts/kurven/uebersicht.py
Ausgabe: public/data/kurven/uebersicht.json  [[id, name, kurvig, laenge, linie], …]
"""
import glob, json, math, os

ORDNER = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data', 'kurven')
AB = 1500
TOLERANZ_M = 80


def dekodieren(s):
    pts, i, lat, lng = [], 0, 0, 0
    def zahl():
        nonlocal i
        e = sh = 0
        while True:
            b = ord(s[i]) - 63; i += 1
            e |= (b & 0x1f) << sh; sh += 5
            if b < 0x20: break
        return ~(e >> 1) if e & 1 else e >> 1
    while i < len(s):
        lat += zahl(); lng += zahl(); pts.append((lat / 1e5, lng / 1e5))
    return pts


def kodieren(pts):
    aus, pl, pg = [], 0, 0
    def zahl(v):
        v = ~(v << 1) if v < 0 else v << 1
        while v >= 0x20:
            aus.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
        aus.append(chr(v + 63))
    for a, b in pts:
        la, lo = round(a * 1e5), round(b * 1e5)
        zahl(la - pl); zahl(lo - pg); pl, pg = la, lo
    return ''.join(aus)


def vereinfachen(pts):
    if len(pts) < 3: return pts
    k = math.cos(math.radians(pts[0][0]))
    xy = [(b * 111320 * k, a * 110540) for a, b in pts]
    behalten = [False] * len(pts); behalten[0] = behalten[-1] = True
    stapel = [(0, len(pts) - 1)]
    while stapel:
        s, e = stapel.pop()
        (x1, y1), (x2, y2) = xy[s], xy[e]
        dx, dy = x2 - x1, y2 - y1; l = math.hypot(dx, dy) or 1e-9
        best, bi = 0, -1
        for i in range(s + 1, e):
            d = abs(dy * (xy[i][0] - x1) - dx * (xy[i][1] - y1)) / l
            if d > best: best, bi = d, i
        if best > TOLERANZ_M:
            behalten[bi] = True; stapel += [(s, bi), (bi, e)]
    return [p for p, b in zip(pts, behalten) if b]


def main():
    aus = []
    for f in sorted(glob.glob(os.path.join(ORDNER, '*_*.json'))):
        zelle = os.path.basename(f)[:-5]
        for i, (name, kurvig, laenge, linie) in enumerate(json.load(open(f))):
            if kurvig >= AB:
                aus.append([f'{zelle}:{i}', name, kurvig, laenge, kodieren(vereinfachen(dekodieren(linie)))])
    ziel = os.path.join(ORDNER, 'uebersicht.json')
    with open(ziel, 'w') as fh:
        json.dump(aus, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(aus)} Strecken, {os.path.getsize(ziel) // 1024} KB → {ziel}')


if __name__ == '__main__':
    main()
