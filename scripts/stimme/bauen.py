#!/usr/bin/env python3
"""Ansagen der Navi-Stimme Heike einsprechen — mit Abhör-Kontrolle.

Liest src/js/stimme-saetze.json, spricht jeden Satz mit Chatterbox
Multilingual (Resemble AI, MIT-Lizenz) in der eingebauten Frauenstimme ein
und hört jede Aufnahme mit der Spracherkennung des Macs ab. Nur Aufnahmen,
die Wort für Wort stimmen und nicht zu lang sind (kein Gestammel am Ende),
landen als AAC unter public/stimme/heike/. Fehlversuche werden neu
eingesprochen (anderer Zufallswert), bis zu VERSUCHE Mal.

Nachschnitt: Chatterbox hängt bei kurzen Sätzen gern Gemurmel an ("… dein
Ziel Amt"). Jede Aufnahme wird deshalb an ihren Sprechpausen geschnitten, jede
Schnittfassung abgehört, und es gilt die kürzeste, die exakt den Satz enthält
— kein Wort mehr, keins weniger. Vorhandene Versuche in heike-roh/ werden
zuerst so geprüft, neu eingesprochen wird nur, was dann noch fehlt.

Werkstatt (nicht im Repo): ~/motomatch-stimme
  venv-cb/   Python 3.11 mit chatterbox-tts
  asr/Hoeren.app  Prüfprogramm (asr/hoeren.swift, SFSpeechRecognizer, on-device)
Aufruf:  ~/motomatch-stimme/venv-cb/bin/python scripts/stimme/bauen.py [schluessel …]
"""
import difflib, json, os, re, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WERKSTATT = Path(os.environ.get('STIMME_WERKSTATT', Path.home() / 'motomatch-stimme'))
ZIEL = REPO / 'public' / 'stimme' / 'heike'
ROH = WERKSTATT / 'heike-roh'
SCHNITT = ROH / 'schnitt'
HOEREN = WERKSTATT / 'asr' / 'Hoeren.app'
VERSUCHE = 6

ZAHLEN = {'achthundert': '800', 'zweihundertfünfzig': '250'}
ROEMISCH = {'i': 'erste', 'ii': 'zweite', 'iii': 'dritte', 'iv': 'vierte', 'v': 'fünfte', 'vi': 'sechste'}


def saetze():
    s = json.loads((REPO / 'src/js/stimme-saetze.json').read_text())
    out = dict(s['einzeln'])
    for m, text in s['manoever'].items():
        if m not in ('ziel', 'start-tour'):
            out[m] = text[0].upper() + text[1:] + '.'
        for ab, vorne in s['abstaende'].items():
            out[f'{ab}-{m}'] = f'{vorne} {text}.'
    return out


def norm(t):
    t = t.lower().replace('ß', 'ss')
    for wort, ziffer in ZAHLEN.items():
        t = t.replace(wort.replace('ß', 'ss'), ziffer)
    t = re.sub(r'\bmetern?\b', 'm', t)
    t = re.sub(r'[^a-zäöü0-9 ]+', ' ', t)
    # Die Erkennung schreibt Ordnungszahlen gern römisch ("die VI Ausfahrt")
    return ' '.join(ROEMISCH.get(w, w) for w in t.split())


def abhoeren(dateien):
    """Erkannter Text je Datei (Spracherkennung auf dem Mac)."""
    aus = ROH / 'erkannt.txt'
    aus.unlink(missing_ok=True)
    subprocess.run(['open', '-n', '-W', str(HOEREN), '--args', str(aus), *map(str, dateien)], check=True)
    erg = {}
    for zeile in aus.read_text().splitlines():
        if '\t' in zeile and not zeile.startswith('ONDEVICE'):
            pfad, text = zeile.split('\t', 1)
            erg[Path(pfad).name] = re.sub(r'\[FEHLER.*', '', text).strip()
    return erg


def dauer(pfad):
    out = subprocess.run(['afinfo', str(pfad)], capture_output=True, text=True).stdout
    m = re.search(r'estimated duration: ([\d.]+)', out)
    return float(m.group(1)) if m else 99


def passt(soll, ist, sek):
    a, b = norm(soll), norm(ist)
    aehnlich = difflib.SequenceMatcher(None, a, b).ratio()
    # Exakt so viele Wörter wie der Satz, und nicht länger als nötig
    genau = len(b.split()) == len(a.split()) and sek <= 1.4 + 0.085 * len(soll)
    return aehnlich >= 0.9 and genau, aehnlich


def schnitte(roh, name):
    """Schnittfassungen einer Aufnahme: an jeder Sprechpause ab 0,4 s und am Ende.
    Liefert [(sekunden, wav, wav16k)], kürzeste zuerst."""
    import numpy as np, soundfile as sf
    ton, sr = sf.read(str(roh), dtype='float32')
    if ton.ndim > 1:
        ton = ton.mean(axis=1)
    f = sr // 100  # 10-ms-Rahmen
    rms = np.array([np.sqrt(np.mean(ton[i:i + f] ** 2)) + 1e-9 for i in range(0, len(ton) - f, f)])
    db = 20 * np.log10(rms)
    laut = db > db.max() - 35
    if not laut.any():
        return []
    anfang = max(0, int(np.argmax(laut)) - 5)
    enden = []
    i = anfang
    while i < len(laut):
        if laut[i]:
            i += 1
            continue
        j = i
        while j < len(laut) and not laut[j]:
            j += 1
        if (j - i >= 12 or j == len(laut)) and i * 0.01 >= 0.4:
            enden.append(i)
        i = j
    if not enden or enden[-1] < len(laut) - 1:
        letzte = len(laut) - 1 - int(np.argmax(laut[::-1]))
        enden.append(letzte + 1)
    aus = []
    for n, e in enumerate(sorted(set(enden))):
        stueck = ton[anfang * f:min(len(ton), (e + 8) * f)].copy()  # 80 ms Nachklang
        blende = min(len(stueck), sr // 40)
        stueck[-blende:] *= np.linspace(1, 0, blende, dtype='float32')
        ziel = SCHNITT / f'{name}.s{n}.wav'
        sf.write(str(ziel), stueck, sr)
        pruef = SCHNITT / f'{name}.s{n}.16k.wav'
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(ziel), str(pruef)], check=True)
        aus.append((len(stueck) / sr, ziel, pruef))
    return aus


def auswaehlen(offen, kandidaten, bericht):
    """kandidaten: {schluessel: [(sek, wav, wav16k)]}. Legt je Satz die kürzeste
    exakte Fassung als AAC ab und streicht ihn aus offen."""
    erkannt = abhoeren([p for liste in kandidaten.values() for _, _, p in liste])
    for k, liste in kandidaten.items():
        gut = [(sek, wav, erkannt.get(p.name, '')) for sek, wav, p in liste if passt(offen[k], erkannt.get(p.name, ''), sek)[0]]
        if gut:
            sek, wav, ist = min(gut, key=lambda x: x[0])
            # AAC 48 kbit/s mono — spielt in allen Browsern
            subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', str(wav), str(ZIEL / f'{k}.m4a')], check=True)
            bericht[k] = ist
            print(f'OK  {k}: „{ist}“ ({sek:.2f} s)', flush=True)
            del offen[k]
        else:
            beste = max((erkannt.get(p.name, '') for _, _, p in liste), key=lambda t: passt(offen[k], t, 0)[1], default='')
            print(f'NEU {k}: bestes „{beste}“', flush=True)


def main():
    alle = saetze()
    nur = set(sys.argv[1:])
    offen = {k: t for k, t in alle.items() if not nur or k in nur}
    ROH.mkdir(parents=True, exist_ok=True)
    SCHNITT.mkdir(parents=True, exist_ok=True)
    ZIEL.mkdir(parents=True, exist_ok=True)
    bericht = {}

    # 1. Vorhandene Aufnahmen nachschneiden
    kandidaten, hoechster = {}, -1
    for k in offen:
        for roh in sorted(ROH.glob(f'{k}.*.wav')):
            teile = roh.name[len(k) + 1:-4]
            if not teile.isdigit():
                continue
            hoechster = max(hoechster, int(teile))
            kandidaten.setdefault(k, []).extend(schnitte(roh, f'{k}.{teile}'))
    if kandidaten:
        print(f'— Nachschnitt: {len(kandidaten)} Sätze, {sum(map(len, kandidaten.values()))} Fassungen', flush=True)
        auswaehlen(offen, kandidaten, bericht)

    # 2. Was fehlt, neu einsprechen
    if offen:
        import perth
        if perth.PerthImplicitWatermarker is None:  # Wasserzeichen-Modul fehlt auf dem Mac
            perth.PerthImplicitWatermarker = perth.DummyWatermarker
        import torch, torchaudio as ta
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        modell = ChatterboxMultilingualTTS.from_pretrained(device='mps')
        for versuch in range(hoechster + 1, hoechster + 1 + VERSUCHE):
            if not offen:
                break
            print(f'— Durchgang {versuch + 1}: {len(offen)} Sätze', flush=True)
            kandidaten = {}
            for k, text in offen.items():
                torch.manual_seed(1000 * versuch + hash(k) % 997)
                wav = modell.generate(text, language_id='de', exaggeration=0.45, cfg_weight=0.5, temperature=0.7)
                roh = ROH / f'{k}.{versuch}.wav'
                ta.save(str(roh), wav, modell.sr)
                kandidaten[k] = schnitte(roh, f'{k}.{versuch}')
            auswaehlen(offen, kandidaten, bericht)

    fertig = sorted(p.stem for p in ZIEL.glob('*.m4a') if p.stem in alle)
    (ZIEL / 'index.json').write_text(json.dumps({'stimme': 'Heike (Chatterbox Multilingual, Resemble AI, MIT)', 'dateien': fertig}, ensure_ascii=False, indent=1) + '\n')
    print(f'Fertig: {len(fertig)}/{len(alle)} geprüft und abgelegt.')
    if offen:
        print('Nicht bestanden (spricht die Gerätestimme):', ', '.join(sorted(offen)))


if __name__ == '__main__':
    main()
