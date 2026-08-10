import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'

const src = 'D:/MotoMatch/Bilder/7 Bilder'
const dst = 'D:/MotoMatch/moto-match/public/assembly'
if (!existsSync(dst)) mkdirSync(dst, { recursive: true })

const steps = [
  ['Der leere Rahmen.png', 'step-1.png'],
  ['Gabel & Vorderrad.png', 'step-2.png'],
  ['Hinterrad & Schwinge.png', 'step-3.png'],
  ['Motor & Auspuff.png', 'step-4.png'],
  ['Kraftstofftank.png', 'step-5.png'],
  ['Sitzbank & Heck.png', 'step-6.png'],
  ['ollständige Verkleidung (Finish).png', 'step-7.png'],
]

steps.forEach(([from, to]) => {
  const p = join(src, from)
  if (existsSync(p)) {
    copyFileSync(p, join(dst, to))
    console.log(`✓ ${from} → ${to}`)
  } else {
    console.log(`✗ NOT FOUND: ${from}`)
  }
})
