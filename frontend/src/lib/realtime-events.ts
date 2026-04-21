export type RealtimeUpdateType = "new_admin" | "new_student" | "new_submission";

export interface RealtimeUpdateEventDetail {
  type: RealtimeUpdateType;
}

const EVENT_NAME = "upms:realtime-update";

export function emitRealtimeUpdate(type: RealtimeUpdateType): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RealtimeUpdateEventDetail>(EVENT_NAME, { detail: { type } }));
}

export function onRealtimeUpdate(
  handler: (detail: RealtimeUpdateEventDetail) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const listener = (event: Event): void => {
    const custom = event as CustomEvent<RealtimeUpdateEventDetail>;
    if (!custom.detail?.type) return;
    handler(custom.detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
