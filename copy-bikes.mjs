import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs'
import { join } from 'path'

const src = 'D:/MotoMatch/Bilder'
const dst = 'D:/MotoMatch/moto-match/public/bikes'

if (!existsSync(dst)) mkdirSync(dst, { recursive: true })

readdirSync(src)
  .filter(f => f.endsWith('.png'))
  .forEach(f => {
    copyFileSync(join(src, f), join(dst, f))
    console.log('copied:', f)
  })

console.log('Done!')
