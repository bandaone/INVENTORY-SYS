export const POS_TERMINAL_STORAGE_KEY = 'retail-os-pos-terminal-session'
export const POS_TERMINAL_HEADER = 'x-retail-pos-session'

const POS_WINDOW_PREFIX = 'retail-os-pos:'

type StoredTerminalSession = { token: string; tabId: string }

export function storePosTerminalSession(token: string) {
  const tabId = crypto.randomUUID()
  const stored: StoredTerminalSession = { token, tabId }
  window.name = `${POS_WINDOW_PREFIX}${tabId}`
  sessionStorage.setItem(POS_TERMINAL_STORAGE_KEY, JSON.stringify(stored))
}

export function getPosTerminalToken() {
  try {
    const raw = sessionStorage.getItem(POS_TERMINAL_STORAGE_KEY)
    if (!raw) return ''
    const stored = JSON.parse(raw) as StoredTerminalSession
    if (!stored?.token || !stored.tabId || window.name !== `${POS_WINDOW_PREFIX}${stored.tabId}`) return ''
    return stored.token
  } catch {
    return ''
  }
}

export function clearPosTerminalSession() {
  sessionStorage.removeItem(POS_TERMINAL_STORAGE_KEY)
  if (window.name.startsWith(POS_WINDOW_PREFIX)) window.name = ''
}
