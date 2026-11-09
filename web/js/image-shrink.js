// Shrinks a map image in the browser, so the server (which cannot resize images) only ever stores small files: a thumbnail
// for the zone tile and a larger picture for the full-size view. Output is base64 text (no "data:" prefix) of a WebP image
// (JPEG where the browser cannot make WebP), at most `maxBytes`.

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// file: a File of any image the browser can show. width: the widest it should be (never enlarged).
export async function shrinkImage(file, { width, quality, maxBytes = 450 * 1024 }) {
  const bitmap = await createImageBitmap(file);
  try {
    let w = Math.min(width, bitmap.width);
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let blob = await toBlob(canvas, 'image/webp', quality);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality); // this browser cannot make WebP
      if (blob && blob.size <= maxBytes) return toBase64(blob);
      w = Math.round(w * 0.8); // too big: a little smaller and try again
      quality = Math.max(0.5, quality - 0.1);
    }
    throw new Error('image-too-large');
  } finally {
    bitmap.close();
  }
}
