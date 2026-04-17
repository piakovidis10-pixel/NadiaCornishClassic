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

  event.waitUntil(
    self.registration.showNotification(title, { body, data, tag: 'golf-notif' })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => list.length ? list[0].focus() : clients.openWindow('/'))
  );
});
