import { newByteImage, newFloatImage } from "../src/images";
import type { PhotoAnalysis } from "../src/laserJob";

export function roundFacePhoto(size = 200): PhotoAnalysis {
  const gray = newByteImage(size, size);
  const person = newFloatImage(size, size);
  const skin = newFloatImage(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const isFace = Math.hypot(x - size / 2, y - size / 2) < size * 0.45;
      gray.data[index] = Math.floor((x / size) * 255);
      person.data[index] = isFace ? 1 : 0;
      skin.data[index] = isFace ? 0.5 : 0;
    }
  }
  return { gray, person, areas: { skin }, message: "" };
}
