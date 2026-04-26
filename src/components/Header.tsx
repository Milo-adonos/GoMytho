import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'

interface HeaderProps {
  showLogin?: boolean
}

export default function Header({ showLogin = true }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false)
  const [user, setUser] = useState<any>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
    }).catch(() => {
      // Supabase not configured, ignore
    })
  }, [])

  const handleLogin = () => {
    navigate('/signup')
  }

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? 'bg-primary-bg/95 backdrop-blur-lg shadow-lg' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center">
          <h1 className="text-3xl font-black text-lime font-display">
            GoMytho
          </h1>
        </Link>

        {showLogin && (
          <button
            onClick={handleLogin}
            className="text-lime hover:text-lime-hover font-semibold transition-colors hover:underline"
          >
            {user ? 'Dashboard' : 'Se connecter'}
          </button>
        )}
      </div>
    </motion.header>
  )
}
