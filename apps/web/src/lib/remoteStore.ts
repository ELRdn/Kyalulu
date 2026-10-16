/** Secrets live in IndexedDB, never URL queries or localStorage. */
import {isCloud,cloudOwner} from './cloudMode';
export type RemoteDevice = {
  id: string; ownerId: string; hostId: string; deviceId: string;
  relay: string; name: string; hostName?: string; token: string; privateKey: string; hostKey: string;
};
const DB = 'kyalulu-remote-v1';
let selected: RemoteDevice | null = null;
export function activeRemote() { return selected; }
export function connectionScope() {
  return selected ? `remote:${selected.relay}:${selected.ownerId}:${selected.hostId}` : isCloud() ? `cloud:${window.location.origin}:${cloudOwner()}` : window.location.origin;
}
export function scopedKey(key: string) {
  return selected || isCloud() ? `${key}:${encodeURIComponent(connectionScope())}` : key;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('devices', { keyPath: 'id' }); };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(new Error('端末鍵を保存できません。ブラウザーの保存設定を確認してください。'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('devices', mode);
    const request = action(tx.objectStore('devices'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('端末登録を保存できませんでした。')); };
  });
}
export const remoteDevices = () => transaction<RemoteDevice[]>('readonly', store => store.getAll());
export const saveRemote = (device: RemoteDevice) => transaction('readwrite', store => store.put(device));
export const deleteRemote = (id: string) => transaction('readwrite', store => store.delete(id));
export async function restoreRemote() {
  const id = localStorage.getItem('kyalulu-active-remote');
  selected = id ? (await remoteDevices()).find(d => d.id === id) ?? null : null;
  if (id && !selected) throw new Error('接続先の端末鍵が見つかりません。PCから再登録してください。');
  return selected;
}
export function selectRemote(device: RemoteDevice | null) {
  // Reload tears down all old requests/components. Never reuse another host's view state.
  if (device) localStorage.setItem('kyalulu-active-remote', device.id);
  else localStorage.removeItem('kyalulu-active-remote');
  location.hash = '/chats';
  location.reload();
}
