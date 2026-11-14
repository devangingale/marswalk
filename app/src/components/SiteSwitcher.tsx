// Written with AI assistance, directed and reviewed by the team.

import React, { useState, useRef, useEffect } from 'react';

interface SiteSwitcherProps {
  availableSites: string[];
  currentSite: string;
  onSiteChange: (siteId: string) => void;
  siteTitle?: string;
  roverName?: string;
}

const SITE_NAMES: Record<string, { name: string; rover: string }> = {
  gale: { name: 'Mount Sharp, Gale', rover: 'Curiosity' },
  jezero: { name: 'Jezero delta', rover: 'Perseverance' },
};

export const SiteSwitcher: React.FC<SiteSwitcherProps> = ({
  availableSites,
  currentSite,
  onSiteChange,
  siteTitle,
  roverName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentInfo = SITE_NAMES[currentSite] || {
    name: siteTitle || currentSite.toUpperCase(),
    rover: roverName || '',
  };

  return (
    <div className="s48-site" ref={containerRef}>
      <button
        type="button"
        className="s48-site__btn"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{currentInfo.name}</span>
        {currentInfo.rover && <span className="rover">· {currentInfo.rover}</span>}
        <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {isOpen && (
        <ul className="s48-site__list" role="listbox" aria-label="Site">
          {availableSites.map((siteId) => {
            const isSelected = siteId === currentSite;
            const info = SITE_NAMES[siteId] || { name: siteId.toUpperCase(), rover: '' };

            return (
              <li
                key={siteId}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSiteChange(siteId);
                  setIsOpen(false);
                }}
              >
                {isSelected ? (
                  <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                ) : (
                  <span className="i blank" aria-hidden="true" />
                )}
                <span>{info.name}</span>
                {info.rover && <span className="rover">{info.rover}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
