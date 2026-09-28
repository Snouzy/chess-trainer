import { Component, type ReactNode } from 'react'
import { Link } from 'wouter'
import { button, primaryButton } from './styles'

interface ErrorBoundaryProps {
  resetKey: string
  children: ReactNode
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="space-y-3">
        <p>Une erreur est survenue.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} onClick={() => location.reload()}>
            Recharger
          </button>
          <Link href="/" className={button}>
            Revenir à l’accueil
          </Link>
        </div>
      </div>
    )
  }
}
