// Custom service worker (replaces the auto-generated one) so it can
// handle Web Push events — showing a notification when one arrives,
// and opening the right page when it's tapped.
//
// `self.__WB_MANIFEST` below is required: the build step replaces it
// with the list of files to precache, same as the auto-generated
// service worker did. It has to be assigned to something used, or the
// bundler strips it out as dead code before the build step ever sees it.
const PRECACHE_MANIFEST = self.__WB_MANIFEST
self.__precacheManifest = PRECACHE_MANIFEST

const APP_SCOPE = self.registration.scope

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'True Homes', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'True Homes'
  const options = {
    body: data.body || '',
    icon: `${APP_SCOPE}icon-192.png`,
    badge: `${APP_SCOPE}icon-192.png`,
    tag: data.tag,
    data: { url: data.url || APP_SCOPE }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || APP_SCOPE

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.startsWith(APP_SCOPE))
      if (existing) {
        existing.navigate(url)
        return existing.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
