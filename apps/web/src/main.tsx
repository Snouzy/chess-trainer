import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { runner } from './services'
import { completeLoginIfCallback, getToken } from './services/auth'

async function boot() {
  try {
    await completeLoginIfCallback()
  } catch (error) {
    console.error(error)
    alert(
      'La connexion à Lichess a échoué. Réessaie depuis le bouton « Se connecter avec Lichess ».',
    )
  }
  if (getToken()) void runner.kick()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
