/*
 * Reads an image's pixel size from its first bytes (PNG, GIF, JPEG, WebP),
 * and turns small images into data URLs for the self-contained HTML report.
 */

/** Width and height in pixels, or `null` when the format is not recognized. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; format: string } | null {
  const b = bytes;
  const u16be = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const u16le = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const u32be = (i: number) => (((b[i] ?? 0) << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return { width: u32be(16), height: u32be(20), format: 'png' };
  }
  if (b.length >= 10 && ascii(0, 3) === 'GIF') {
    return { width: u16le(6), height: u16le(8), format: 'gif' };
  }
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff, format: 'webp' };
    if (chunk === 'VP8L') {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' };
    }
    if (chunk === 'VP8X') {
      const w = 1 + ((b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16));
      const h = 1 + ((b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16));
      return { width: w, height: h, format: 'webp' };
    }
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1] ?? 0;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = u16be(i + 2);
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(i + 7), height: u16be(i + 5), format: 'jpeg' };
      }
      i += 2 + length;
    }
    return null;
  }
  return null;
}

/** Base64 without Node's Buffer, so it runs anywhere. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
