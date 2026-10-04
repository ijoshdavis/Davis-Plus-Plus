"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "kinstore.currentPersonId";

export function getStoredPersonId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredPersonId(personId: string | null) {
  if (typeof window === "undefined") return;
  if (personId) window.localStorage.setItem(STORAGE_KEY, personId);
  else window.localStorage.removeItem(STORAGE_KEY);
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("kinstore-identity-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("kinstore-identity-change", callback);
  };
}

function getServerSnapshot() {
  return null;
}

// "Who am I" - the person record the logged-in user identifies as. Purely a
// client-side preference (not tied to the Supabase auth session), so it
// lives in localStorage rather than the database. Uses useSyncExternalStore
// since localStorage is state outside React that multiple components (nav,
// graph page) need to read consistently - the native "storage" event only
// fires in *other* tabs, so writes dispatch a same-tab custom event too.
export function useCurrentPersonId(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, getStoredPersonId, getServerSnapshot);

  const update = useCallback((next: string | null) => {
    setStoredPersonId(next);
    window.dispatchEvent(new Event("kinstore-identity-change"));
  }, []);

  return [id, update];
}
