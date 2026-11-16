"use client";

import { useMemo, useRef, useSyncExternalStore } from "react";
import type { BehaviorSubject, Observable } from "rxjs";

/**
 * Subscribes to an RxJS Observable using React 19's useSyncExternalStore,
 * ensuring tear-free rendering and clean unmount teardown.
 */
export function useObservable<T>(
  observable$: Observable<T>,
  initialValue: T,
): T {
  const initialRef = useRef(initialValue);

  const [subscribe, getSnapshot] = useMemo(() => {
    let currentValue = initialRef.current;
    let hasEmitted = false;

    return [
      (onStoreChange: () => void) => {
        const subscription = observable$.subscribe({
          next: (value) => {
            currentValue = value;
            hasEmitted = true;
            onStoreChange();
          },
          error: (err) => {
            console.error("Observable error in useObservable:", err);
          },
        });
        return () => subscription.unsubscribe();
      },
      () => (hasEmitted ? currentValue : initialRef.current),
    ];
  }, [observable$]);

  return useSyncExternalStore(subscribe, getSnapshot, () => initialRef.current);
}

/**
 * Subscribes to an RxJS BehaviorSubject using React 19's useSyncExternalStore.
 */
export function useBehaviorSubject<T>(subject$: BehaviorSubject<T>): T {
  const [subscribe, getSnapshot] = useMemo(() => {
    return [
      (onStoreChange: () => void) => {
        const subscription = subject$.subscribe({
          next: () => onStoreChange(),
          error: (err) =>
            console.error("BehaviorSubject error in useBehaviorSubject:", err),
        });
        return () => subscription.unsubscribe();
      },
      () => subject$.getValue(),
    ];
  }, [subject$]);

  return useSyncExternalStore(subscribe, getSnapshot, () =>
    subject$.getValue(),
  );
}
