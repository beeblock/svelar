/** Browser-safe identifier predicates shared by both validation providers. */
export function isUuidv7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isUlid(value: string): boolean {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value);
}
