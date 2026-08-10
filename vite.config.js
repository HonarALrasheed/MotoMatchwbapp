import { defineConfig } from 'vite'
import { existsSync, mkdirSync, readdirSync, copyFileSync, createReadStream, statSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'

const __root = resolve('.')
const isLocal = existsSync('D:/MotoMatch/Bilder')

// ── Local dev only: copy assets from external folders ──
if (isLocal) {
  const dst = join(__root, 'public/bikes')
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
  const imgFilter = f => /\.(png|jpg|jpeg|webp)$/i.test(f)

  // Copy from Bilder/Bilder/1 (side views)
  const src1 = 'D:/MotoMatch/Bilder/Bilder/1'
  if (existsSync(src1)) {
    readdirSync(src1).filter(imgFilter).forEach(f => {
      copyFileSync(join(src1, f), join(dst, f))
    })
  }
  // Copy from Bilder/Bilder/2 (detail views)
  const dst2 = join(__root, 'public/bikes/2')
  if (!existsSync(dst2)) mkdirSync(dst2, { recursive: true })
  const src2 = 'D:/MotoMatch/Bilder/Bilder/2'
  if (existsSync(src2)) {
    readdirSync(src2).filter(imgFilter).forEach(f => {
      copyFileSync(join(src2, f), join(dst2, f))
    })
  }
  // Fallback: Bilder root
  const srcRoot = 'D:/MotoMatch/Bilder'
  if (existsSync(srcRoot)) {
    readdirSync(srcRoot).filter(imgFilter).forEach(f => {
      const target = join(dst, f)
      if (!existsSync(target)) copyFileSync(join(srcRoot, f), target)
    })
  }

  // Copy assembly step images (quiz background)
  const assemblySrc = 'D:/MotoMatch/Bilder/7 Bilder'
  const assemblyDst = join(__root, 'public/assembly')
  if (!existsSync(assemblyDst)) mkdirSync(assemblyDst, { recursive: true })
  if (existsSync(assemblySrc)) {
    const stepFiles = [
      ['Der leere Rahmen.png', 'step-1.png'],
      ['Gabel & Vorderrad.png', 'step-2.png'],
      ['Hinterrad & Schwinge.png', 'step-3.png'],
      ['Motor & Auspuff.png', 'step-4.png'],
      ['Kraftstofftank.png', 'step-5.png'],
      ['Sitzbank & Heck.png', 'step-6.png'],
      ['ollständige Verkleidung (Finish).png', 'step-7.png'],
    ]
    stepFiles.forEach(([src, dst]) => {
      const srcPath = join(assemblySrc, src)
      if (existsSync(srcPath)) copyFileSync(srcPath, join(assemblyDst, dst))
    })
  }

  // Copy hero video
  const videoDst = join(__root, 'public/__video')
  if (!existsSync(videoDst)) mkdirSync(videoDst, { recursive: true })
  const heroVideo = 'D:/MotoMatch/public/Trumpf.mp4'
  if (existsSync(heroVideo) && statSync(heroVideo).size > 0) {
    copyFileSync(heroVideo, join(videoDst, 'hero.mp4'))
  }
}

export default defineConfig(() => ({
  base: '/',
  server: {
    port: parseInt(process.env.PORT || '5173', 10),
    strictPort: false,
    open: true,
  },
  build: {
    outDir: 'dist',
    minify: 'terser'
  },
  publicDir: 'public',
  plugins: [{
    name: 'serve-hero-video',
    configureServer(server) {
      // Only needed for local dev — serves video from external path
      if (!isLocal) return

      const stale = join(__root, 'public/hero-video.mp4')
      if (existsSync(stale)) try { unlinkSync(stale) } catch(e) {}

      const videoPath = 'D:/MotoMatch/public/Trumpf.mp4'
      const vExists = existsSync(videoPath)
      console.log('[hero-video] path:', videoPath, 'exists:', vExists)
      if (vExists) console.log('[hero-video] size:', statSync(videoPath).size)

      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__video/hero.mp4') return next()
        if (!existsSync(videoPath)) { res.statusCode = 404; res.end(); return }
        const stat = statSync(videoPath)
        const total = stat.size
        if (total === 0) { res.statusCode = 404; res.end(); return }
        const range = req.headers.range
        if (range) {
          const m = range.match(/bytes=(\d+)-(\d*)/)
          if (m) {
            const start = parseInt(m[1], 10)
            const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': end - start + 1,
              'Content-Type': 'video/mp4',
            })
            createReadStream(videoPath, { start, end }).pipe(res)
            return
          }
        }
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': total,
          'Accept-Ranges': 'bytes',
        })
        createReadStream(videoPath).pipe(res)
      })
    }
  }]
}))
