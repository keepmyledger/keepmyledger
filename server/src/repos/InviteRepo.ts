export type InviteStatus = 'pending' | 'accepted' | 'expired';

/** A pending (or resolved) invitation to join an org. */
export interface OrgInvite {
  id: string;            // UUID token, doubles as the accept link token
  orgId: string;
  invitedBy: string;     // user_id of the sender
  email: string;
  role: 'owner' | 'member';
  status: InviteStatus;
  expiresAt: string;     // ISO datetime (UTC)
  createdAt: string;
}

/**
 * InviteRepo is scoped to a single org. The `invitedBy` user id is captured
 * at construction time for `create`.
 */
export interface InviteRepo {
  /**
   * Look up an invite by its token (id). Returns undefined if the token is
   * not found. Does NOT require the caller to be a member of the org — this
   * is used on the public accept-invite page.
   */
  findByToken(token: string): Promise<OrgInvite | undefined>;

  /** List all invites for this org (any status). */
  listByOrg(): Promise<OrgInvite[]>;

  /**
   * Create a new pending invite for the given email address.
   * Role defaults to 'member'. Expires in 7 days by default.
   */
  create(data: Pick<OrgInvite, 'email'> & { role?: OrgInvite['role'] }): Promise<OrgInvite>;

  /**
   * Mark an invite as accepted. Does NOT add the user to the org — callers
   * must call OrgRepo.addMember separately.
   */
  accept(token: string): Promise<void>;

  /** Mark an invite as expired (revoked by an owner). */
  expire(token: string): Promise<void>;

  /** Delete an invite row. Returns false if not found. */
  delete(token: string): Promise<boolean>;
}
