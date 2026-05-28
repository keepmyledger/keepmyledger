import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, radii, shadows } from '../styles/tokens';
import type { OrgMember, OrgInvite, Business } from '@keepmyledger/shared';

const cardStyle: React.CSSProperties = {
  background: colors.warmWhite,
  border: `1px solid ${colors.surfaceLine}`,
  borderRadius: radii.md,
  padding: '24px 28px',
  boxShadow: shadows.card,
  marginBottom: 24,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: colors.darkSlate,
  marginBottom: 16,
  marginTop: 0,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: `1px solid ${colors.softLine}`,
  color: colors.mutedGray,
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: `1px solid ${colors.cream}`,
  color: colors.darkSlate,
};

const dangerButtonStyle: React.CSSProperties = {
  background: colors.dangerBg,
  color: colors.dangerFg,
  border: 'none',
  borderRadius: radii.sm,
  cursor: 'pointer',
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 500,
};

const primaryButtonStyle: React.CSSProperties = {
  background: colors.ledgerGreen,
  color: colors.warmWhite,
  border: 'none',
  borderRadius: radii.sm,
  cursor: 'pointer',
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
};

export function OrgSettingsPage() {
  const { orgId, user, businesses, refresh: refreshAuth } = useAuth();

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [bizList, setBizList] = useState<Business[]>(businesses);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'member'>('member');
  const [newBizName, setNewBizName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [m, i, b] = await Promise.all([
      api.orgs.listMembers(orgId).catch(() => [] as OrgMember[]),
      api.invites.list(orgId).catch(() => [] as OrgInvite[]),
      api.businesses.list(orgId).catch(() => [] as Business[]),
    ]);
    setMembers(m);
    setInvites(i);
    setBizList(b);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setError(null);
    setSuccess(null);
    try {
      await api.invites.create(orgId, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setSuccess('Invite sent!');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite');
    }
  };

  const handleExpireInvite = async (inviteId: string) => {
    if (!orgId) return;
    await api.invites.expire(orgId, inviteId).catch(() => {/* silent */});
    void load();
  };

  const handleRemoveMember = async (userId: string) => {
    if (!orgId) return;
    if (!confirm('Remove this member from the org?')) return;
    await api.orgs.removeMember(orgId, userId).catch(() => {/* silent */});
    void load();
  };

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setError(null);
    try {
      await api.businesses.create(orgId, newBizName.trim());
      setNewBizName('');
      void load();
      void refreshAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create business');
    }
  };

  const handleUploadLogo = async (businessId: number, file: File) => {
    if (!orgId) return;
    setError(null);
    try {
      await api.businesses.uploadLogo(orgId, businessId, file);
      void load();
      void refreshAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload logo');
    }
  };

  const handleClearLogo = async (businessId: number) => {
    if (!orgId) return;
    if (!confirm('Remove this business logo?')) return;
    await api.businesses.deleteLogo(orgId, businessId).catch(() => {/* silent */});
    void load();
    void refreshAuth();
  };

  const handleStartRename = (biz: Business) => {
    setRenamingId(biz.id);
    setRenameValue(biz.name);
    setError(null);
  };

  const handleCancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const handleSaveRename = async (id: number) => {
    if (!orgId) return;
    setError(null);
    try {
      await api.businesses.rename(orgId, id, renameValue.trim());
      setRenamingId(null);
      setRenameValue('');
      void load();
      void refreshAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename business');
    }
  };

  const handleDeleteBusiness = async (id: number) => {
    if (!orgId) return;
    if (!confirm('Delete this business and all its data? This cannot be undone.')) return;
    await api.businesses.delete(orgId, id).catch(() => {/* silent */});
    void load();
    void refreshAuth();
  };

  if (!orgId) {
    return <div style={{ padding: 48, color: colors.mutedGray }}>Loading org info…</div>;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.darkSlate, marginBottom: 24 }}>
        Org Settings
      </h1>

      {error && (
        <div style={{ background: colors.dangerBg, color: colors.dangerFg, padding: '10px 16px', borderRadius: radii.sm, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: colors.successBg, color: colors.successFg, padding: '10px 16px', borderRadius: radii.sm, marginBottom: 16, fontSize: 13 }}>
          {success}
        </div>
      )}

      {/* Members */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Members</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>User ID</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td style={tdStyle}>{m.userId}</td>
                <td style={tdStyle}>{m.role}</td>
                <td style={tdStyle}>
                  {m.userId !== user?.id && (
                    <button
                      style={dangerButtonStyle}
                      type="button"
                      onClick={() => handleRemoveMember(m.userId)}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invite */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Invite someone</h2>
        <form onSubmit={(e) => { void handleInvite(e); }} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: colors.mutedGray }}>Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              style={{ padding: '7px 10px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`, fontSize: 13, width: 220 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: colors.mutedGray }}>Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'owner' | 'member')}
              style={{ padding: '7px 10px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`, fontSize: 13 }}
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <button type="submit" style={primaryButtonStyle}>Send Invite</button>
        </form>

        {invites.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.mutedGray, marginBottom: 8 }}>Pending invites</h3>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {invites.filter((i) => i.status === 'pending').map((inv) => (
                  <tr key={inv.id}>
                    <td style={tdStyle}>{inv.email}</td>
                    <td style={tdStyle}>{inv.role}</td>
                    <td style={tdStyle}>{inv.status}</td>
                    <td style={tdStyle}>
                      <button
                        style={dangerButtonStyle}
                        type="button"
                        onClick={() => { void handleExpireInvite(inv.id); }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Businesses */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Businesses</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Logo</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {bizList.map((biz) => (
              <tr key={biz.id}>
                <td style={tdStyle}>
                  <BusinessLogoCell
                    orgId={orgId!}
                    business={biz}
                    onUpload={(f) => { void handleUploadLogo(biz.id, f); }}
                    onClear={() => { void handleClearLogo(biz.id); }}
                  />
                </td>
                <td style={tdStyle}>
                  {renamingId === biz.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void handleSaveRename(biz.id); }
                        if (e.key === 'Escape') { e.preventDefault(); handleCancelRename(); }
                      }}
                      maxLength={100}
                      style={{ padding: '6px 8px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`, fontSize: 13, width: 220 }}
                    />
                  ) : (
                    biz.name
                  )}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {renamingId === biz.id ? (
                      <>
                        <button
                          style={primaryButtonStyle}
                          type="button"
                          onClick={() => { void handleSaveRename(biz.id); }}
                        >
                          Save
                        </button>
                        <button
                          style={{ ...primaryButtonStyle, background: 'transparent', color: colors.mutedGray, border: `1px solid ${colors.softLine}` }}
                          type="button"
                          onClick={handleCancelRename}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        style={{ ...primaryButtonStyle, background: 'transparent', color: colors.darkSlate, border: `1px solid ${colors.softLine}`, padding: '4px 10px', fontSize: 12 }}
                        type="button"
                        onClick={() => handleStartRename(biz)}
                      >
                        Rename
                      </button>
                    )}
                    {bizList.length > 1 && renamingId !== biz.id && (
                      <button
                        style={dangerButtonStyle}
                        type="button"
                        onClick={() => { void handleDeleteBusiness(biz.id); }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form onSubmit={(e) => { void handleCreateBusiness(e); }} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: colors.mutedGray }}>New business name</label>
            <input
              required
              value={newBizName}
              onChange={(e) => setNewBizName(e.target.value)}
              placeholder="e.g. Consulting LLC"
              style={{ padding: '7px 10px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`, fontSize: 13, width: 200 }}
            />
          </div>
          <button type="submit" style={primaryButtonStyle}>Add Business</button>
        </form>
      </div>
    </div>
  );
}

function BusinessLogoCell({
  orgId, business, onUpload, onClear,
}: {
  orgId: string;
  business: Business;
  onUpload: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hasLogo = Boolean(business.logoStorageKey);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {hasLogo ? (
        <img
          src={api.businesses.logoUrl(orgId, business.id)}
          alt=""
          style={{
            width: 36,
            height: 36,
            objectFit: 'cover',
            borderRadius: radii.sm,
            border: `1px solid ${colors.softLine}`,
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: radii.sm,
            background: colors.cream,
            border: `1px dashed ${colors.softLine}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.mutedGray,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {business.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        style={{
          padding: '4px 8px',
          fontSize: 12,
          background: 'transparent',
          border: `1px solid ${colors.softLine}`,
          borderRadius: radii.sm,
          cursor: 'pointer',
        }}
        onClick={() => inputRef.current?.click()}
      >
        {hasLogo ? 'Replace' : 'Upload'}
      </button>
      {hasLogo && (
        <button
          type="button"
          style={{
            padding: '4px 8px',
            fontSize: 12,
            background: 'transparent',
            border: 'none',
            color: colors.mutedGray,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
          onClick={onClear}
        >
          Remove
        </button>
      )}
    </div>
  );
}
