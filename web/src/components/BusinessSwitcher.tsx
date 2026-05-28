import React, { useRef, useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';

/**
 * Compact business logo. Uses an `<img>` whose src points at the server endpoint
 * which 302s to a fresh signed URL — the browser follows automatically. Falls
 * back to nothing when the business has no logo.
 */
function BusinessLogoThumb({ orgId, businessId, hasLogo, size = 20 }: {
  orgId: string; businessId: number; hasLogo: boolean; size?: number;
}) {
  if (!hasLogo) return null;
  return (
    <img
      src={api.businesses.logoUrl(orgId, businessId)}
      alt=""
      style={{
        width: size,
        height: size,
        objectFit: 'cover',
        borderRadius: radii.sm,
        background: 'rgba(255,255,255,0.15)',
      }}
    />
  );
}

/**
 * BusinessSwitcher — shown in the nav bar when the user has more than one
 * business. Renders a compact dropdown listing all businesses across all
 * orgs. Selecting one calls `switchBusiness` on the AuthContext, which
 * updates the `x-business-id` header for subsequent API calls and triggers a
 * page refresh so data is re-fetched for the new business.
 */
export function BusinessSwitcher() {
  const { businesses, businessId, switchBusiness } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = businesses.find((b) => b.id === businessId);

  // Close the dropdown when the user clicks outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (businesses.length <= 1) return null;

  return (
    <div ref={ref} style={{ position: 'relative', marginLeft: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: radii.sm,
          color: colors.warmWhite,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          padding: '5px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {active && (
          <BusinessLogoThumb
            orgId={active.orgId}
            businessId={active.id}
            hasLogo={Boolean(active.logoStorageKey)}
          />
        )}
        <span>{active?.name ?? 'Select business'}</span>
        <span style={{ fontSize: 10, opacity: 0.75 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            background: colors.warmWhite,
            border: `1px solid ${colors.softLine}`,
            borderRadius: radii.md,
            boxShadow: shadows.raised,
            minWidth: 180,
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          {businesses.map((biz) => (
            <button
              key={biz.id}
              role="option"
              aria-selected={biz.id === businessId}
              type="button"
              onClick={() => {
                switchBusiness(biz.id);
                setOpen(false);
                // Reload to re-fetch all business-scoped data.
                window.location.reload();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                padding: '9px 14px',
                background: biz.id === businessId ? colors.cream : 'transparent',
                border: 'none',
                borderBottom: `1px solid ${colors.softLine}`,
                color: colors.darkSlate,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: biz.id === businessId ? 600 : 400,
              }}
            >
              <BusinessLogoThumb
                orgId={biz.orgId}
                businessId={biz.id}
                hasLogo={Boolean(biz.logoStorageKey)}
              />
              {biz.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
