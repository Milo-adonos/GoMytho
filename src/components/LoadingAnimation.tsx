import { motion } from 'framer-motion'

interface LoadingAnimationProps {
  text: string
  progress: number
}

export default function LoadingAnimation({ text, progress }: LoadingAnimationProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary-bg px-4">
      <motion.div
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="mb-12"
      >
        <h1
          className="font-black text-lime font-display whitespace-nowrap leading-none"
          style={{ fontSize: 'clamp(36px, 13vw, 72px)' }}
        >
          GoMytho.com
        </h1>
      </motion.div>

      <div className="w-full max-w-md mb-6">
        <div className="h-2 bg-secondary-bg rounded-full overflow-hidden">
          <motion.div
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
            className="h-full bg-lime glow-lime"
          />
        </div>
      </div>

      <motion.p
        key={text}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="text-xl text-text-secondary text-center"
      >
        {text}
      </motion.p>

      <div className="mt-8 flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.3, 1, 0.3],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: i * 0.2,
            }}
            className="w-2 h-2 bg-lime rounded-full"
          />
        ))}
      </div>
    </div>
  )
}
