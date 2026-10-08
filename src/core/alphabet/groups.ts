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
  // The ids stay as they were (folders, saved work and the repository use them); only names change.
  stationery: { label: 'Doodle Desk', emoji: '✏️', description: 'Pens, paper, art supplies and desk odds and ends', takes: ['stationery', 'art', 'books'] },
  tools: { label: "Tinker's Toolbox", emoji: '🔧', description: 'Tools, nuts and bolts, bike bits and rusty scraps', takes: ['tools', 'hardware', 'vehicle'] },
  produce: { label: 'Market Basket', emoji: '🧺', description: 'Fruit, veg and herbs, fresh from the stall', takes: ['produce'] },
  food: { label: 'Pantry Raid', emoji: '🍪', description: 'Snacks, sweets, pasta, beans, honey and baking', takes: ['prepared_food'] },
  plants: { label: 'Secret Garden', emoji: '🌿', description: 'Flowers, leaves, feathers and creepy-crawlies', takes: ['nature'] },
};

/** The kid-facing category a finer catalogue category belongs to, or null when it is left out. */
export function groupOf(fine: string): string | null {
  if (fine in GROUPS) return fine;
  for (const [id, g] of Object.entries(GROUPS)) if (g.takes.includes(fine)) return id;
  return null;
}
