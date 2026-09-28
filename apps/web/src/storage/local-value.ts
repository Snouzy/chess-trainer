import { useSyncExternalStore } from 'react'

export function localValue(key: string) {
  const listeners = new Set<() => void>()

  function get(): string | undefined {
    try {
      return localStorage.getItem(key) ?? undefined
    } catch {
      return undefined
    }
  }

  function set(value: string | undefined): void {
    try {
      if (value === undefined) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      return
    }
    for (const listener of listeners) listener()
  }

  function useValue(): string | undefined {
    return useSyncExternalStore((listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }, get)
  }

  return { get, set, use: useValue }
}
