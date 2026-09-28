import type { ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { runner } from '../services'
import { login, logout, useToken } from '../services/auth'
import { useRunner } from '../services/runner'
import { ErrorBoundary } from './error-boundary'
import { button } from './styles'

const toast = 'pointer-events-auto max-w-lg rounded-md px-4 py-2 text-center text-sm shadow'

export function Layout({ children }: { children: ReactNode }) {
  const token = useToken()
  const state = useRunner(runner)
  const [location] = useLocation()
  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="font-semibold">
            Chess Trainer
          </Link>
          {token ? (
            <button type="button" className={button} onClick={() => void logout()}>
              Se déconnecter de Lichess
            </button>
          ) : (
            <button type="button" className={button} onClick={() => void login()}>
              Se connecter avec Lichess
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28">
        <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>
      </main>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {state.activeId && state.progress && (
          <p className={`${toast} bg-emerald-50 dark:bg-emerald-950`}>
            <Link href={`/r/${state.activeId}/generation`} className="underline">
              Génération en cours : {state.progress.expanded} positions traitées,{' '}
              {state.progress.pending} en attente
            </Link>
          </p>
        )}
        {state.message && (
          <p role="alert" className={`${toast} bg-amber-50 dark:bg-amber-950`}>
            {state.message}
          </p>
        )}
      </div>
    </div>
  )
}
