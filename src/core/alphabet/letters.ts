// Where letters sit on the line, and which letters a font gets.

/** Font-unit vertical extents. Cap height = 700. */
const CAP = 700, XH = 490, DESC = -210;

/**
 * The font-unit [bottom, top] that the traced ink of ch is scaled into: capitals and ascenders
 * 0..700, x-height letters 0..490, descenders down to -210, punctuation at its usual place.
 */
export function verticalRange(ch: string): [number, number] {
  if (/[A-Z0-9]/.test(ch)) return [0, CAP];
  if ('acemnorsuvwxz'.includes(ch)) return [0, XH];
  if ('bdhkl'.includes(ch)) return [0, CAP];
  if (ch === 'f') return [0, CAP];
  if (ch === 't') return [0, 620];
  if (ch === 'i') return [0, 680];
  if ('gpqy'.includes(ch)) return [DESC, XH];
  if (ch === 'j') return [DESC, 680];
  switch (ch) {
    case '.': return [0, 130];
    case ',': return [-120, 130];
    case "'": return [470, CAP];
    case '"': return [470, CAP];
    case '-': return [250, 370];
    case ':': return [0, XH];
    case ';': return [-120, XH];
    case '+': return [90, 470];
    case '=': return [160, 430];
    default: return [0, CAP]; // ! ? & # @ and anything else cap-height
  }
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';

/** The letters a font whose captured letters include these cases has (letters only, for now). */
export function alphabetChars(cases: { upper: boolean; lower: boolean }): string[] {
  return [...(cases.upper || !cases.lower ? UPPER : ''), ...(cases.lower ? LOWER : '')];
}
