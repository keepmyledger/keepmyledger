import { validateReceiptUpload, validateLogoUpload } from '../../../services/storage/uploadValidation';

const PDF_HEADER = Buffer.from('%PDF-1.4\n');
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_HEADER = Buffer.concat([Buffer.alloc(4, 0), Buffer.from('ftypheic'), Buffer.from('\x00\x00\x00\x00')]);
// WebP container: 'RIFF' + 4 size bytes + 'WEBP' + payload
const WEBP_HEADER = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 32]), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
// SVG: declares itself with an XML/SVG marker — should be rejected for logos.
const SVG_BUFFER = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('validateReceiptUpload', () => {
  it('accepts a PDF with matching mime', () => {
    const info = validateReceiptUpload(PDF_HEADER, 'application/pdf', 'r.pdf');
    expect(info).toEqual({ kind: 'pdf', contentType: 'application/pdf', ext: 'pdf' });
  });

  it('accepts JPEG / PNG / HEIC', () => {
    expect(validateReceiptUpload(JPEG_HEADER, 'image/jpeg', 'a.jpg').kind).toBe('jpeg');
    expect(validateReceiptUpload(PNG_HEADER, 'image/png', 'a.png').kind).toBe('png');
    expect(validateReceiptUpload(HEIC_HEADER, 'image/heic', 'a.heic').kind).toBe('heic');
  });

  it('rejects an unknown file', () => {
    expect(() => validateReceiptUpload(Buffer.from('random text'), 'text/plain', 'r.txt'))
      .toThrow(/Unsupported file type/);
  });

  it('rejects an empty buffer', () => {
    expect(() => validateReceiptUpload(Buffer.alloc(0), 'application/pdf', 'r.pdf'))
      .toThrow(/empty/i);
  });

  it('rejects a file larger than the receipt size limit', () => {
    const big = Buffer.concat([PDF_HEADER, Buffer.alloc(11 * 1024 * 1024)]);
    expect(() => validateReceiptUpload(big, 'application/pdf', 'r.pdf'))
      .toThrow(/too large/i);
  });

  it('rejects a renamed binary that lies about its mime', () => {
    // PDF bytes claimed as PNG
    expect(() => validateReceiptUpload(PDF_HEADER, 'image/png', 'r.png'))
      .toThrow(/does not match/i);
  });
});

describe('validateLogoUpload', () => {
  it('accepts PNG / JPEG / WebP', () => {
    expect(validateLogoUpload(PNG_HEADER, 'image/png', 'logo.png').kind).toBe('png');
    expect(validateLogoUpload(JPEG_HEADER, 'image/jpeg', 'logo.jpg').kind).toBe('jpeg');
    expect(validateLogoUpload(WEBP_HEADER, 'image/webp', 'logo.webp').kind).toBe('webp');
  });

  it('rejects PDF (logos must be raster images, not documents)', () => {
    expect(() => validateLogoUpload(PDF_HEADER, 'application/pdf', 'logo.pdf'))
      .toThrow(/Unsupported file type/);
  });

  it('rejects SVG (XML script-injection surface)', () => {
    expect(() => validateLogoUpload(SVG_BUFFER, 'image/svg+xml', 'logo.svg'))
      .toThrow(/Unsupported file type/);
  });

  it('rejects HEIC (not a sane choice for web display)', () => {
    expect(() => validateLogoUpload(HEIC_HEADER, 'image/heic', 'logo.heic'))
      .toThrow(/Unsupported file type/);
  });

  it('rejects files over the 1 MB logo cap', () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(1024 * 1024 + 1)]);
    expect(() => validateLogoUpload(big, 'image/png', 'logo.png'))
      .toThrow(/too large/i);
  });

  it('rejects a renamed binary that lies about its mime', () => {
    expect(() => validateLogoUpload(PNG_HEADER, 'image/jpeg', 'logo.jpg'))
      .toThrow(/does not match/i);
  });

  it('rejects an empty buffer', () => {
    expect(() => validateLogoUpload(Buffer.alloc(0), 'image/png', 'logo.png'))
      .toThrow(/empty/i);
  });
});
