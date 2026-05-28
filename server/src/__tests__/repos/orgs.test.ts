import { makeTestDb, TestDb } from '../helpers/db';

describe('OrgRepoImpl', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('listForUser returns the personal org', async () => {
    const orgs = await h.owner.org.listForUser();
    expect(orgs.length).toBeGreaterThanOrEqual(1);
    expect(orgs.some((o) => o.id === h.ownerOrgId)).toBe(true);
  });

  it('create makes a new org and returns it with the caller as owner', async () => {
    const org = await h.owner.org.create('Acme LLC');
    expect(org.id).toBeDefined();
    expect(org.name).toBe('Acme LLC');

    const orgs = await h.owner.org.listForUser();
    expect(orgs.some((o) => o.id === org.id)).toBe(true);
    expect(await h.owner.org.getRole(org.id)).toBe('owner');
  });

  it('findById returns undefined when caller is not a member', async () => {
    const org = await h.owner.org.create('Owner Only');
    expect(await h.alt.org.findById(org.id)).toBeUndefined();
  });

  it('getRole returns undefined for a non-member', async () => {
    const org = await h.owner.org.create('Secret');
    expect(await h.alt.org.getRole(org.id)).toBeUndefined();
  });

  it('listMembers returns all members of the org', async () => {
    const org = await h.owner.org.create('Team Org');
    await h.owner.org.addMember(org.id, h.altId, 'member');

    const members = await h.owner.org.listMembers(org.id);
    expect(members.length).toBe(2);
    const userIds = members.map((m) => m.userId);
    expect(userIds).toContain(h.ownerId);
    expect(userIds).toContain(h.altId);
  });

  it('addMember is idempotent', async () => {
    const org = await h.owner.org.create('Idempotent Org');
    await h.owner.org.addMember(org.id, h.altId, 'member');
    await expect(h.owner.org.addMember(org.id, h.altId, 'member')).resolves.not.toThrow();
    const members = await h.owner.org.listMembers(org.id);
    expect(members.filter((m) => m.userId === h.altId).length).toBe(1);
  });

  it('removeMember removes an existing member and returns true', async () => {
    const org = await h.owner.org.create('Mutable Org');
    await h.owner.org.addMember(org.id, h.altId, 'member');
    expect(await h.owner.org.removeMember(org.id, h.altId)).toBe(true);
    const members = await h.owner.org.listMembers(org.id);
    expect(members.some((m) => m.userId === h.altId)).toBe(false);
  });

  it('removeMember returns false when the user is not a member', async () => {
    const org = await h.owner.org.create('Sparse Org');
    expect(await h.owner.org.removeMember(org.id, h.altId)).toBe(false);
  });

  it('isolates orgs between users', async () => {
    const ownerOrg = await h.owner.org.create('Owner Private');
    const altOrg = await h.alt.org.create('Alt Private');

    const ownerOrgs = await h.owner.org.listForUser();
    expect(ownerOrgs.some((o) => o.id === ownerOrg.id)).toBe(true);
    expect(ownerOrgs.some((o) => o.id === altOrg.id)).toBe(false);

    const altOrgs = await h.alt.org.listForUser();
    expect(altOrgs.some((o) => o.id === altOrg.id)).toBe(true);
    expect(altOrgs.some((o) => o.id === ownerOrg.id)).toBe(false);
  });
});

describe('BusinessRepoImpl', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('findAll returns the personal business', async () => {
    const businesses = await h.owner.businesses.findAll();
    expect(businesses.length).toBeGreaterThanOrEqual(1);
    expect(businesses.some((b) => b.id === h.ownerBusinessId)).toBe(true);
  });

  it('create adds a business to the org', async () => {
    const biz = await h.owner.businesses.create('Side Hustle');
    expect(biz.id).toBeGreaterThan(0);
    expect(biz.name).toBe('Side Hustle');
    expect(biz.orgId).toBe(h.ownerOrgId);
    expect(await h.owner.businesses.findById(biz.id)).toMatchObject({ name: 'Side Hustle' });
  });

  it('rename updates the business name', async () => {
    const biz = await h.owner.businesses.create('Old Name');
    const updated = await h.owner.businesses.rename(biz.id, 'New Name');
    expect(updated?.name).toBe('New Name');
    expect((await h.owner.businesses.findById(biz.id))?.name).toBe('New Name');
  });

  it('rename returns undefined for an unknown id', async () => {
    expect(await h.owner.businesses.rename(99999, 'Ghost')).toBeUndefined();
  });

  it('delete removes the business and returns true', async () => {
    const biz = await h.owner.businesses.create('Temp');
    expect(await h.owner.businesses.delete(biz.id)).toBe(true);
    expect(await h.owner.businesses.findById(biz.id)).toBeUndefined();
  });

  it('delete returns false for an unknown id', async () => {
    expect(await h.owner.businesses.delete(99999)).toBe(false);
  });

  it('findById returns undefined when the business belongs to a different org', async () => {
    const ownerBiz = await h.owner.businesses.create('Owner Biz');
    expect(await h.alt.businesses.findById(ownerBiz.id)).toBeUndefined();
  });

  it('findAll does not return businesses from a different org', async () => {
    const ownerBiz = await h.owner.businesses.create('Owner Biz');
    const altBizs = await h.alt.businesses.findAll();
    expect(altBizs.some((b) => b.id === ownerBiz.id)).toBe(false);
  });
});
