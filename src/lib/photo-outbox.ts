/**
 * IndexedDB outbox for stage photos taken with no signal.
 *
 * When an upload fails from a network error (or the device is plainly
 * offline), the compressed photo is stored here instead of being lost.
 * PhotoOutboxPill drains the queue whenever connectivity returns.
 *
 * Client-side only. Blobs persist across app restarts (IndexedDB), so
 * a photo shot in a dead-zone house survives closing the app in the
 * driveway.
 */

export type OutboxPhoto = {
  id: string;
  stageId: string;
  name: string;
  type: string;
  blob: Blob;
  createdAt: number;
  attempts: number;
};

const DB_NAME = "shs-photo-outbox";
const STORE = "photos";

/** Fired on window whenever the outbox contents change. */
export const OUTBOX_EVENT = "photo-outbox-changed";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
        t.onabort = () => db.close();
      }),
  );
}

function notify() {
  try {
    window.dispatchEvent(new Event(OUTBOX_EVENT));
  } catch {
    // Non-window contexts don't need the signal.
  }
}

export async function addToOutbox(
  item: Omit<OutboxPhoto, "createdAt" | "attempts">,
): Promise<void> {
  await tx("readwrite", (s) =>
    s.put({ ...item, createdAt: Date.now(), attempts: 0 }),
  );
  notify();
}

export async function listOutbox(): Promise<OutboxPhoto[]> {
  const items = await tx<OutboxPhoto[]>("readonly", (s) => s.getAll());
  return (items ?? []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeFromOutbox(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  notify();
}

export async function bumpAttempts(item: OutboxPhoto): Promise<void> {
  await tx("readwrite", (s) =>
    s.put({ ...item, attempts: (item.attempts ?? 0) + 1 }),
  );
}

export async function outboxCount(): Promise<number> {
  return await tx<number>("readonly", (s) => s.count());
}

export async function clearOutbox(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
  notify();
}

/** Give permanently-failed items another chance (pill's tap-to-retry). */
export async function resetAllAttempts(): Promise<void> {
  const items = await listOutbox();
  for (const item of items) {
    if ((item.attempts ?? 0) > 0) {
      await tx("readwrite", (s) => s.put({ ...item, attempts: 0 }));
    }
  }
  notify();
}

/**
 * Wipe everything offline support persists — cached pages/images and
 * the photo outbox. Called on sign-out so a shared device can't read
 * another user's cached pages offline, and queued photos can't upload
 * under the next person's session.
 */
export async function clearOfflineData(): Promise<void> {
  try {
    await clearOutbox();
  } catch {
    // IndexedDB unavailable — nothing queued to clear.
  }
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("shs-")).map((n) => caches.delete(n)),
      );
    }
  } catch {
    // Cache API unavailable — nothing cached to clear.
  }
}

/** True for errors that mean "no/poor connectivity", not "server said no". */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const err = e as Error | undefined;
  // Browser-level network failures are TypeErrors. Messages vary by
  // engine AND locale (WebKit localizes them), so don't keyword-match:
  // genuine server-side action errors surface as plain Error, never
  // TypeError, making the name alone a safe discriminator.
  if (err?.name === "TypeError") return true;
  const msg = String(err?.message ?? e ?? "").toLowerCase();
  return (
    // Next throws this plain Error when a server action's response
    // isn't the expected payload — e.g. a gateway 502/timeout page on a
    // flaky link. (True server-side action errors carry a digest
    // message instead.)
    msg.includes("unexpected response") ||
    msg.includes("timed out") ||
    msg.includes("network") ||
    msg.includes("connection") ||
    msg.includes("load failed") ||
    msg.includes("hostname") ||
    msg.includes("internet")
  );
}
