type Listener = (value: unknown) => void

export class Registry {
  private data = new Map<string, unknown>()
  private listeners = new Map<string, Set<Listener>>()

  get<T>(key: string): T {
    return this.data.get(key) as T
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value)
    const listeners = this.listeners.get(key)
    if (listeners) {
      for (const fn of listeners) fn(value)
    }
  }

  on(key: string, callback: Listener): void {
    let set = this.listeners.get(key)
    if (!set) { set = new Set(); this.listeners.set(key, set) }
    set.add(callback)
  }

  off(key: string, callback: Listener): void {
    this.listeners.get(key)?.delete(callback)
  }

  has(key: string): boolean {
    return this.data.has(key)
  }
}

export const registry = new Registry()
