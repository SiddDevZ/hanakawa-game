// databuddy custom events. the tracker is the script tag in index.html; while it is still loading,
// blocked, or ignored (localhost), calls are dropped.
type Props = Record<string, string | number | boolean>;

export function track(name: string, props?: Props) {
  try {
    (window as { databuddy?: { track(name: string, props?: Props): void } }).databuddy?.track(name, props);
  } catch {
    // analytics must never break the game
  }
}
