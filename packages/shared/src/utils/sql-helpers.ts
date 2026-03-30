/**
 * Escapes LIKE/ILIKE wildcard characters in user input.
 * Prevents `%` and `_` from being interpreted as pattern wildcards.
 * Uses backslash as the escape character (Postgres default).
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}
