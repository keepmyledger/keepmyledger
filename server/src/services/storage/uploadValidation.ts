/**
 * Magic-byte + size validation for in-memory upload buffers. Mirrors the
 * same belt-and-braces approach as `routes/imports.ts::validateUpload`, but
 * works on a Buffer (multer memoryStorage) instead of a filesystem path.
 *
 * Rejects renamed binaries that lie about their MIME or extension.
 */

export type ReceiptFileKind = 'pdf' | 'jpeg' | 'png' | 'heic';

export interface ReceiptUploadInfo {
  kind: ReceiptFileKind;
  contentType: string;
  ext: string;
}

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10 MB per receipt

/**
 * Validate an uploaded receipt buffer. Returns the canonical kind/ext/MIME on
 * success, throws a user-facing Error on failure.
 */
export function validateReceiptUpload(
  buffer: Buffer,
  declaredMime: string | undefined,
  originalFilename: string | undefined,
): ReceiptUploadInfo {
  if (buffer.length === 0) throw new Error('File is empty');
  if (buffer.length > MAX_RECEIPT_BYTES) {
    throw new Error(`File too large: receipts must be under ${Math.round(MAX_RECEIPT_BYTES / 1024 / 1024)} MB`);
  }
  const kind = detectKind(buffer);
  if (!kind) {
    throw new Error('Unsupported file type: receipts must be PDF, JPEG, PNG, or HEIC');
  }

  // Cross-check the declared mime — if the client lied wildly, reject.
  if (declaredMime && !mimeMatchesKind(declaredMime, kind)) {
    throw new Error(`Declared Content-Type ${declaredMime} does not match detected file type ${kind}`);
  }
  void originalFilename; // accepted for parity with imports.validateUpload; not used for validation
  return canonicalInfo(kind);
}

function detectKind(buf: Buffer): ReceiptFileKind | null {
  // PDF: %PDF-
  if (buf.length >= 5 && buf.slice(0, 5).equals(Buffer.from('%PDF-'))) return 'pdf';
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';
  // HEIC: ISO BMFF container — bytes 4..8 = 'ftyp', bytes 8..12 = 'heic' | 'heix' | 'mif1' | 'msf1'
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1') return 'heic';
  }
  return null;
}

function mimeMatchesKind(mime: string, kind: ReceiptFileKind): boolean {
  const m = mime.toLowerCase();
  switch (kind) {
    case 'pdf':  return m === 'application/pdf';
    case 'jpeg': return m === 'image/jpeg' || m === 'image/jpg';
    case 'png':  return m === 'image/png';
    case 'heic': return m === 'image/heic' || m === 'image/heif';
  }
}

function canonicalInfo(kind: ReceiptFileKind): ReceiptUploadInfo {
  switch (kind) {
    case 'pdf':  return { kind, contentType: 'application/pdf', ext: 'pdf' };
    case 'jpeg': return { kind, contentType: 'image/jpeg',      ext: 'jpg' };
    case 'png':  return { kind, contentType: 'image/png',       ext: 'png' };
    case 'heic': return { kind, contentType: 'image/heic',      ext: 'heic' };
  }
}

// ── Logo uploads ─────────────────────────────────────────────────────────────
// Tighter than receipts: 1 MB cap, raster only. No PDF (logos aren't documents)
// and no SVG (XML script injection surface area; revisit later if needed).

export type LogoFileKind = 'jpeg' | 'png' | 'webp';

export interface LogoUploadInfo {
  kind: LogoFileKind;
  contentType: string;
  ext: string;
}

const MAX_LOGO_BYTES = 1 * 1024 * 1024; // 1 MB per logo

export function validateLogoUpload(
  buffer: Buffer,
  declaredMime: string | undefined,
  originalFilename: string | undefined,
): LogoUploadInfo {
  if (buffer.length === 0) throw new Error('File is empty');
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new Error(`File too large: logos must be under ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB`);
  }
  const kind = detectLogoKind(buffer);
  if (!kind) {
    throw new Error('Unsupported file type: logos must be PNG, JPEG, or WebP');
  }
  if (declaredMime && !logoMimeMatchesKind(declaredMime, kind)) {
    throw new Error(`Declared Content-Type ${declaredMime} does not match detected file type ${kind}`);
  }
  void originalFilename;
  return canonicalLogoInfo(kind);
}

function detectLogoKind(buf: Buffer): LogoFileKind | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';
  // WebP: 'RIFF' .... 'WEBP' at byte 8..12
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) return 'webp';
  return null;
}

function logoMimeMatchesKind(mime: string, kind: LogoFileKind): boolean {
  const m = mime.toLowerCase();
  switch (kind) {
    case 'jpeg': return m === 'image/jpeg' || m === 'image/jpg';
    case 'png':  return m === 'image/png';
    case 'webp': return m === 'image/webp';
  }
}

function canonicalLogoInfo(kind: LogoFileKind): LogoUploadInfo {
  switch (kind) {
    case 'jpeg': return { kind, contentType: 'image/jpeg', ext: 'jpg' };
    case 'png':  return { kind, contentType: 'image/png',  ext: 'png' };
    case 'webp': return { kind, contentType: 'image/webp', ext: 'webp' };
  }
}
