/**
 * Utility function templates
 */

export const cnUtil = `/**
 * Merge class names utility
 * Used by UI components for conditional class composition
 */

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes
    .filter(Boolean)
    .join(' ')
    .trim();
}
`;
