// The five categories kids choose from. Each takes in some of the finer categories the catalogue
// (data/object-type-repository.json) and the cut-out folders were sorted into; the rest (home
// stuff, jewellery, furniture, toys, packaging, textiles, festive, found things, electronics) fit
// none of the five cleanly, so they are left out rather than blurring the five together.

export interface Group {
  label: string;
  emoji: string;
  description: string;
  /** The finer catalogue categories this one is made of. */
  takes: string[];
}

export const GROUPS: Record<string, Group> = {
  stationery: { label: 'Stationery', emoji: '✏️', description: 'Office, school and art supplies', takes: ['stationery', 'art', 'books'] },
  tools: { label: 'Tools', emoji: '🔧', description: 'Hand tools, hardware and mechanical parts', takes: ['tools', 'hardware', 'vehicle'] },
  produce: { label: 'Fruits & vegetables', emoji: '🥕', description: 'Raw fruit and vegetables', takes: ['produce'] },
  food: { label: 'Food', emoji: '🍪', description: 'Snacks, sweets, baked and prepared food', takes: ['prepared_food'] },
  // Botanicals: letters of flowers and leaves (with the odd twig or fern). The id stays 'plants'.
  plants: { label: 'Botanicals', emoji: '🌿', description: 'Flowers and leaves', takes: ['nature'] },
};

/** The kid-facing category a finer catalogue category belongs to, or null when it is left out. */
export function groupOf(fine: string): string | null {
  if (fine in GROUPS) return fine;
  for (const [id, g] of Object.entries(GROUPS)) if (g.takes.includes(fine)) return id;
  return null;
}
