#!/usr/bin/env python3
"""Ansagen der Navi-Stimme Heiko einsprechen.

Liest src/js/stimme-saetze.json, spricht jeden Satz mit der freien Stimme
"Thorsten" (Piper, Datensatz CC0) ein und legt AAC-Dateien unter
public/stimme/heiko/ ab, dazu index.json mit allen Schlüsseln.

Werkstatt (nicht im Repo): ~/motomatch-stimme mit venv (pip install piper-tts)
und de_DE-thorsten-high.onnx(.json) von huggingface.co/rhasspy/piper-voices.
Aufruf: ~/motomatch-stimme/venv/bin/python scripts/stimme/bauen.py [schluessel …]
"""
import json, os, subprocess, sys, tempfile, wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

REPO = Path(__file__).resolve().parents[2]
WERKSTATT = Path(os.environ.get('STIMME_WERKSTATT', Path.home() / 'motomatch-stimme'))
MODELL = WERKSTATT / 'de_DE-thorsten-high.onnx'
ZIEL = REPO / 'public' / 'stimme' / 'heiko'

# Etwas langsamer und mit mehr Betonungsvarianz als der Standard: klingt
# ruhiger und weniger nach Ansagemaschine.
KONFIG = SynthesisConfig(length_scale=1.06, noise_scale=0.72, noise_w_scale=0.85)


def saetze():
    s = json.loads((REPO / 'src/js/stimme-saetze.json').read_text())
    out = dict(s['einzeln'])
    for m, text in s['manoever'].items():
        if m not in ('ziel', 'start-tour'):
            out[m] = text[0].upper() + text[1:] + '.'
        for ab, vorne in s['abstaende'].items():
            out[f'{ab}-{m}'] = f'{vorne} {text}.'
    return out


def main():
    nur = set(sys.argv[1:])
    stimme = PiperVoice.load(str(MODELL))
    ZIEL.mkdir(parents=True, exist_ok=True)
    alle = saetze()
    for k, text in alle.items():
        if nur and k not in nur:
            continue
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as t:
            wav = t.name
        with wave.open(wav, 'wb') as w:
            stimme.synthesize_wav(text, w, syn_config=KONFIG)
        # AAC 48 kbit/s mono — spielt in allen Browsern, ~6 KB je Sekunde
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', wav, str(ZIEL / f'{k}.m4a')], check=True)
        os.unlink(wav)
        print(k, '·', text)
    (ZIEL / 'index.json').write_text(json.dumps({'stimme': 'Thorsten (Piper, CC0)', 'dateien': sorted(alle)}, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
