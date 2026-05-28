import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import { findTemplateParser } from '../parsers';
import { isLlmConfigured } from '../llm/client';
import { extractPositionedText, groupByLine } from '../parsers/pdfPositional';
import { inspectCsv } from '../parsers/csv';
import { redactText } from '../parsers/redact';
import { UnknownFormatSampleRepoImpl } from '../repos/impl/UnknownFormatSampleRepoImpl';
import { DuplicateSampleError } from '../repos/UnknownFormatSampleRepo';
import { CsvColumnMapping } from '@keepmyledger/shared';
import type { DbAdapter } from '../db/adapter';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

// Per-type file size limits. Multer enforces the max; validateUpload enforces per-type.
const SIZE_LIMIT_PDF = 25 * 1024 * 1024;  // 25 MB
const SIZE_LIMIT_TEXT = 5 * 1024 * 1024;  // 5 MB (CSV / TSV / QIF)

// Tighter rate limit for upload endpoints — parsing is expensive.
// Authenticated requests only (requireUser runs before this router).
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, please try again later.' },
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = pickExt(file);
      const id = crypto.randomBytes(12).toString('hex');
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: SIZE_LIMIT_PDF }, // outer ceiling; per-type enforced in validateUpload
  fileFilter: (_req, file, cb) => {
    if (pickExt(file)) cb(null, true);
    else cb(new Error('Only PDF, CSV, QIF, and OFX/QFX files are accepted'));
  },
});

function pickExt(file: Express.Multer.File): '.pdf' | '.csv' | '.tsv' | '.qif' | '.ofx' | '.qfx' | '' {
  const name = file.originalname.toLowerCase();
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) return '.pdf';
  if (name.endsWith('.qif')) return '.qif';
  if (name.endsWith('.ofx')) return '.ofx';
  if (name.endsWith('.qfx')) return '.qfx';
  if (name.endsWith('.tsv')) return '.tsv';
  if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' || name.endsWith('.csv')) return '.csv';
  return '';
}

/**
 * Validate an already-written upload file.
 * Enforces per-type size limits and magic-byte checks so a renamed binary
 * can't slip through the mimetype/extension allowlist.
 * Throws with a user-facing message on failure.
 */
function validateUpload(filePath: string, ext: string): void {
  const stat = fs.statSync(filePath);
  const isPdf = ext === '.pdf';
  const sizeLimit = isPdf ? SIZE_LIMIT_PDF : SIZE_LIMIT_TEXT;
  if (stat.size > sizeLimit) {
    const mb = Math.round(sizeLimit / 1024 / 1024);
    throw new Error(`File too large: ${ext.slice(1).toUpperCase()} files must be under ${mb} MB`);
  }

  // Read enough bytes for magic-byte checks (256 covers OFX 1.x header lines).
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(256);
  const bytesRead = fs.readSync(fd, buf, 0, 256, 0);
  fs.closeSync(fd);
  const head = buf.slice(0, bytesRead);

  if (isPdf) {
    // PDF files must begin with %PDF-
    if (!head.slice(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('File does not appear to be a valid PDF (missing %PDF- header)');
    }
  } else if (ext === '.qif') {
    // QIF files must begin with !Type:
    if (!head.toString('ascii').startsWith('!Type:')) {
      throw new Error('File does not appear to be a valid QIF (missing !Type: header)');
    }
  } else if (ext === '.ofx' || ext === '.qfx') {
    // OFX 1.x: starts with "OFXHEADER:" header block; OFX 2.x: contains "<OFX>" tag.
    const headLower = head.toString('ascii').toLowerCase();
    if (!headLower.includes('ofxheader:') && !headLower.includes('<ofx')) {
      throw new Error('File does not appear to be a valid OFX (missing OFX header)');
    }
  } else {
    // CSV / TSV: must be valid text — reject if null bytes appear in the first 256 bytes.
    if (head.includes(0x00)) {
      throw new Error('File does not appear to be a valid CSV (binary content detected)');
    }
  }
}

function fileKindFromToken(token: string): 'pdf' | 'csv' | 'qif' | 'ofx' {
  if (token.endsWith('.pdf')) return 'pdf';
  if (token.endsWith('.qif')) return 'qif';
  if (token.endsWith('.ofx') || token.endsWith('.qfx')) return 'ofx';
  if (token.endsWith('.csv') || token.endsWith('.tsv')) return 'csv';
  throw new Error('Unknown file type');
}

/** Resolve a preview token to a real on-disk path, guarding against traversal. */
function resolveToken(token: unknown): string {
  if (typeof token !== 'string') throw new Error('Invalid preview token');
  // path.basename strips any directory components before the regex check — defence in depth
  // against path traversal and ensures CodeQL recognises the sanitisation.
  const safe = path.basename(token);
  if (!/^[a-f0-9]{24}\.(pdf|csv|tsv|qif|ofx|qfx)$/i.test(safe)) {
    throw new Error('Invalid preview token');
  }
  const full = path.join(UPLOAD_DIR, safe);
  const rel = path.relative(UPLOAD_DIR, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Invalid preview token');
  if (!fs.existsSync(full)) throw new Error('Preview expired or not found');
  return full;
}

/** Best-effort reaper: delete uploads older than 1 hour. */
function reapOldUploads(): void {
  try {
    const now = Date.now();
    const maxAgeMs = 60 * 60 * 1000;
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      const p = path.join(UPLOAD_DIR, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && now - st.mtimeMs > maxAgeMs) fs.unlinkSync(p);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export function importsRouter(db: DbAdapter): Router {
  const router = Router();
  // Run the reaper every 15 minutes, plus once at startup
  reapOldUploads();
  const reaperHandle = setInterval(reapOldUploads, 15 * 60 * 1000);
  if (typeof reaperHandle.unref === 'function') reaperHandle.unref();

  // ── Preview-then-commit flow ────────────────────────────────────────────

  /**
   * POST /api/imports/preview
   * multipart: file (required), accountId (optional, used to seed CSV mapping)
   * returns: { token, kind, parsed, sampleRows?, header?, delimiter?, hasHeader? }
   */
  router.post('/preview', uploadLimiter, upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const token = path.basename(req.file.path);
    // Derive a safe path from the basename so static analysis sees the traversal guard.
    const safeFilePath = path.join(UPLOAD_DIR, token);
    const ext = path.extname(token);
    try {
      validateUpload(safeFilePath, ext);
      const kind = fileKindFromToken(token);
      const accountId = req.body?.accountId ? Number(req.body.accountId) : null;
      const services = req.ctx!.services.imports;

      if (kind === 'pdf') {
        const parsed = await services.previewPdf(safeFilePath);
        return res.json({ token, kind, parsed, llmAvailable: isLlmConfigured() });
      }

      if (kind === 'qif') {
        let parsed = null;
        let parseError: string | null = null;
        try {
          parsed = await services.previewQif(safeFilePath);
        } catch (err) {
          parseError = err instanceof Error ? err.message : String(err);
        }
        return res.json({ token, kind, parsed, parseError });
      }

      if (kind === 'ofx') {
        let parsed = null;
        let parseError: string | null = null;
        try {
          parsed = await services.previewOfx(safeFilePath);
        } catch (err) {
          parseError = err instanceof Error ? err.message : String(err);
        }
        return res.json({ token, kind, parsed, parseError });
      }

      // CSV: inspect first so we can return raw rows + auto-detected mapping
      // for the column-mapping UI even when transactions fail to parse.
      const text = fs.readFileSync(safeFilePath, 'utf8');
      const inspect = inspectCsv(text);
      let mapping: CsvColumnMapping | null = inspect.detectedMapping;

      // If the account already has a remembered mapping, prefer it.
      if (accountId) {
        const acct = await req.ctx!.repos.accounts.findById(accountId);
        if (acct?.csvMapping) mapping = acct.csvMapping;
      }

      let parsed = null;
      let parseError: string | null = null;
      try {
        parsed = await services.previewCsv(safeFilePath, mapping ?? undefined);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }

      res.json({
        token,
        kind,
        parsed,
        parseError,
        csv: {
          delimiter: inspect.delimiter,
          hasHeader: inspect.hasHeader,
          header: inspect.header,
          detectedMapping: inspect.detectedMapping,
          appliedMapping: mapping,
          sampleRows: inspect.rows.slice(0, 10),
          totalRows: inspect.rows.length,
        },
      });
    } catch (err) {
      try { fs.unlinkSync(safeFilePath); } catch { /* ignore */ }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(422).json({ error: msg });
    }
  });

  /**
   * POST /api/imports/commit
   * json: { token, accountId, mapping?, rememberMapping? }
   * returns: ImportResult
   */
  router.post('/commit', async (req: Request, res: Response) => {
    const { token, accountId, mapping, rememberMapping } = req.body ?? {};
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });
    let filePath: string;
    try {
      filePath = resolveToken(token);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }

    try {
      const services = req.ctx!.services.imports;
      const kind = fileKindFromToken(token);
      let result;
      if (kind === 'csv') {
        result = await services.importCsv(Number(accountId), filePath, mapping ?? undefined);
      } else if (kind === 'qif') {
        result = await services.importQif(Number(accountId), filePath);
      } else if (kind === 'ofx') {
        result = await services.importOfx(Number(accountId), filePath);
      } else {
        result = await services.importPdf(Number(accountId), filePath);
      }

      if (kind === 'csv' && rememberMapping && mapping) {
        await req.ctx!.repos.accounts.update(Number(accountId), { csvMapping: mapping });
      }

      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(422).json({ error: msg });
    } finally {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  });

  /**
   * POST /api/imports/duplicates/resolve
   * body: { statementId, decisions: Array<{ externalHash, action: 'keep' | 'skip',
   *         date, description, amount }> }
   * Returns: { inserted, transactions }
   *
   * Called after the user reviews the cross-import duplicate list returned in
   * ImportResult.pendingReview. Rows with `action: 'keep'` are inserted; skips
   * are silently discarded.
   */
  router.post('/duplicates/resolve', async (req: Request, res: Response) => {
    const { statementId, decisions } = req.body ?? {};
    if (!Number.isInteger(statementId)) return res.status(400).json({ error: 'statementId must be an integer' });
    if (!Array.isArray(decisions)) return res.status(400).json({ error: 'decisions must be an array' });
    try {
      const result = await req.ctx!.services.imports.resolveDuplicates(
        Number(statementId),
        decisions as Parameters<NonNullable<typeof req.ctx>['services']['imports']['resolveDuplicates']>[1],
      );
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(422).json({ error: msg });
    }
  });

  /**
   * POST /api/imports/preview/:token/reparse
   * json: { mapping?: CsvColumnMapping | null }
   * Re-parses the already-uploaded CSV with a user-supplied mapping.
   */
  router.post('/preview/:token/reparse', async (req: Request, res: Response) => {
    let filePath: string;
    try {
      filePath = resolveToken(req.params.token);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    try {
      const kind = fileKindFromToken(req.params.token);
      if (kind !== 'csv') return res.status(400).json({ error: 'Reparse only supported for CSV' });
      const mapping: CsvColumnMapping | null = req.body?.mapping ?? null;
      const text = fs.readFileSync(filePath, 'utf8');
      const inspect = inspectCsv(text);
      let parsed = null;
      let parseError: string | null = null;
      try {
        parsed = await req.ctx!.services.imports.previewCsv(filePath, mapping ?? undefined);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }
      res.json({
        token: req.params.token,
        kind,
        parsed,
        parseError,
        csv: {
          delimiter: inspect.delimiter,
          hasHeader: inspect.hasHeader,
          header: inspect.header,
          detectedMapping: inspect.detectedMapping,
          appliedMapping: mapping ?? inspect.detectedMapping,
          sampleRows: inspect.rows.slice(0, 10),
          totalRows: inspect.rows.length,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(422).json({ error: msg });
    }
  });

  /**
   * POST /api/imports/preview/:token/enhance-llm
   * Re-parses the already-uploaded PDF using the LLM.
   * Only called after the user explicitly consents in the UI.
   */
  router.post('/preview/:token/enhance-llm', async (req: Request, res: Response) => {
    let filePath: string;
    try {
      filePath = resolveToken(req.params.token);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    const kind = fileKindFromToken(req.params.token);
    if (kind !== 'pdf') return res.status(400).json({ error: 'LLM enhancement only supported for PDF' });
    if (!isLlmConfigured()) return res.status(503).json({ error: 'LLM not configured on this server' });

    // Optional accountId in the body lets the parser pin the sign convention to
    // the account's kind (credit_card vs checking/savings).
    let accountKind;
    const rawAccountId = req.body?.accountId;
    if (rawAccountId !== undefined && rawAccountId !== null) {
      const id = Number(rawAccountId);
      if (Number.isInteger(id) && id > 0) {
        const account = await req.ctx!.repos.accounts.findById(id);
        if (account) accountKind = account.accountKind;
      }
    }

    try {
      const parsed = await req.ctx!.services.imports.previewPdfWithLlm(filePath, accountKind);
      res.json({ token: req.params.token, kind, parsed, llmAvailable: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(422).json({ error: msg });
    }
  });

  /** Abandon a preview without committing; frees the temp file. */
  router.delete('/preview/:token', (req: Request, res: Response) => {
    try {
      const filePath = resolveToken(req.params.token);
      fs.unlinkSync(filePath);
      res.status(204).end();
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Unknown-format sample reporting ───────────────────────────────────────

  /**
   * POST /api/imports/report-unknown
   * json: { token, bankHint?, accountId? }
   * Reads the already-uploaded PDF, redacts PII, and saves a sample row so
   * admins can use it to add parser support for new statement formats.
   *
   * Rate-limited via uploadLimiter; deduplicated by preview token so a single
   * preview can only generate one sample row.
   */
  router.post('/report-unknown', uploadLimiter, async (req: Request, res: Response) => {
    const { token, bankHint, accountId: bodyAccountId } = req.body ?? {};
    let filePath: string;
    try {
      filePath = resolveToken(token);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    const kind = fileKindFromToken(token as string);
    if (kind !== 'pdf') return res.status(400).json({ error: 'Only PDF samples can be reported' });

    // Validate that any supplied accountId belongs to the user's business.
    // Invalid IDs are silently dropped — the sample is still useful without one.
    let accountId: number | null = null;
    if (bodyAccountId !== undefined && bodyAccountId !== null) {
      const candidate = Number(bodyAccountId);
      if (Number.isInteger(candidate) && candidate > 0) {
        const acct = await req.ctx!.repos.accounts.findById(candidate);
        if (acct) accountId = candidate;
      }
    }

    // Cap the bank hint at 100 chars to keep the admin queue tidy.
    const hint = typeof bankHint === 'string' && bankHint.trim()
      ? bankHint.trim().slice(0, 100)
      : null;

    try {
      const buffer = fs.readFileSync(filePath);
      const stat = fs.statSync(filePath);
      let text = '';
      let pageCount: number | null = null;
      try {
        const pdfData = await pdfParse(buffer);
        text = pdfData.text;
        pageCount = pdfData.numpages;
      } catch {
        // Even if parse fails, still record the sample with empty text
      }

      const repo = new UnknownFormatSampleRepoImpl(db);
      const sample = await repo.create({
        orgId: req.ctx!.orgId,
        accountId,
        redactedText: redactText(text),
        bankHint: hint,
        pageCount,
        fileSizeKb: Math.ceil(stat.size / 1024),
        previewToken: token as string,
      });

      res.status(201).json({ id: sample.id });
    } catch (err) {
      if (err instanceof DuplicateSampleError) {
        return res.status(409).json({ error: 'A sample has already been submitted for this preview.' });
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Debug helpers (unchanged behaviour, moved under /debug) ─────────────

  /** Debug: extract raw PDF text and show which parser would be used */
  router.post('/debug/text', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
    try {
      const buffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(buffer);
      const text = pdfData.text;
      const parser = findTemplateParser(text);
      res.json({
        parserDetected: parser?.name ?? 'none (would use LLM fallback)',
        pages: pdfData.numpages,
        textLength: text.length,
        textSample: text.slice(0, 3000),
      });
    } finally {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
  });

  /** Debug: dump positional text (x/y coords) for column-based parser calibration */
  router.post('/positional', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
    try {
      const buffer = fs.readFileSync(req.file.path);
      const items = await extractPositionedText(buffer);
      const lines = groupByLine(items);
      res.json({
        totalItems: items.length,
        lineCount: lines.length,
        lines: lines.map((l) => ({
          page: l.page,
          y: Math.round(l.y * 10) / 10,
          items: l.items.map((i) => ({
            x: Math.round(i.x * 10) / 10,
            text: i.text,
          })),
        })),
      });
    } finally {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
  });

  // ── One-shot import (back-compat) ──────────────────────────────────────

  router.post('/', uploadLimiter, upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const accountId = Number(req.body?.accountId);
    const safeFilePath = path.join(UPLOAD_DIR, path.basename(req.file.path));

    if (!accountId) {
      try { fs.unlinkSync(safeFilePath); } catch { /* ignore */ }
      return res.status(400).json({ error: 'accountId is required' });
    }

    try {
      validateUpload(safeFilePath, path.extname(safeFilePath));
      const kind = fileKindFromToken(path.basename(safeFilePath));
      let result;
      if (kind === 'csv') {
        result = await req.ctx!.services.imports.importCsv(accountId, safeFilePath);
      } else if (kind === 'qif') {
        result = await req.ctx!.services.imports.importQif(accountId, safeFilePath);
      } else if (kind === 'ofx') {
        result = await req.ctx!.services.imports.importOfx(accountId, safeFilePath);
      } else {
        result = await req.ctx!.services.imports.importPdf(accountId, safeFilePath);
      }
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(422).json({ error: msg });
    } finally {
      try { fs.unlinkSync(safeFilePath); } catch { /* ignore */ }
    }
  });

  return router;
}
