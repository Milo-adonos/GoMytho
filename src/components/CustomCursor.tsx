import { useEffect, useState } from 'react'

export default function CustomCursor() {
  const [pos, setPos] = useState({ x: -100, y: -100 })
  const [isHovering, setIsHovering] = useState(false)
  const [isMobile, setIsMobile] = useState(true)

  useEffect(() => {
    // Désactiver sur mobile/tactile
    setIsMobile('ontouchstart' in window || window.matchMedia('(hover: none)').matches)
  }, [])

  useEffect(() => {
    if (isMobile) return
    const move = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [isMobile])

  useEffect(() => {
    if (isMobile) return
    const onEnter = () => setIsHovering(true)
    const onLeave = () => setIsHovering(false)
    const els = document.querySelectorAll('button, a, [data-hover]')
    els.forEach(el => {
      el.addEventListener('mouseenter', onEnter)
      el.addEventListener('mouseleave', onLeave)
    })
    return () => {
      els.forEach(el => {
        el.removeEventListener('mouseenter', onEnter)
        el.removeEventListener('mouseleave', onLeave)
      })
    }
  })

  if (isMobile) return null

  return (
    <>
      <style>{`* { cursor: none !important; }`}</style>
      <div
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          transform: 'translate(-50%, -50%)',
          width: isHovering ? '40px' : '12px',
          height: isHovering ? '40px' : '12px',
          background: isHovering ? 'rgba(198,255,60,0.2)' : '#C6FF3C',
          border: isHovering ? '2px solid #C6FF3C' : 'none',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 9999,
          transition: 'width 0.2s, height 0.2s, background 0.2s',
          boxShadow: isHovering
            ? '0 0 20px rgba(198,255,60,0.5)'
            : '0 0 10px rgba(198,255,60,0.8)',
        }}
      />
    </>
  )
}
