// Read the date a photo was taken from its EXIF data (JPEG only), as YYYY-MM-DD.
// Returns null when the file has no usable date (screenshots, edited or stripped images).
// iOS converts HEIC to JPEG when a web page picks a photo, so JPEG covers phone uploads.
export async function photoTakenDate(file) {
  try {
    // EXIF sits in the APP1 segment near the start of the file.
    const buf = await file.slice(0, 256 * 1024).arrayBuffer()
    const v = new DataView(buf)
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null // not a JPEG

    let off = 2
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off)
      const size = v.getUint16(off + 2)
      if ((marker & 0xff00) !== 0xff00) return null
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return readTiff(v, off + 10) // "Exif"
      if (marker === 0xffda) return null // image data starts; no EXIF found
      off += 2 + size
    }
  } catch {
    // unreadable: fall through
  }
  return null
}

function readTiff(v, tiff) {
  const little = v.getUint16(tiff) === 0x4949 // "II"
  const u16 = (o) => v.getUint16(o, little)
  const u32 = (o) => v.getUint32(o, little)

  // Returns { tag: valueOffset } for the entries we care about in one IFD.
  const entries = (ifd) => {
    const out = {}
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      out[u16(e)] = e + 8
    }
    return out
  }
  const ascii = (entry) => {
    const start = tiff + u32(entry) // 20-byte strings are always stored by offset
    let s = ''
    for (let i = 0; i < 19 && start + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(start + i))
    return s
  }

  const ifd0 = entries(tiff + u32(tiff + 4))
  const exif = ifd0[0x8769] ? entries(tiff + u32(ifd0[0x8769])) : {}
  // Taken, then digitized, then last-modified: first valid one wins.
  for (const entry of [exif[0x9003], exif[0x9004], ifd0[0x0132]]) {
    const m = entry && ascii(entry).match(/^(\d{4}):(\d{2}):(\d{2})/)
    if (m && m[1] !== '0000' && m[2] !== '00' && m[3] !== '00') return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}
