import { motion } from 'framer-motion'
import { ReactNode } from 'react'

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  fullWidth?: boolean
}

export default function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  type = 'button',
  fullWidth = false,
}: ButtonProps) {
  const baseClasses = 'font-bold rounded-full transition-all duration-300 inline-flex items-center justify-center gap-2'
  
  const variantClasses = {
    primary: 'bg-lime text-primary-bg hover:bg-lime-hover glow-lime-hover disabled:opacity-50 disabled:cursor-not-allowed',
    secondary: 'bg-secondary-bg text-text-primary border-2 border-lime hover:bg-lime hover:text-primary-bg',
    ghost: 'bg-transparent text-lime hover:text-lime-hover hover:underline',
  }

  const sizeClasses = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-6 py-3 text-base',
    lg: 'px-8 py-4 text-lg md:text-xl',
  }

  const widthClass = fullWidth ? 'w-full' : ''

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={onClick}
      disabled={disabled}
      type={type}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`}
    >
      {children}
    </motion.button>
  )
}
