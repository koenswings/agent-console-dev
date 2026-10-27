/**
 * Equality for ordered ID lists, used as the `equals` option of createMemo so
 * a memo over IDs only notifies when the list really changes. Element-wise
 * comparison; not a list key (idea#309).
 */
export const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, pos) => id === b[pos]);
