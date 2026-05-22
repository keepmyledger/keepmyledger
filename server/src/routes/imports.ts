import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import { findTemplateParser } from '../parsers';
import { extractPositionedText, groupByLine } from '../parsers/pdfPositional';
import { inspectCsv } from '../parsers/csv';
import { CsvColumnMapping } from '@keepmyledger/shared';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = pickExt(file);
      const id = crypto.randomBytes(12).toString('hex');
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    if (pickExt(file)) cb(null, true);
    else cb(new Error('Only PDF, CSV, and QIF files are accepted'));
  },
});

function pickExt(file: Express.Multer.File): '.pdf' | '.csv' | '.tsv' | '.qif' | '' {
  const name = file.originalname.toLowerCase();
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) return '.pdf';
  if (name.endsWith('.qif')) return '.qif';
  if (name.endsWith('.tsv')) return '.tsv';
  if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' || name.endsWith('.csv')) return '.csv';
  return '';
}

function fileKindFromToken(token: string): 'pdf' | 'csv' | 'qif' {
  if (token.endsWith('.pdf')) return 'pdf';
  if (token.endsWith('.qif')) return 'qif';
  if (token.endsWith('.csv') || token.endsWith('.tsv')) return 'csv';
  throw new Error('Unknown file type');
}

/** Resolve a preview token to a real on-disk path, guarding against traversal. */
function resolveToken(token: unknown): string {
  if (typeof token !== 'string' || !/^[a-f0-9]{24}\.(pdf|csv|tsv|qif)$/i.test(token)) {
    throw new Error('Invalid preview token');
  }
  const full = path.join(UPLOAD_DIR, token);
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

export function importsRouter(): Router {
  const router = Router();
  // Run the reaper every 15 minutes, plus once at startup
  reapOldUploads();
  const reaperHandle = setInterval(reapOldUploads, 15 * 60 * 1000);
  if (typeof reaperHandle.unref === 'function') reaperHandle.unref();

  // ── Preview-then-commit flow ────────────────────────────────────────────

  /**
   * POST /api/imports/preview
   * multipart: file (required), accountId (optional — used to seed CSV mapping)
   * returns: { token, kind, parsed, sampleRows?, header?, delimiter?, hasHeader? }
   */
  router.post('/preview', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const token = path.basename(req.file.path);
    try {
      const kind = fileKindFromToken(token);
      const accountId = req.body?.accountId ? Number(req.body.accountId) : null;
      const services = req.ctx!.services.imports;

      if (kind === 'pdf') {
        const parsed = await services.previewPdf(req.file.path);
        return res.json({ token, kind, parsed });
      }

      if (kind === 'qif') {
        let parsed = null;
        let parseError: string | null = null;
        try {
          parsed = await services.previewQif(req.file.path);
        } catch (err) {
          parseError = err instanceof Error ? err.message : String(err);
        }
        return res.json({ token, kind, parsed, parseError });
      }

      // CSV: inspect first so we can return raw rows + auto-detected mapping
      // for the column-mapping UI even when transactions fail to parse.
      const text = fs.readFileSync(req.file.path, 'utf8');
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
        parsed = await services.previewCsv(req.file.path, mapping ?? undefined);
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
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
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

  /** Abandon a preview without committing — frees the temp file. */
  router.delete('/preview/:token', (req: Request, res: Response) => {
    try {
      const filePath = resolveToken(req.params.token);
      fs.unlinkSync(filePath);
      res.status(204).end();
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
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

  router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const accountId = Number(req.body?.accountId);
    if (!accountId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'accountId is required' });
    }

    try {
      const kind = fileKindFromToken(path.basename(req.file.path));
      let result;
      if (kind === 'csv') {
        result = await req.ctx!.services.imports.importCsv(accountId, req.file.path);
      } else if (kind === 'qif') {
        result = await req.ctx!.services.imports.importQif(accountId, req.file.path);
      } else {
        result = await req.ctx!.services.imports.importPdf(accountId, req.file.path);
      }
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(422).json({ error: msg });
    } finally {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
  });

  return router;
}
