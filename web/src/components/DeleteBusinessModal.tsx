import React, { useEffect, useState } from 'react';
import type { Business, BusinessSummary } from '@keepmyledger/shared';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';

interface Props {
  orgId: string;
  business: Business;
  onClose: () => void;
  /** Called after a successful delete; parent should refresh state. */
  onDeleted: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
};
const dialogStyle: React.CSSProperties = {
  background: colors.warmWhite, borderRadius: radii.lg, padding: 28, maxWidth: 480, width: '100%',
  boxShadow: shadows.modal, border: `1px solid ${colors.softLine}`,
};
const headingStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: colors.dangerFg, margin: '0 0 12px',
};
const bodyStyle: React.CSSProperties = {
  fontSize: 14, color: colors.darkSlate, lineHeight: 1.5, marginBottom: 16,
};
const warningBoxStyle: React.CSSProperties = {
  background: colors.dangerBg, color: colors.dangerFg, padding: '12px 16px',
  borderRadius: radii.sm, fontSize: 13, marginBottom: 16,
};
const countsListStyle: React.CSSProperties = {
  margin: '8px 0 0', paddingLeft: 18, fontSize: 13,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: radii.sm,
  border: `1px solid ${colors.softLine}`, fontSize: 14, marginTop: 6,
  boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 13, color: colors.mutedGray, display: 'block', marginBottom: 4,
};
const footerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20,
};
const cancelBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: radii.sm, border: `1px solid ${colors.surfaceLine}`,
  background: colors.warmWhite, cursor: 'pointer', fontSize: 14, color: colors.mutedGray,
};
const confirmBtnBase: React.CSSProperties = {
  padding: '8px 16px', borderRadius: radii.sm, border: `1px solid ${colors.dangerFg}`,
  background: colors.dangerFg, color: '#fff', fontSize: 14, fontWeight: 600,
};

/**
 * Type-to-confirm modal for permanently deleting a business and all of its
 * data. Fetches per-table counts on open so the user can see exactly what
 * they're about to lose, then requires the user to type the business name
 * verbatim before the Delete button activates.
 */
export function DeleteBusinessModal({ orgId, business, onClose, onDeleted }: Props) {
  const [summary, setSummary] = useState<BusinessSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.businesses.deletePreview(orgId, business.id)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load delete preview');
      });
    return () => { cancelled = true; };
  }, [orgId, business.id]);

  const matches = confirmText === business.name;
  const canDelete = matches && !deleting;

  const handleConfirm = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.businesses.delete(orgId, business.id, confirmText);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete business');
      setDeleting(false);
    }
  };

  const counts = summary?.counts;
  const totalRows = counts
    ? counts.accounts + counts.transactions + counts.receipts + counts.statements + counts.categories + counts.rules
    : 0;

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-business-heading"
      onClick={(e) => { if (e.target === e.currentTarget && !deleting) onClose(); }}
    >
      <div style={dialogStyle}>
        <h2 id="delete-business-heading" style={headingStyle}>
          Permanently delete &ldquo;{business.name}&rdquo;?
        </h2>

        <div style={bodyStyle}>
          This action is <strong>not reversible</strong>. All data tied to this business will be erased.
        </div>

        <div style={warningBoxStyle}>
          {loadError ? (
            <div>Could not load deletion preview: {loadError}</div>
          ) : !summary ? (
            <div>Loading data summary&hellip;</div>
          ) : totalRows === 0 ? (
            <div>This business has no data attached. It will be removed immediately.</div>
          ) : (
            <>
              <div>The following will be permanently deleted:</div>
              <ul style={countsListStyle}>
                {counts!.accounts     > 0 && <li>{counts!.accounts.toLocaleString()} account{counts!.accounts === 1 ? '' : 's'}</li>}
                {counts!.transactions > 0 && <li>{counts!.transactions.toLocaleString()} transaction{counts!.transactions === 1 ? '' : 's'}</li>}
                {counts!.receipts     > 0 && <li>{counts!.receipts.toLocaleString()} receipt{counts!.receipts === 1 ? '' : 's'} (stored S3 files will be deleted; Google Drive files will not)</li>}
                {counts!.statements   > 0 && <li>{counts!.statements.toLocaleString()} statement{counts!.statements === 1 ? '' : 's'}</li>}
                {counts!.categories   > 0 && <li>{counts!.categories.toLocaleString()} categor{counts!.categories === 1 ? 'y' : 'ies'}</li>}
                {counts!.rules        > 0 && <li>{counts!.rules.toLocaleString()} rule{counts!.rules === 1 ? '' : 's'}</li>}
              </ul>
            </>
          )}
        </div>

        <label style={labelStyle} htmlFor="delete-business-confirm">
          Type <strong>{business.name}</strong> to confirm:
        </label>
        <input
          id="delete-business-confirm"
          autoFocus
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          style={inputStyle}
          autoComplete="off"
          spellCheck={false}
          disabled={deleting}
        />

        {deleteError && (
          <div style={{ ...warningBoxStyle, marginTop: 12, marginBottom: 0 }}>{deleteError}</div>
        )}

        <div style={footerStyle}>
          <button type="button" style={cancelBtn} onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...confirmBtnBase, opacity: canDelete ? 1 : 0.5, cursor: canDelete ? 'pointer' : 'not-allowed' }}
            onClick={() => { void handleConfirm(); }}
            disabled={!canDelete}
          >
            {deleting ? 'Deleting…' : 'Delete business'}
          </button>
        </div>
      </div>
    </div>
  );
}
