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
  // Desk: office, school and art supplies and other desk things. The id stays 'stationery'.
  stationery: { label: 'Desk', emoji: '✏️', description: 'Office, school and art supplies and other desk things', takes: ['stationery', 'art', 'books'] },
  // Scraps & tools: tools, hardware, bike parts and scrap metal. The id stays 'tools'.
  tools: { label: 'Scraps & tools', emoji: '🔧', description: 'Tools, hardware, bike parts and scrap metal', takes: ['tools', 'hardware', 'vehicle'] },
  produce: { label: 'Fruits & vegetables', emoji: '🥕', description: 'Raw fruit and vegetables', takes: ['produce'] },
  // Pantry: what's in the kitchen cupboards (snacks, baking, pasta, beans, coffee...). The id stays 'food'.
  food: { label: 'Pantry', emoji: '🥫', description: 'Pantry food: snacks, baking, pasta, beans, coffee and more', takes: ['prepared_food'] },
  // Garden: letters of flowers, leaves, twigs and feathers, and garden creatures. The id stays 'plants'.
  plants: { label: 'Garden', emoji: '🌱', description: 'Flowers, leaves, feathers and garden creatures', takes: ['nature'] },
};

/** The kid-facing category a finer catalogue category belongs to, or null when it is left out. */
export function groupOf(fine: string): string | null {
  if (fine in GROUPS) return fine;
  for (const [id, g] of Object.entries(GROUPS)) if (g.takes.includes(fine)) return id;
  return null;
}
