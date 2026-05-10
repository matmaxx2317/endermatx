import { useEffect, useRef } from 'react'

const ENDER_W = 14
const ENDER_TOP = 120
const PARTICLE_COLORS = ['#cc00ee', '#dd44ff', '#9900bb', '#ee88ff', '#aa00dd']

export default function Enderman() {
  const endermanRef = useRef(null)
  const flipRef = useRef(null)

  useEffect(() => {
    const enderman = endermanRef.current
    const flip = flipRef.current
    if (!enderman || !flip) return

    let x = 20
    let dir = 1
    let teleporting = false
    let last = null
    let sinceLastTport = 0
    let nextTport = randomInterval()
    let currentSpeed = 30
    let targetSpeed = 30
    let sinceSpeedChange = 0
    let nextSpeedChange = randomSpeedInterval()
    let rafId = null

    function randomInterval() { return 2800 + Math.random() * 2400 }
    function randomSpeedInterval() { return 600 + Math.random() * 1400 }
    function randomTargetSpeed() {
      const r = Math.random()
      if (r < 0.2) return 0
      if (r < 0.5) return 18 + Math.random() * 14
      if (r < 0.85) return 45 + Math.random() * 25
      return 90 + Math.random() * 40
    }

    function spawnParticles(px, py, count) {
      for (let i = 0; i < count; i++) {
        const p = document.createElement('div')
        const size = 2 + Math.random() * 2.5
        const col = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)]
        p.style.cssText = `position:fixed;border-radius:50%;pointer-events:none;z-index:6;width:${size}px;height:${size}px;background:${col};box-shadow:0 0 4px ${col};`
        document.body.appendChild(p)

        const angle = Math.random() * Math.PI * 2
        const dist = 18 + Math.random() * 55
        const vx = Math.cos(angle) * dist
        const vy = Math.sin(angle) * dist
        const maxLife = 420 + Math.random() * 320
        let t0 = null

        function frame(ts) {
          if (!t0) t0 = ts
          const t = (ts - t0) / maxLife
          if (t >= 1) { p.remove(); return }
          const e = 1 - (1 - t) * (1 - t)
          p.style.left = (px + vx * e) + 'px'
          p.style.top = (py + vy * e - 28 * t) + 'px'
          p.style.opacity = (1 - t).toFixed(3)
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }
    }

    function enderPos() {
      return {
        px: x + ENDER_W / 2,
        py: ENDER_TOP + 35,
      }
    }

    function teleport() {
      teleporting = true
      const from = enderPos()
      spawnParticles(from.px, from.py, 14)
      enderman.style.opacity = '0'
      setTimeout(() => {
        const maxX = window.innerWidth - ENDER_W
        x = Math.random() * maxX
        dir = Math.random() > 0.5 ? 1 : -1
        enderman.style.transform = `translateX(${x}px)`
        flip.style.transform = dir === -1 ? 'scaleX(-1)' : 'scaleX(1)'
        enderman.style.opacity = '1'
        const to = enderPos()
        spawnParticles(to.px, to.py, 14)
        teleporting = false
        sinceLastTport = 0
        nextTport = randomInterval()
      }, 200)
    }

    function step(dt) {
      if (teleporting) return
      sinceLastTport += dt
      sinceSpeedChange += dt

      if (sinceSpeedChange >= nextSpeedChange) {
        targetSpeed = randomTargetSpeed()
        nextSpeedChange = randomSpeedInterval()
        sinceSpeedChange = 0
      }

      currentSpeed += (targetSpeed - currentSpeed) * Math.min(1, dt / 180)

      x += dir * currentSpeed * (dt / 1000)
      const maxX = window.innerWidth - ENDER_W
      if (x >= maxX) { x = maxX; dir = -1; flip.style.transform = 'scaleX(-1)' }
      if (x <= 0) { x = 0; dir = 1; flip.style.transform = 'scaleX(1)' }
      enderman.style.transform = `translateX(${x}px)`

      const walkDur = currentSpeed < 5 ? '9999s' : (1.4 - Math.min(currentSpeed, 130) / 130 * 0.9) + 's'
      enderman.querySelectorAll('.ender-arm, .ender-leg, .ender-figure').forEach(el => {
        el.style.animationDuration = walkDur
      })

      if (sinceLastTport >= nextTport) teleport()
    }

    function loop(ts) {
      if (last !== null) step(ts - last)
      last = ts
      rafId = requestAnimationFrame(loop)
    }

    enderman.style.transform = `translateX(${x}px)`

    function onResize() {
      x = Math.min(x, window.innerWidth - ENDER_W)
    }
    window.addEventListener('resize', onResize)
    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div ref={endermanRef} style={{ position: 'fixed', top: ENDER_TOP, left: 0, zIndex: 5, pointerEvents: 'none' }}>
      <div ref={flipRef}>
        <div className="ender-figure">
          <div className="ender-head">
            <div className="ender-eye left"></div>
            <div className="ender-eye right"></div>
          </div>
          <div className="ender-body-wrap">
            <div className="ender-arm left"></div>
            <div className="ender-column">
              <div className="ender-torso"></div>
              <div className="ender-legs">
                <div className="ender-leg left"></div>
                <div className="ender-leg right"></div>
              </div>
            </div>
            <div className="ender-arm right"></div>
          </div>
        </div>
      </div>
    </div>
  )
}
