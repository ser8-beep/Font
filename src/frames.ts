// The poster frame sizes (kept apart from design.ts so scripts can use them without the app's assets).

export type FixedFrame = 'phone' | 'ipad' | 'desktop' | 'a4' | 'a3';
/** 'picture': the picture background's own shape. */
export type FrameId = FixedFrame | 'picture';

export interface Frame { label: string; w: number; h: number; note: string }

export const FRAMES: Record<FixedFrame, Frame> = {
  phone: { label: 'Phone wallpaper', w: 1170, h: 2532, note: '1170 × 2532' },
  ipad: { label: 'iPad wallpaper', w: 2048, h: 2732, note: '2048 × 2732' },
  desktop: { label: 'Desktop wallpaper', w: 2560, h: 1440, note: '2560 × 1440' },
  a4: { label: 'A4 poster', w: 2480, h: 3508, note: 'prints at 300 dpi' },
  // 250 dpi: at 300 dpi an A3 picture is too big for phones and tablets to make.
  a3: { label: 'A3 poster', w: 2923, h: 4134, note: 'prints at 250 dpi' },
};
export const FRAME_IDS = Object.keys(FRAMES) as FixedFrame[];
