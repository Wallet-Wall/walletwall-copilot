/** Recursively freeze plain data. WallPrint records, events, views and stored evidence are all frozen before they leave a module. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const k of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[k]);
    Object.freeze(value);
  }
  return value;
}
