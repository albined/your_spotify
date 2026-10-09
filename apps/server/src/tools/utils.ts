export function compact<T>(array: Array<T>): Array<NonNullable<T>> {
  return array.filter((item): item is NonNullable<T> => item != null);
}

// Lets text typed by a user be matched literally inside a regular expression.
export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
