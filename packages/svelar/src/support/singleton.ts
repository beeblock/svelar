/**
 * Cross-bundle singleton helper.
 *
 * tsup bundles each entry point independently, duplicating module-scoped variables.
 * This means `export const Foo = new FooManager()` produces a separate instance in
 * every bundle that imports the file. Using `Symbol.for()` on `globalThis` ensures
 * only one instance exists per key across the entire process, regardless of how many
 * bundles reference it.
 */
export function singleton<T>(key: string, factory: () => T): T {
  const sym = Symbol.for(key);
  const g = globalThis as any;
  if (!g[sym]) {
    g[sym] = factory();
  }
  return g[sym];
}
