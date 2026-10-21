/** Escapa los comodines de LIKE/ILIKE para buscar el texto tal cual. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
