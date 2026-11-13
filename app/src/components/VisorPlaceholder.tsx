// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import { SiteData } from '../types';

interface VisorPlaceholderProps {
  siteData: SiteData;
  onReturnToPlan: () => void;
}

export const VisorPlaceholder: React.FC<VisorPlaceholderProps> = ({
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
        backgroundColor: '#040711',
        color: '#f8fafc',
        padding: '32px 16px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Visor HUD reticle simulation */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          right: '20px',
          bottom: '20px',
          border: '1px solid rgba(56, 189, 248, 0.15)',
          borderRadius: '24px',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          maxWidth: '540px',
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: '8px',
          padding: '28px',
          boxShadow: '0 0 30px rgba(56, 189, 248, 0.1)',
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'inline-block',
            backgroundColor: '#064e3b',
            color: '#6ee7b7',
            fontSize: '11px',
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '16px',
          }}
        >
          Phase 4 Helmet Visor HUD
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px', color: '#f8fafc' }}>
          Visor Mode · Helmet Telemetry &amp; Imagery
        </h2>

        <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '20px' }}>
          Simulated heads-up display (HUD) for extravehicular activity (EVA). Overlays compass
          heading, science target waypoints, remaining oxygen/battery budgets, and ground-level
          rover imagery matched to stop coordinates at {siteData.rover}.
        </p>

        <div
          style={{
            fontFamily: 'monospace',
            backgroundColor: '#0b1329',
            border: '1px solid #1e293b',
            borderRadius: '4px',
            padding: '12px',
            marginBottom: '20px',
            fontSize: '12px',
            color: '#38bdf8',
            textAlign: 'left',
          }}
        >
          <div>EVA STATUS: STANDBY (CONSOLE ROUTING)</div>
          <div>SUIT PRESSURE: 29.6 kPa (NOMINAL O₂)</div>
          <div>SURFACE DOSE: 0.21 mGy/day (SOLAR: QUIET)</div>
          <div>CAMERA FEED: NAVCAM / MASTCAM SYNCHRONIZED</div>
        </div>

        <button
          onClick={onReturnToPlan}
          style={{
            backgroundColor: '#0284c7',
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
