/** A single organization (top-level tenant). */
export interface Org {
  id: string;
  name: string;
  createdAt: string;
}

/** A membership record linking a user to an org with a role. */
export interface OrgMember {
  userId: string;
  orgId: string;
  role: 'owner' | 'member';
  createdAt: string;
}

/**
 * OrgRepo is scoped to a single user: all read operations return only orgs
 * that user belongs to; write operations enforce the same boundary.
 */
export interface OrgRepo {
  /** List all orgs the calling user belongs to. */
  listForUser(): Promise<Org[]>;

  /**
   * Return a specific org if the calling user is a member, undefined otherwise.
   */
  findById(orgId: string): Promise<Org | undefined>;

  /**
   * Create a new org. The calling user becomes the owner automatically.
   * Returns the new org.
   */
  create(name: string): Promise<Org>;

  /**
   * Return the calling user's role in the given org, or undefined if they are
   * not a member.
   */
  getRole(orgId: string): Promise<'owner' | 'member' | undefined>;

  /** List all members of an org the calling user belongs to. */
  listMembers(orgId: string): Promise<OrgMember[]>;

  /**
   * Add a user to an org. Used when accepting an invite.
   * Idempotent: no-ops if the membership already exists.
   */
  addMember(orgId: string, userId: string, role: 'owner' | 'member'): Promise<void>;

  /**
   * Remove a user from an org. Returns false if the membership did not exist.
   * Callers must verify the requesting user is an owner before calling this.
   */
  removeMember(orgId: string, userId: string): Promise<boolean>;
}
