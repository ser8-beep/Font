// Looks at the kid's letters off the main thread (the analysis takes about half a second).
//
// main -> worker  { sig, samples }               the kid's photographed letters
// worker -> main  { sig, ranked, looks }          repository categories they look like (best
//                                                 first) and their colour make-up
//                 { sig, error }                  when they couldn't be read
import { looksOfArray, matchLetters } from './match';

self.onmessage = (e: MessageEvent) => {
  const { sig, samples } = e.data;
  try {
    (self as unknown as Worker).postMessage({ sig, ranked: matchLetters(samples), looks: looksOfArray(samples) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ sig, error: String(err) });
  }
};
