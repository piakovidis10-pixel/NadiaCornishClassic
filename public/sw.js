'use strict';

self.addEventListener('push', event => {
  let title = 'Nadia Cornish Classic';
  let body  = '';
  let data  = {};

  if (event.data) {
    try {
      const d = event.data.json();
      title = d.title || title;
      body  = d.body  || body;
      data  = d.data  || data;
    } catch (_) {
      body = event.data.text();
    }
  }

  // Use a per-hole tag so corrected scores replace the previous notification
  // rather than stacking, but different holes each get their own banner.
  const tag = `golf-d${data.day || 0}-t${data.teamId ?? 0}-h${data.holeIndex ?? 0}`;

  // Keep good-news notifications on screen until dismissed
  const exciting = ['albatross', 'eagle', 'birdie'].includes(data.notifType);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      tag,
      icon:               '/icon.svg',
      badge:              '/badge.svg',
      renotify:           true,
      requireInteraction: exciting,
      actions: [{ action: 'view', title: '📊 View Scores' }]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        const app = list.find(c => c.url.includes(self.registration.scope));
        if (app) return app.focus();
        return clients.openWindow('/');
      })
  );
});
