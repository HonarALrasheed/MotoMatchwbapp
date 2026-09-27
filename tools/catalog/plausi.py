#!/usr/bin/env python3
"""
MotoMatch — Plausibilitaet und Fahrerlaubnisrecht an einer Stelle (2026-09-27).

Nutzer: „ich will das es wasser dicht mit den klassen, preisen sitzhoehen usw passt."

Bis hierher reichten csv_de.py und matching_katalog.py die Quellwerte ungeprueft durch: „der erste Treffer
gewinnt". Wenn 1000PS fuer die BMW F 800 R drei Sitzhoehen zu „790770820" verklebt, stand das so in der CSV,
obwohl Bikez daneben saubere 770 mm hatte. Und eine Moto Guzzi V7 mit 38 kW stand als „A2" drin, was es nach
§ 6 FeV nicht geben kann.

Zwei Regeln, die beide Skripte teilen:

  1. `erste_gute` nimmt den ersten Wert, der im physikalisch moeglichen Bereich liegt — nicht den ersten
     ueberhaupt. Faellt eine Quelle aus, greift die naechste, statt dass das Feld verloren geht.
  2. `fahrerlaubnis` hebt eine Klasse an, wenn die Technik sie ausschliesst. Angehoben wird nur, nie gesenkt:
     eine Quelle darf strenger sein als das Gesetz (ein Hersteller bietet keine A2-Version an), aber nie
     lockerer. Gesenkt wuerde sonst die KTM-Enduro mit 34 kW auf A2 rutschen, obwohl ihr Leistungsgewicht
     von 0,32 kW/kg das verbietet.

Geraten wird weiterhin nichts: was in keiner Quelle plausibel ist, bleibt leer.
"""
import re

# Physikalisch moegliche Bereiche fuer Strassenmotorraeder und Roller. Bewusst weit — hier sollen kaputte
# Werte raus (Jahreszahl im Radstand, drei verklebte Sitzhoehen, 189 l Tank), nicht seltene Modelle.
# Untergrenzen sind an Kleinkraftraedern ausgerichtet: die Yamaha PW50 hat 485 mm Sitzhoehe und 1,9 l Tank.
BEREICHE = {
    "hubraum_ccm": (30, 2500),
    "leistung_ps": (1, 350),
    "leistung_kw": (0.7, 260),
    "drehmoment_nm": (1, 250),
    "tank_l": (1.5, 40),
    "gewicht_fahrbereit_kg": (25, 500),
    "gewicht_trocken_kg": (20, 500),
    "sitzhoehe_mm": (400, 1000),
    "radstand_mm": (700, 1900),
    "bodenfreiheit_mm": (50, 500),
    "hoechstgeschwindigkeit_kmh": (25, 400),
    "verbrauch_l_100km": (1.5, 15),
    "reichweite_km": (20, 800),
    "bewertung": (0, 5),
    "gaenge": (1, 8),
    "zylinder": (1, 10),
}


def als_zahl(v):
    """Zahl aus Text oder Zahl; None, wenn nichts Zaehlbares drinsteht."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        # „6-speed", „18.9 l", „790 mm"
        m = re.match(r"-?\d+(?:\.\d+)?", s)
        return float(m.group(0)) if m else None


def plausibel(feld, wert):
    """Liegt der Wert im moeglichen Bereich? Unbekannte Felder werden durchgelassen."""
    z = als_zahl(wert)
    if z is None:
        return False
    lo, hi = BEREICHE.get(feld, (float("-inf"), float("inf")))
    return lo <= z <= hi


def erste_gute(feld, *kandidaten):
    """Der erste Kandidat, der im Bereich liegt. Kein Treffer → None (geraten wird nichts)."""
    for k in kandidaten:
        if plausibel(feld, k):
            return als_zahl(k)
    return None


# ---------------------------------------------------------------------------- Zylinder

# Bikez fuehrt Zahl und Bauform in einem Feld: „2", „V2", „Twin", „In-line four" stehen nebeneinander, und
# „Twin" und „2" meinen dasselbe. Fuer einen Filter braucht es die Zahl, fuer die Anzeige die Bauform —
# deshalb zwei Spalten. Wo die Quelle die Bauform nicht nennt („Twin" sagt nur: zwei Zylinder), bleibt sie
# leer, statt eine Reihenanordnung zu unterstellen.
ZYLINDER = {
    "single cylinder": (1, "Einzylinder"),
    "twin": (2, ""),
    "v2": (2, "V"),
    "v3": (3, "V"),
    "v4": (4, "V"),
    "v6": (6, "V"),
    "v8": (8, "V"),
    "v10": (10, "V"),
    "in-line three": (3, "Reihe"),
    "in-line four": (4, "Reihe"),
    "in-line six": (6, "Reihe"),
    "two cylinder boxer": (2, "Boxer"),
    "four cylinder boxer": (4, "Boxer"),
    "six cylinder boxer": (6, "Boxer"),
    "square four cylinder": (4, "Square Four"),
    "single disk wankel": (1, "Wankel"),
    "dual disk wankel": (2, "Wankel"),
    "electric": (None, "Elektro"),
    "gas turbine": (None, "Turbine"),
    "radial": (None, "Sternmotor"),
    "diesel": (None, ""),                   # Kraftstoff, keine Bauform — sagt ueber die Zylinder nichts
}


def zylinder_teilen(wert):
    """„V2" → (2, „V"), „In-line four" → (4, „Reihe"), „2" → (2, „"). Unbekanntes → (None, "")."""
    s = str(wert or "").strip()
    if not s:
        return None, ""
    if s[0].isdigit():
        z = als_zahl(s)
        return (int(z) if z and plausibel("zylinder", z) else None), ""
    return ZYLINDER.get(s.lower(), (None, ""))


# ---------------------------------------------------------------------------- Fahrerlaubnis (§ 6 FeV)

RANG = {"AM": 0, "B196": 1, "A1": 1, "A2": 2, "A": 3}

# Grenzen je Klasse: Hubraum, Leistung, Leistungsgewicht (kW je kg Leergewicht).
# AM  — Kleinkraftrad: bis 50 ccm und bauartbedingt 45 km/h, elektrisch bis 4 kW.
# A1  — Leichtkraftrad: bis 125 ccm, 11 kW und 0,1 kW/kg.
# A2  — bis 35 kW und 0,2 kW/kg (und nicht aus ueber 70 kW abgeleitet, siehe drosselbar()).
# A   — darueber alles.
GRENZEN = {
    "AM": {"ccm": 50, "kw": 4, "kw_kg": None, "kmh": 45},
    "A1": {"ccm": 125, "kw": 11, "kw_kg": 0.1, "kmh": None},
    "B196": {"ccm": 125, "kw": 11, "kw_kg": 0.1, "kmh": None},
    "A2": {"ccm": None, "kw": 35, "kw_kg": 0.2, "kmh": None},
    "A": {"ccm": None, "kw": None, "kw_kg": None, "kmh": None},
}


def _deckt_ab(klasse, ccm, kw, kg, kmh):
    """Darf man mit dieser Klasse dieses Fahrzeug fahren? Fehlende Angaben sprechen nicht dagegen."""
    g = GRENZEN.get(klasse)
    if g is None:
        return True
    if g["ccm"] is not None and ccm is not None and ccm > g["ccm"] + 0.5:
        return False
    if g["kw"] is not None and kw is not None and kw > g["kw"] + 0.5:
        return False
    if g["kmh"] is not None and kmh is not None and kmh > g["kmh"] + 1:
        return False
    if g["kw_kg"] is not None and kw is not None and kg:
        if kw / kg > g["kw_kg"] + 0.005:
            return False
    return True


def noetige_klasse(ccm, kw, kg=None, kmh=None):
    """Die niedrigste Klasse, die das Fahrzeug nach § 6 FeV abdeckt."""
    for k in ("AM", "A1", "A2"):
        if _deckt_ab(k, ccm, kw, kg, kmh):
            return k
    return "A"


def fahrerlaubnis(genannt, ccm, kw, kg=None, kmh=None):
    """
    Die Klasse aus der Quelle, angehoben falls die Technik sie ausschliesst.

    Mehrfachangaben („A2, A") behalten ihre Form, solange die niedrigste genannte Klasse traegt — sie sagen
    aus, womit man fahren darf. Traegt sie nicht, wird auf die gesetzlich noetige Klasse gesetzt.
    Ohne Angabe wird die noetige Klasse hergeleitet; ohne verwertbare Technik bleibt es bei der Quelle.
    """
    teile = [t.strip() for t in str(genannt or "").split(",") if t.strip() in RANG]
    if ccm is None and kw is None:
        return genannt or ""
    noetig = noetige_klasse(ccm, kw, kg, kmh)
    if not teile:
        return noetig
    niedrigste = min(teile, key=lambda k: RANG[k])
    if RANG[niedrigste] >= RANG[noetig]:
        return genannt                      # Quelle ist streng genug (oder strenger) — unveraendert lassen
    return noetig                           # Quelle erlaubt zu viel — auf das Gesetz anheben


def drosselbar(kw, kg=None, noetig=None):
    """
    Laesst sich das Bike auf A2 drosseln? Zulaessig ist eine Drosselung auf hoechstens die Haelfte der
    Ausgangsleistung, also ab 70 kW nicht mehr. Wer schon A2 oder weniger braucht, wird nicht gedrosselt.
    """
    if kw is None:
        return ""
    if noetig and RANG.get(noetig, 3) <= RANG["A2"]:
        return "nein"                       # faehrt man ohnehin mit A2 — Drosselung waere sinnlos
    if kw > 70.5:
        return "nein"
    if kg and 35 / kg > 0.205:
        return "nein"                       # zu leicht: auch gedrosselt ueber 0,2 kW/kg
    return "ja"


# ---------------------------------------------------------------------------- Text

# UTF-8, das einmal als Latin-1 gelesen wurde: „Ã–hlins" statt „Öhlins", „Ã˜ 43 mm" statt „Ø 43 mm".
def text_reparieren(s):
    if not s or not any(z in s for z in ("Ã", "Â", "�")):
        return s
    # cp1252, nicht latin-1: „Ø" wird zu „Ã˜", und „˜" gibt es in latin-1 nicht — daran scheiterte sonst
    # der ganze String, auch wenn der Rest reparabel waere.
    try:
        repariert = s.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s
    return repariert if "�" not in repariert else s
