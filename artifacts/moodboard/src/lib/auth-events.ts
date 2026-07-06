type UnauthenticatedListener = () => void;

let listener: UnauthenticatedListener | null = null;

export function onUnauthenticated(callback: UnauthenticatedListener): void {
  listener = callback;
}

export function notifyUnauthenticated(): void {
  listener?.();
}
