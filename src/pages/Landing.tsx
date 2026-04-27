import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'

// Génère un nombre pseudo-aléatoire entre 938 et 2371
// Change chaque jour à 15h heure française (UTC+2 en été)
function getDailyMythoCount(): number {
  const now = new Date()
  // Heure française = UTC+2 (avril–octobre)
  const frenchHour = (now.getUTCHours() + 2) % 24
  // Avant 15h → on utilise encore la "journée d'hier" comme seed
  const seedDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    frenchHour < 15 ? now.getUTCDate() - 1 : now.getUTCDate()
  ))
  const seed = seedDate.getUTCFullYear() * 10000
    + (seedDate.getUTCMonth() + 1) * 100
    + seedDate.getUTCDate()
  // LCG pseudo-random déterministe basé sur la date
  const rand = ((seed * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff
  return Math.floor(938 + rand * (2371 - 938 + 1))
}

const examples = [
  {
    before: '/beforeafter/crash-avant.jpg',
    after: '/beforeafter/crash-apres.jpg',
    label: 'Range Rover propre',
    result: 'Accident + flics 😂',
  },
  {
    before: '/beforeafter/mamie-avant.jpg',
    after: '/beforeafter/mamie-apres.jpg',
    label: 'Mamie dans son jardin',
    result: 'Mamie qui fume 😭',
  },
  {
    before: '/beforeafter/maison-avant.jpg',
    after: '/beforeafter/maison-apres.jpg',
    label: 'Mur propre',
    result: 'Taguée "RnBoi Crousty" 💀',
  },
  {
    before: '/beforeafter/rolex-avant.jpg',
    after: '/beforeafter/rolex-apres.jpg',
    label: 'Bracelet élastique',
    result: 'Rolex Submariner 😏',
  },
  {
    before: '/beforeafter/lambo-avant.jpg',
    after: '/beforeafter/lambo-apres.jpg',
    label: 'Peugeot 108',
    result: 'Lamborghini Aventador 🔥',
  },
]

const faqs = [
  { q: 'C\'est légal ?', a: 'Oui. C\'est une blague entre potes, pas une arnaque bancaire. Évite juste de mytho ton banquier.' },
  { q: 'Mes photos sont stockées ?', a: 'Non. Supprimées dès la génération. On n\'en veut pas.' },
  { q: 'Ça marche sur quoi ?', a: 'Tout. Vraiment tout. Si tu peux le décrire, l\'IA peut le mettre sur ta photo.' },
  { q: 'Je peux annuler quand ?', a: 'À tout moment, en 1 clic. Pas de piège, pas d\'engagement.' },
]

const steps = [
  { num: '01', icon: '📷', title: 'Upload ta photo', desc: 'Ajoute la photo de ton choix, plus elle est nette plus le résultat sera bluffant.' },
  { num: '02', icon: '🎭', title: 'Décris ton mytho', desc: 'Décris ton imagination pour transformer ton image en mytho réaliste.' },
  { num: '03', icon: '⚡', title: 'L\'IA génère', desc: 'En 10 secondes, notre IA crée une image ultra-réaliste impossible à distinguer du vrai.' },
  { num: '04', icon: '🚀', title: 'Envoie et profite', desc: 'Partage à tes potes, mate la réaction, garde ton mytho en mémoire.' },
]

// Carousel card — AVANT en haut (16:9), séparateur lime, APRÈS en bas (16:9)
function ExampleCard({ ex, isActive }: { ex: typeof examples[0]; isActive: boolean }) {
  // Largeur = 85vw max 340px, hauteur de chaque image = largeur * 9/16
  const cardWidth = 'min(85vw, 340px)'

  return (
    <div
      className="flex-shrink-0 snap-center rounded-2xl overflow-hidden border transition-all duration-300"
      style={{
        width: cardWidth,
        borderColor: isActive ? 'rgba(198,255,60,0.7)' : 'rgba(198,255,60,0.15)',
        boxShadow: isActive ? '0 0 32px rgba(198,255,60,0.25)' : 'none',
      }}
    >
      {/* AVANT — ratio 16:9 */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' /* 9/16 */ }}>
        <img
          src={ex.before}
          alt={ex.label}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          className="absolute top-3 left-3 px-2.5 py-1 text-white text-xs font-black rounded-lg"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
        >
          AVANT
        </div>
      </div>

      {/* Séparateur lime */}
      <div style={{ height: '3px', background: '#C6FF3C', boxShadow: '0 0 12px rgba(198,255,60,1)' }} />

      {/* APRÈS — ratio 16:9 */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <img
          src={ex.after}
          alt={ex.result}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          className="absolute top-3 left-3 px-2.5 py-1 text-xs font-black rounded-lg"
          style={{ background: '#C6FF3C', color: '#0A0E1A', boxShadow: '0 0 12px rgba(198,255,60,0.7)' }}
        >
          APRÈS
        </div>
        <div
          className="absolute bottom-0 left-0 right-0 px-3 py-2"
          style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' }}
        >
          <p className="text-xs font-bold text-lime">{ex.result}</p>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const [currentEx, setCurrentEx] = useState(0)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const carouselRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const iv = setInterval(() => {
      setCurrentEx(p => {
        const next = (p + 1) % examples.length
        if (carouselRef.current) {
          const card = carouselRef.current.children[next] as HTMLElement
          if (card) {
            // Scroll uniquement à l'intérieur du carousel, sans toucher au scroll de la page
            carouselRef.current.scrollTo({
              left: card.offsetLeft - carouselRef.current.offsetLeft,
              behavior: 'smooth',
            })
          }
        }
        return next
      })
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="min-h-screen bg-primary-bg relative overflow-x-hidden select-none">

      {/* ── HEADER ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          background: isScrolled ? 'rgba(10,14,26,0.95)' : 'transparent',
          backdropFilter: isScrolled ? 'blur(16px)' : 'none',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-2xl font-black text-lime" style={{ textShadow: '0 0 20px rgba(198,255,60,0.4)' }}>
            GoMytho
          </span>
          <a
            href="/login"
            className="text-lime text-sm font-bold px-4 py-2 rounded-full border transition-all active:scale-95"
            style={{ borderColor: 'rgba(198,255,60,0.4)', background: 'rgba(198,255,60,0.08)' }}
          >
            Se connecter →
          </a>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative px-4 pt-24 pb-10 flex flex-col items-center text-center overflow-hidden">

        {/* Background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none" style={{
          width: '120vw', height: '120vw', maxWidth: '700px', maxHeight: '700px',
          background: 'radial-gradient(circle, rgba(198,255,60,0.07) 0%, transparent 70%)',
          filter: 'blur(50px)',
        }} />
        <div className="absolute inset-0 dot-grid opacity-20 pointer-events-none" />

        <div className="relative z-10 w-full max-w-lg mx-auto">

          {/* Badge compteur */}
          <div className="animate-fade-up-1 inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full border"
            style={{ background: '#141826', borderColor: 'rgba(198,255,60,0.2)' }}>
            <span className="w-2 h-2 rounded-full bg-lime animate-pulse-dot" style={{ boxShadow: '0 0 8px rgba(198,255,60,0.9)' }} />
            <span className="text-xs text-text-secondary">
              Plus de <span className="text-lime font-black text-sm">{getDailyMythoCount().toLocaleString('fr-FR')}</span> mythos aujourd'hui
            </span>
          </div>

          {/* Titre */}
          <h1 className="animate-fade-up-2 font-black leading-[1.05] tracking-tight mb-4"
            style={{ fontSize: 'clamp(36px, 10vw, 72px)' }}>
            Crée des photos
            <br />
            <span
              className="text-gradient-lime relative inline-block"
              style={{ textShadow: '0 0 40px rgba(198,255,60,0.2)' }}
            >
              ultra réalistes
              <svg
                className="absolute left-0 -bottom-2 w-full overflow-visible"
                height="8"
                viewBox="0 0 200 8"
                preserveAspectRatio="none"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M0 6 Q50 1 100 5 Q150 9 200 4"
                  stroke="#C6FF3C"
                  strokeWidth="3"
                  strokeLinecap="round"
                  filter="url(#glow)"
                />
                <defs>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
              </svg>
            </span>
            <br />
            pour piéger
            <br className="sm:hidden" /> tes potes
          </h1>

          {/* Sous-titre */}
          <p className="animate-fade-up-3 text-base text-text-secondary mb-8 max-w-sm mx-auto leading-relaxed">
            Ton entourage va jamais s'en remettre 😭
          </p>

          {/* CTA */}
          <div className="animate-fade-up-4 flex flex-col items-center gap-3 mb-6">
            <button
              onClick={() => navigate('/uploadphoto')}
              className="w-full max-w-xs py-4 text-lg font-black rounded-full bg-lime text-primary-bg active:scale-95 transition-all duration-200 animate-pulse-glow"
              style={{ boxShadow: '0 0 50px rgba(198,255,60,0.4), 0 0 100px rgba(198,255,60,0.15)' }}
            >
              Lancer mon mytho →
            </button>
          </div>

          {/* Carousel avant/après */}
          <div className="animate-fade-up-5 mt-6">
            <p className="text-[11px] text-text-secondary mb-4 uppercase tracking-widest font-semibold">
              Résultats réels ✨
            </p>
            <div
              ref={carouselRef}
              className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2 -mx-4 px-4"
            >
              {examples.map((ex, i) => (
                <ExampleCard key={i} ex={ex} isActive={currentEx === i} />
              ))}
            </div>

            {/* Dots indicator */}
            {examples.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-4">
                {examples.map((_, i) => (
                  <div
                    key={i}
                    className="rounded-full transition-all duration-300"
                    style={{
                      width: currentEx === i ? '20px' : '6px',
                      height: '6px',
                      background: currentEx === i ? '#C6FF3C' : 'rgba(198,255,60,0.2)',
                      boxShadow: currentEx === i ? '0 0 8px rgba(198,255,60,0.6)' : 'none',
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── COMMENT ÇA MARCHE ── */}
      <section className="py-16 px-4" style={{ background: 'rgba(20,24,38,0.5)' }}>
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="w-2 h-2 bg-lime rounded-full" style={{ boxShadow: '0 0 8px rgba(198,255,60,0.8)' }} />
              <span className="text-lime text-xs font-bold tracking-widest uppercase">Comment ça marche</span>
            </div>
            <h2 className="font-black mb-2" style={{ fontSize: 'clamp(28px, 8vw, 48px)' }}>
              Prêt en <span className="text-gradient-lime">30 secondes</span>
            </h2>
            <p className="text-text-secondary text-sm">4 étapes. Zéro prise de tête.</p>
          </div>

          <div className="flex flex-col gap-4">
            {steps.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-4 p-5 rounded-2xl border"
                style={{ background: '#141826', borderColor: 'rgba(198,255,60,0.1)' }}
              >
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                  style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.2)' }}
                >
                  {step.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lime text-xs font-black">{step.num}</span>
                    <h3 className="font-bold text-base">{step.title}</h3>
                  </div>
                  <p className="text-text-secondary text-sm leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-16 px-4">
        <div className="max-w-lg mx-auto">
          <h2 className="font-black text-center mb-8" style={{ fontSize: 'clamp(28px, 8vw, 48px)' }}>
            Questions ?
          </h2>
          <div className="flex flex-col gap-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-2xl border overflow-hidden transition-all duration-300"
                style={{
                  background: '#141826',
                  borderColor: openFaq === i ? 'rgba(198,255,60,0.4)' : 'rgba(198,255,60,0.08)',
                  boxShadow: openFaq === i ? '0 0 20px rgba(198,255,60,0.08)' : 'none',
                }}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full px-5 py-4 flex items-center justify-between text-left active:bg-white/5 transition-colors"
                >
                  <span className="font-bold text-sm pr-4">{faq.q}</span>
                  <span
                    className="text-lime text-xl flex-shrink-0 transition-transform duration-300"
                    style={{ transform: openFaq === i ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  >↓</span>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-text-secondary text-sm leading-relaxed"
                    style={{ borderTop: '1px solid rgba(198,255,60,0.08)', paddingTop: '12px' }}>
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="py-24 px-4 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at center, rgba(198,255,60,0.06) 0%, transparent 70%)',
        }} />
        <div className="relative z-10 max-w-lg mx-auto text-center">
          <h2 className="font-black mb-8 leading-tight" style={{ fontSize: 'clamp(36px, 12vw, 80px)' }}>
            Alors,{' '}
            <span className="text-gradient-lime">on mytho ?</span>
          </h2>
          <button
            onClick={() => navigate('/uploadphoto')}
            className="w-full max-w-xs py-5 text-xl font-black rounded-full bg-lime text-primary-bg active:scale-95 transition-all duration-200"
            style={{ boxShadow: '0 0 60px rgba(198,255,60,0.4), 0 0 120px rgba(198,255,60,0.15)' }}
          >
            Commencer maintenant →
          </button>
          <p className="mt-4 text-text-secondary text-xs">3 mythos gratuits · Aucune CB requise</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-8 px-4" style={{ borderTop: '1px solid rgba(138,143,160,0.1)' }}>
        <div className="max-w-lg mx-auto text-center flex flex-col gap-4">
          <span className="text-xl font-black text-lime" style={{ textShadow: '0 0 15px rgba(198,255,60,0.3)' }}>GoMytho</span>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-text-secondary">
            <a href="#" className="hover:text-lime transition-colors active:text-lime">Mentions légales</a>
            <a href="#" className="hover:text-lime transition-colors active:text-lime">CGU</a>
            <a href="#" className="hover:text-lime transition-colors active:text-lime">Confidentialité</a>
            <a href="#" className="hover:text-lime transition-colors active:text-lime">Contact</a>
          </div>
          <p className="text-xs text-text-secondary/50">© 2026 GoMytho</p>
          <p style={{ fontSize: '11px', color: 'rgba(138,143,160,0.4)' }}>
            Propriétaire du site :{' '}
            <a
              href="/admin-login"
              style={{ textDecoration: 'underline', color: 'rgba(138,143,160,0.4)' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#C6FF3C')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(138,143,160,0.4)')}
            >
              cliquez ici
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
