/** Intentionally weak sample for Curl dogfood — do not use in production. */
export function greet(name: string): string {
  // Reflects unsanitized input into HTML (XSS).
  return `<h1>Hello ${name}</h1>`;
}

export function pageSize(total: number, page: number, size: number): number {
  // Off-by-one: last page can drop the final item.
  return Math.min(size, total - page * size);
}
