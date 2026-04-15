'use strict';

// Service Worker for Nadia Cornish Classic
// Handles incoming push notifications and notification click events.

self.addEventListener('push', event => {
  let data = { title: 'Nadia Cornish Classic', body: '' };
  if (event.data) {
    try { data = event.data.json(); }
    catch (_) { data.body = event.data.text(); }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:               data.body || '',
      data:               data.data || {},
      vibrate:            [200, 100, 200, 100, 200],
      requireInteraction: false,
      // Use a unique tag per notification so they stack rather than replace each other
      tag: `golf-${Date.now()}`
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(openClients => {
        if (openClients.length > 0) return openClients[0].focus();
        return clients.openWindow('/');
      })
  );
});
