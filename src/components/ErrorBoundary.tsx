import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-primary-bg flex items-center justify-center p-4">
          <div className="text-center">
            <h1 className="text-4xl font-black text-lime mb-4">Oups !</h1>
            <p className="text-text-secondary mb-4">Une erreur est survenue.</p>
            <button
              onClick={() => window.location.href = '/'}
              className="bg-lime text-primary-bg px-6 py-3 rounded-full font-bold"
            >
              Retour à l'accueil
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
