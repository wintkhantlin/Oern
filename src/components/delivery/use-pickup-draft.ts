"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearDraft,
  defaultSchedule,
  emptyDraft,
  loadDraft,
  type PickupDraft,
  saveDraft,
} from "@/lib/delivery/pickup-draft";

/**
 * The pickup request being typed, kept in step with browser storage so it
 * survives the map screens, a sign-in and a reload. Nothing is written before
 * the stored draft has been read, so an empty first render never erases it.
 */
export function usePickupDraft() {
  const [draft, setDraft] = useState<PickupDraft>(() => emptyDraft());
  const [hydrated, setHydrated] = useState(false);
  // The draft just read from storage. Until it reaches state, the state on
  // screen is older than storage: a page kept alive while the map screen ran
  // shows again with its old draft, and saving that would erase the new pin.
  const pending = useRef<PickupDraft | null>(null);

  useEffect(() => {
    const stored = loadDraft();
    pending.current = stored;
    setDraft(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (pending.current) {
      if (draft !== pending.current) return;
      pending.current = null;
    }
    saveDraft(draft);
  }, [draft, hydrated]);

  const update = useCallback(
    (patch: Partial<PickupDraft>) =>
      setDraft((current) => ({ ...current, ...patch })),
    [],
  );

  /** Forget the request, after it was sent. */
  const reset = useCallback(() => {
    clearDraft();
    setHydrated(false);
    setDraft(emptyDraft(defaultSchedule()));
    // Stay unsaved until the next screen loads, so nothing is written back.
  }, []);

  return { draft, hydrated, update, reset };
}
