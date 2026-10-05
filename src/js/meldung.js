/* ═══════════════════════════════════════════════════
   MELDUNG — eigenes Dialogfenster statt alert/confirm/prompt.

   Die Systemfenster des Browsers wirken fremd, und in eingebetteten
   Browsern (In-App-Browser, manche Web-Ansichten) erscheinen sie gar nicht —
   dann sieht es aus, als passiere nichts. Diese Meldung steht über allem,
   lässt sich per Escape oder Tipp daneben schließen und liefert ein Promise.
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'

/**
 * @param {object} o
 * @param {string} o.titel
 * @param {string} [o.text]
 * @param {string} [o.eingabe]  Startwert eines Textfelds (dann liefert "OK" den Text)
 * @param {Array<{ label: string, wert: any, haupt?: boolean, gefahr?: boolean }>} [o.knoepfe]
 * @returns {Promise<any>}  wert des gedrückten Knopfs, bei Eingabe der Text; null bei Abbruch
 */
export function meldung({ titel, text = '', eingabe = null, knoepfe = [{ label: 'OK', wert: true, haupt: true }] }) {
  return new Promise((fertig) => {
    document.querySelector('.mm-meldung')?.remove()
    const el = document.createElement('div')
    el.className = 'mm-meldung'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    el.innerHTML = `<div class="mm-meldung-karte">
      <strong class="mm-meldung-titel">${esc(titel)}</strong>
      ${text ? `<p class="mm-meldung-text">${esc(text)}</p>` : ''}
      ${eingabe != null ? `<input type="text" class="mm-meldung-eingabe" maxlength="80" value="${esc(eingabe)}">` : ''}
      <div class="mm-meldung-knoepfe">${knoepfe.map((k, i) => `<button type="button" data-i="${i}" class="${k.haupt ? 'mm-meldung-haupt' : ''}${k.gefahr ? ' mm-meldung-gefahr' : ''}">${esc(k.label)}</button>`).join('')}</div>
    </div>`
    const feld = el.querySelector('.mm-meldung-eingabe')
    const zu = (wert) => {
      document.removeEventListener('keydown', taste)
      el.classList.add('mm-meldung--weg')
      setTimeout(() => el.remove(), 160)
      fertig(wert)
    }
    const ergebnis = (k) => (feld && k.wert === true ? feld.value.trim() : k.wert)
    const taste = (e) => {
      if (e.key === 'Escape') zu(null)
      if (e.key === 'Enter' && feld && document.activeElement === feld) zu(ergebnis(knoepfe.find((k) => k.haupt) || knoepfe[0]))
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]')
      if (b) zu(ergebnis(knoepfe[+b.dataset.i]))
      else if (e.target === el) zu(null)
    })
    document.addEventListener('keydown', taste)
    document.body.appendChild(el)
    ;(feld || el.querySelector('.mm-meldung-haupt') || el.querySelector('button'))?.focus()
    feld?.select()
  })
}

/** Kurz: Hinweis mit OK. */
export const hinweisen = (titel, text) => meldung({ titel, text })

/** Kurz: Ja/Nein-Frage. Liefert true/false. */
export const fragen = (titel, text, { ja = 'Ja', nein = 'Abbrechen', gefahr = false } = {}) =>
  meldung({ titel, text, knoepfe: [{ label: nein, wert: false }, { label: ja, wert: true, haupt: true, gefahr }] }).then((w) => w === true)

/** Kurz: Texteingabe. Liefert den Text oder null. */
export const eingeben = (titel, start = '', ok = 'Speichern') =>
  meldung({ titel, eingabe: start, knoepfe: [{ label: 'Abbrechen', wert: null }, { label: ok, wert: true, haupt: true }] })

/** Standort gesperrt: erklärt, wie man ihn freigibt, und bietet "Erneut versuchen". */
export const standortGesperrt = (wofuer) => meldung({
  titel: 'Standort nötig',
  text: `${wofuer} braucht deinen Standort. Erlaube ihn in den Website-Einstellungen deines Browsers (Schloss-Symbol neben der Adresse → Standort → Erlauben) und versuch es dann noch einmal.`,
  knoepfe: [{ label: 'Schließen', wert: false }, { label: 'Erneut versuchen', wert: true, haupt: true }],
}).then((w) => w === true)
