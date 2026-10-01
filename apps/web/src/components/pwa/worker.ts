'use client';
// Browser-side helpers shared by the service-worker registration, the push switch and sign-out.
export const workerSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
export const pushSupported = () => workerSupported() && 'PushManager' in window && 'Notification' in window;
export const registerWorker = () => navigator.serviceWorker.register('/sw.js', {scope: '/'});
export async function tellWorker(message: {type: 'SIGNED_OUT'} | {type: 'VIEWED'; url: string}) {
  if (!workerSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  (navigator.serviceWorker.controller || registration?.active)?.postMessage(message);
}
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return await registration?.pushManager.getSubscription() ?? null;
}
const keyBytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
// Asks for permission, subscribes this browser and stores the subscription for the signed-in account.
// Rejects with PUSH_UNAVAILABLE (server has no keys), PUSH_DENIED (permission refused) or the API error code.
export async function enablePush() {
  const {key} = await (await fetch('/api/push/key', {cache: 'no-store'})).json();
  if (typeof key !== 'string' || !key) throw new Error('PUSH_UNAVAILABLE');
  if (await Notification.requestPermission() !== 'granted') throw new Error('PUSH_DENIED');
  await registerWorker();
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with an older server key cannot be reused.
  if (subscription && subscription.options.applicationServerKey
    && btoa(String.fromCharCode(...new Uint8Array(subscription.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key.replace(/=+$/, '')) {
    await subscription.unsubscribe(); subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: keyBytes(key)});
  const response = await fetch('/api/push/subscriptions', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(subscription.toJSON())});
  if (!response.ok) {
    await subscription.unsubscribe().catch(() => undefined);
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.error === 'string' ? data.error : 'PUSH_FAILED');
  }
}
// Removes this browser's subscription from the account and from the browser. Safe to call when there is none.
export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await fetch('/api/push/subscriptions', {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({endpoint: subscription.endpoint})}).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
const SIGNED_IN = 'dc-signed-in';
export const rememberSession = (signedIn: boolean) => {try {const was = localStorage.getItem(SIGNED_IN) === '1'; localStorage.setItem(SIGNED_IN, signedIn ? '1' : '0'); return was;} catch {return false;}};
/**
 * Call BEFORE the sign-out request (the session is still needed to delete the push subscription):
 * `await signOutCleanup()`. It stops pushes to this browser and empties the offline page cache. Never throws.
 */
export async function signOutCleanup() {
  try {await disablePush(); await tellWorker({type: 'SIGNED_OUT'}); rememberSession(false);} catch {/* sign-out must go on */}
}
