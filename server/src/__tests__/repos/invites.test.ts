import { makeTestDb, TestDb } from '../helpers/db';

describe('InviteRepoImpl', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('create returns a pending invite with default member role', async () => {
    const invite = await h.owner.invites.create({ email: 'invited@example.com' });
    expect(invite.id).toBeDefined();
    expect(invite.email).toBe('invited@example.com');
    expect(invite.status).toBe('pending');
    expect(invite.role).toBe('member');
    expect(invite.orgId).toBe(h.ownerOrgId);
    expect(invite.invitedBy).toBe(h.ownerId);
  });

  it('create with explicit owner role stores that role', async () => {
    const invite = await h.owner.invites.create({ email: 'coo@example.com', role: 'owner' });
    expect(invite.role).toBe('owner');
  });

  it('create sets an expiry ~7 days in the future', async () => {
    const before = Date.now();
    const invite = await h.owner.invites.create({ email: 'ttl@example.com' });
    const diff = new Date(invite.expiresAt).getTime() - before;
    expect(diff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });

  it('findByToken returns the invite by its token', async () => {
    const invite = await h.owner.invites.create({ email: 'find@example.com' });
    const found = await h.owner.invites.findByToken(invite.id);
    expect(found).toMatchObject({ id: invite.id, email: 'find@example.com', status: 'pending' });
  });

  it('findByToken returns undefined for an unknown token', async () => {
    expect(await h.owner.invites.findByToken('no-such-token')).toBeUndefined();
  });

  it('listByOrg returns all invites for the org', async () => {
    await h.owner.invites.create({ email: 'a@example.com' });
    await h.owner.invites.create({ email: 'b@example.com' });
    const invites = await h.owner.invites.listByOrg();
    expect(invites.length).toBe(2);
    expect(invites.map((i) => i.email)).toEqual(
      expect.arrayContaining(['a@example.com', 'b@example.com']),
    );
  });

  it('accept changes the invite status to accepted', async () => {
    const invite = await h.owner.invites.create({ email: 'accept@example.com' });
    await h.owner.invites.accept(invite.id);
    const found = await h.owner.invites.findByToken(invite.id);
    expect(found?.status).toBe('accepted');
  });

  it('expire changes the invite status to expired', async () => {
    const invite = await h.owner.invites.create({ email: 'expire@example.com' });
    await h.owner.invites.expire(invite.id);
    const found = await h.owner.invites.findByToken(invite.id);
    expect(found?.status).toBe('expired');
  });

  it('delete removes the invite and returns true', async () => {
    const invite = await h.owner.invites.create({ email: 'del@example.com' });
    expect(await h.owner.invites.delete(invite.id)).toBe(true);
    expect(await h.owner.invites.findByToken(invite.id)).toBeUndefined();
  });

  it('delete returns false for an unknown token', async () => {
    expect(await h.owner.invites.delete('ghost-token')).toBe(false);
  });

  it('listByOrg does not return invites from another org', async () => {
    await h.owner.invites.create({ email: 'owner-only@example.com' });
    const altInvites = await h.alt.invites.listByOrg();
    expect(altInvites.length).toBe(0);
  });
});
