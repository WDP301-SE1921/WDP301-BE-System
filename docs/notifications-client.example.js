// Web or native app: npm install socket.io-client. The caller owns secure token storage.
import { io } from 'socket.io-client';

export function createNotificationsClient({ baseUrl, getAccessToken, refreshAccessToken, onChange, onError }) {
  let stopped = false;
  let refreshTimer;
  let pending;
  let recovering = false;
  let generation = 0;
  const socket = io(`${baseUrl}/notifications`, {
    path: '/socket.io', transports: ['websocket'], autoConnect: false,
    auth: (callback) => {
      Promise.resolve(getAccessToken()).then((token) => callback({ token }), onError);
    },
  });
  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      ...options, headers: { Authorization: `Bearer ${await getAccessToken()}` },
    });
    if (!response.ok) throw new Error(`Notification API: ${response.status}`);
    return (await response.json()).data;
  }
  async function sync() {
    if (stopped) return;
    const version = ++generation;
    pending?.abort();
    pending = new AbortController();
    const signal = pending.signal;
    try {
      const [inbox, count] = await Promise.all([
        request('/notifications?page=1&limit=20', { signal }),
        request('/notifications/unread-count', { signal }),
      ]);
      if (!stopped && version === generation) onChange({ ...inbox, unreadCount: count.unreadCount });
    } catch (error) {
      if (!stopped && error.name !== 'AbortError') onError(error);
    }
  }
  function scheduleSync() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(sync, 100);
  }
  async function recover() {
    if (stopped || recovering) return;
    recovering = true;
    try {
      await refreshAccessToken(); // Must update getAccessToken()'s underlying storage.
      if (!stopped) socket.connect();
    } catch (error) {
      onError(error); // App should return to login if the refresh session is invalid.
    } finally { recovering = false; }
  }
  // Subscribe before connecting and before the initial REST snapshot.
  socket.on('notification.created', scheduleSync);
  socket.on('notifications.read-changed', scheduleSync);
  socket.on('connect', scheduleSync);
  socket.on('disconnect', (reason) => { if (reason === 'io server disconnect') void recover(); });
  socket.on('connect_error', (error) => {
    if (error.message === 'AUTH_UNAUTHORIZED') void recover();
    else onError(error);
  });
  socket.connect();
  return {
    resync: scheduleSync, // Call on browser focus/native AppState foreground.
    async markRead(id) { await request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }); scheduleSync(); },
    async readAll() { await request('/notifications/read-all', { method: 'POST' }); scheduleSync(); },
    stop() {
      stopped = true;
      ++generation;
      clearTimeout(refreshTimer);
      pending?.abort();
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
