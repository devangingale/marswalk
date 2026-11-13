// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import { SiteData } from '../types';

interface WalkPlaceholderProps {
  siteData: SiteData;
  onReturnToPlan: () => void;
}

export const WalkPlaceholder: React.FC<WalkPlaceholderProps> = ({
  siteData,
  onReturnToPlan,
}) => {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#090d16',
        color: '#f8fafc',
        padding: '32px 16px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '540px',
          backgroundColor: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: '8px',
          padding: '28px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            backgroundColor: '#1e3a8a',
            color: '#93c5fd',
            fontSize: '11px',
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '16px',
          }}
        >
          Phase 4 Navigation Module
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
          Walk Mode · Tablet Traverse Navigation
        </h2>

        <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '20px' }}>
          Field navigation view for suited astronauts on Mars surface. Displays the planned
          A* route through Mount Sharp stops with real rover photos ({siteData.rover}),
          real-time telemetry, turn-back limits, and terrain gradient warnings.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            marginBottom: '24px',
            textAlign: 'left',
          }}
        >
          <div style={{ backgroundColor: '#131e33', padding: '10px', borderRadius: '4px', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase' }}>Target Site</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>{siteData.title}</div>
          </div>
          <div style={{ backgroundColor: '#131e33', padding: '10px', borderRadius: '4px', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase' }}>Surface Rover</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8' }}>{siteData.rover}</div>
          </div>
          <div style={{ backgroundColor: '#131e33', padding: '10px', borderRadius: '4px', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase' }}>Drop-off Origin</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#10b981', fontFamily: 'monospace' }}>
              {siteData.default_start.lon.toFixed(3)}°, {siteData.default_start.lat.toFixed(3)}°
            </div>
          </div>
        </div>

        <button
          onClick={onReturnToPlan}
          style={{
            backgroundColor: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '10px 20px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
          }}
        >
          Return to Plan Console
        </button>
      </div>
    </div>
  );
};
