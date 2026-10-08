// Mixing themes in one typeface: percent shares, and which theme each missing letter comes from.

export interface ThemeShare {
  id: string;
  /** Percent of the whole typeface. */
  share: number;
}

/** Percent shares that total exactly 100 (largest remainder), biggest first; zero shares dropped. */
export function normalise(weights: Record<string, number>): ThemeShare[] {
  const items = Object.entries(weights).filter(([, w]) => w > 0);
  const sum = items.reduce((t, [, w]) => t + w, 0);
  if (!sum) return [];
  const raw = items.map(([id, w]) => ({ id, exact: (w / sum) * 100 }));
  const out = raw.map((r) => ({ id: r.id, share: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = 100 - out.reduce((t, r) => t + r.share, 0);
  for (const r of [...out].sort((a, b) => b.rem - a.rem)) if (left-- > 0) r.share++;
  return out.filter((r) => r.share > 0).sort((a, b) => b.share - a.share || a.id.localeCompare(b.id)).map(({ id, share }) => ({ id, share }));
}

/**
 * Which theme each missing letter comes from. Each theme's share counts across the whole
 * typeface, so the kid's own letters tagged with a theme count towards it; the rest are shared out
 * over the missing letters and spread evenly through the alphabet. A theme without its own version
 * of a letter passes it to the next theme that has one.
 */
export function assignThemes(todo: string[], total: number, themes: ThemeShare[], ownTagged: Map<string, number>, has: (theme: string, ch: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  if (!themes.length || !todo.length) return out;
  // Letters each theme still needs, by largest remainder over the missing letters.
  const want = themes.map((t) => Math.max(0, (t.share / 100) * total - (ownTagged.get(t.id) ?? 0)));
  const sum = want.reduce((a, b) => a + b, 0) || 1;
  const exact = want.map((w) => (w / sum) * todo.length);
  const count = exact.map(Math.floor);
  let left = todo.length - count.reduce((a, b) => a + b, 0);
  for (const i of exact.map((_, i) => i).sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])))) if (left-- > 0) count[i]++;
  const given = themes.map(() => 0);
  todo.forEach((ch, i) => {
    // The theme furthest behind its even spread that has this letter; else any theme behind.
    const behind = themes.map((_, k) => ({ k, gap: (count[k] * (i + 1)) / todo.length - given[k] })).sort((a, b) => b.gap - a.gap);
    const k = (behind.find((b) => count[b.k] > given[b.k] && has(themes[b.k].id, ch)) ?? behind.find((b) => has(themes[b.k].id, ch)) ?? behind[0]).k;
    given[k]++;
    out.set(ch, themes[k].id);
  });
  return out;
}

