import { google } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import type { DbAdapter } from '../db/adapter';
import type { CreateReceiptFromDrivePayload } from '@keepmyledger/shared';
import { Readable } from 'stream';
import { encrypt, decrypt } from '../auth/crypto';

// drive.file = app may only see/manage files it created or the user explicitly
// opened with it. This is the least-privilege scope; no listing of unrelated
// Drive content. Sufficient for "upload a receipt to my own Drive".
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const REDIRECT_PATH = '/api/receipts/drive/callback';
const FOLDER_NAME = 'KeepMyLedger Receipts';

interface TokenRow {
  user_id: string;
  tokens_json_enc: string | null;
  folder_id: string | null;
}

/** Return the decrypted token JSON string from a DB row. */
function readTokens(row: TokenRow): string {
  if (row.tokens_json_enc != null) return decrypt(row.tokens_json_enc);
  throw new Error('[drive] token row has no token data');
}

/**
 * Per-user Google Drive integration. Each authenticated user connects their
 * own Drive; tokens and an auto-created "KeepMyLedger Receipts" folder id are
 * stored in `user_drive_tokens`. No global/shared state.
 */
export class DriveService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly configured: boolean;

  constructor(private db: DbAdapter) {
    this.clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
    this.clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
    this.redirectUri = `http://127.0.0.1:${process.env.PORT ?? 3001}${REDIRECT_PATH}`;
    this.configured = Boolean(this.clientId && this.clientSecret);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /** Has *this* user connected their Drive? */
  async isAuthenticated(userId: string): Promise<boolean> {
    if (!this.configured) return false;
    return Boolean(await this.loadRow(userId));
  }

  /** Build the OAuth consent URL for a user; `state` is the user's id. */
  getAuthUrl(userId: string): string {
    const client = this.newOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state: userId,
    });
  }

  /**
   * Exchange the OAuth code for tokens and persist them for `userId`. Caller
   * must verify that `userId` matches the session user.
   */
  async handleCallback(userId: string, code: string): Promise<void> {
    const client = this.newOAuthClient();
    const { tokens } = await client.getToken(code);
    const merged = await this.mergeTokens(userId, tokens);
    await this.saveTokens(userId, merged);
  }

  /**
   * Upload a buffer to the user's per-user receipts folder, creating the
   * folder lazily on first upload.
   */
  async uploadFile(
    userId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<CreateReceiptFromDrivePayload> {
    const client = await this.clientForUser(userId);
    const drive = google.drive({ version: 'v3', auth: client });

    const folderId = await this.ensureUserFolder(userId, client);

    const res = await drive.files.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requestBody: { name: filename, parents: [folderId] } as any,
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, name, mimeType, webViewLink, thumbnailLink',
    });

    const file = res.data;
    return {
      driveFileId: file.id!,
      driveFileName: file.name!,
      driveMimeType: file.mimeType ?? null,
      driveWebViewLink: file.webViewLink ?? null,
      driveThumbnailLink: file.thumbnailLink ?? null,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private newOAuthClient(): OAuth2Client {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }

  /** Build an OAuth2Client preloaded with the user's tokens. Persists token
   *  refreshes back to the DB automatically. */
  private async clientForUser(userId: string): Promise<OAuth2Client> {
    const row = await this.loadRow(userId);
    if (!row) throw new Error('Google Drive is not connected for this user');
    const client = this.newOAuthClient();
    client.setCredentials(JSON.parse(readTokens(row)) as Credentials);
    client.on('tokens', (newTokens) => {
      void this.mergeTokens(userId, newTokens)
        .then((merged) => this.saveTokens(userId, merged))
        .catch((err) => console.error('[drive] failed to persist refreshed token', err));
    });
    return client;
  }

  private async loadRow(userId: string): Promise<TokenRow | undefined> {
    return this.db.get<TokenRow>(
      'SELECT user_id, tokens_json_enc, folder_id FROM user_drive_tokens WHERE user_id = ?',
      [userId],
    );
  }

  private async mergeTokens(userId: string, fresh: Credentials): Promise<Credentials> {
    const existing = await this.loadRow(userId);
    const prior: Credentials = existing ? (JSON.parse(readTokens(existing)) as Credentials) : {};
    return {
      ...prior,
      ...fresh,
      // refresh_token is only sent on first consent, so keep the old one if absent.
      refresh_token: fresh.refresh_token ?? prior.refresh_token,
    };
  }

  private async saveTokens(userId: string, tokens: Credentials): Promise<void> {
    const tokensJsonEnc = encrypt(JSON.stringify(tokens));
    await this.db.run(
      `INSERT INTO user_drive_tokens(user_id, tokens_json_enc) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE
         SET tokens_json_enc = excluded.tokens_json_enc`,
      [userId, tokensJsonEnc],
    );
  }

  /** Return the cached folder id for this user, or create the folder. */
  private async ensureUserFolder(userId: string, client: OAuth2Client): Promise<string> {
    const row = await this.loadRow(userId);
    if (row?.folder_id) return row.folder_id;

    const drive = google.drive({ version: 'v3', auth: client });
    const res = await drive.files.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requestBody: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' } as any,
      fields: 'id',
    });
    const folderId = res.data.id!;
    await this.db.run(
      'UPDATE user_drive_tokens SET folder_id = ? WHERE user_id = ?',
      [folderId, userId],
    );
    return folderId;
  }
}
