// Turns letter photos into font pictures (resized PNGs) off the main thread.
//
// main -> worker  { id, image, outline }   one letter's material cut-out and its outline
// worker -> main  { id, picture }          the font picture (or picture: null if it failed)
import { glyphPicture } from './core/picture';

self.onmessage = (e: MessageEvent) => {
  const { id, image, outline } = e.data;
  let picture = null;
  try {
    picture = glyphPicture(image, outline);
  } catch (err) {
    console.warn('could not make a picture for', id, err);
  }
  (self as unknown as Worker).postMessage({ id, picture });
};
