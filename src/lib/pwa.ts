type UpdateCallback = () => void

let _onUpdateReady: UpdateCallback | null = null
let _waitingSW: ServiceWorker | null = null
let _refreshing = false

function notifyUpdateReady(sw: ServiceWorker) {
  _waitingSW = sw
  _onUpdateReady?.()
}

export function onSWUpdateReady(cb: UpdateCallback) {
  _onUpdateReady = cb
  // If SW was already waiting before callback was registered, fire immediately
  if (_waitingSW) cb()
}

export function applySWUpdate() {
  if (_waitingSW) {
    _waitingSW.postMessage({ type: 'SKIP_WAITING' })
    return
  }
  // Fallback: no waiting worker was found, so reload current app shell.
  window.location.reload()
}

function watchRegistration(registration: ServiceWorkerRegistration) {
  const checkWaitingWorker = () => {
    if (registration.waiting) notifyUpdateReady(registration.waiting)
  }

  checkWaitingWorker()

  registration.addEventListener('updatefound', () => {
    const newSW = registration.installing
    if (!newSW) return
    newSW.addEventListener('statechange', () => {
      if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
        // New SW installed and waiting — old one still active until user refreshes.
        notifyUpdateReady(newSW)
      }
    })
  })

  const runUpdateCheck = () => {
    void registration.update().catch(() => {})
  }

  // Check once shortly after startup, then periodically while app is open.
  window.setTimeout(runUpdateCheck, 1500)
  window.setInterval(runUpdateCheck, 60 * 1000)

  window.addEventListener('focus', runUpdateCheck)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runUpdateCheck()
  })
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        watchRegistration(registration)
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error)
      })

    // When SW activates (after skipWaiting), reload all clients
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!_refreshing) {
        _refreshing = true
        window.location.reload()
      }
    })
  })
}
