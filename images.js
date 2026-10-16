// ===== Snack Stand – photo handling =====
// Photos are cropped square, shrunk and compressed before they go into IndexedDB,
// so a 12-megapixel camera shot becomes a ~40 KB thumbnail.

export const THUMB_SIZE = 512;

export function fileToThumb(file, size = THUMB_SIZE, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No photo was chosen.')); return; }
    if (file.type && !file.type.startsWith('image/')) { reject(new Error('Please choose a photo (JPEG, PNG or HEIC).')); return; }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) throw new Error('That image could not be read.');
        const side = Math.min(w, h);
        const sx = Math.floor((w - side) / 2);
        const sy = Math.floor((h - side) / 2);
        const out = Math.min(size, side);
        const canvas = document.createElement('canvas');
        canvas.width = out;
        canvas.height = out;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, out, out);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image this app can read.'));
    };
    img.src = url;
  });
}

/** Rough decoded size of a data URL, for showing "about 40 KB". */
export function approxBytes(dataUrl) {
  if (!dataUrl) return 0;
  const i = dataUrl.indexOf(',');
  return Math.floor((dataUrl.length - i - 1) * 3 / 4);
}
