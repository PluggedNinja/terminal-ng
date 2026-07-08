/**
 * bus.js — tiny in-memory event bus used to stream terminal command events to
 * the AI copilot (Auto-Pilot) without prop-drilling through the window manager.
 */
const listeners = {};

export function on(event, fn) {
  (listeners[event] ||= new Set()).add(fn);
  return () => { listeners[event]?.delete(fn); };
}

export function emit(event, data) {
  const set = listeners[event];
  if (!set) return;
  for (const fn of set) { try { fn(data); } catch { /* ignore listener errors */ } }
}
