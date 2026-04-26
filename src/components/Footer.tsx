import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-primary-bg border-t border-text-secondary/10 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center">
            <h2 className="text-2xl font-black text-lime font-display">GoMytho</h2>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-text-secondary">
            <Link to="/legal" className="hover:text-lime transition-colors">
              Mentions légales
            </Link>
            <Link to="/terms" className="hover:text-lime transition-colors">
              CGU
            </Link>
            <Link to="/privacy" className="hover:text-lime transition-colors">
              Confidentialité
            </Link>
            <Link to="/contact" className="hover:text-lime transition-colors">
              Contact
            </Link>
          </div>

          <div className="text-sm text-text-secondary">
            © 2026 GoMytho
          </div>
        </div>
      </div>
    </footer>
  )
}
