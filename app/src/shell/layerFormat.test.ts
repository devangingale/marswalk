// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  formatResolution,
  getLayerDisplayName,
  getLayerSourceAgency,
  formatLegendValue,
  cleanUnits,
} from './layerFormat';

describe('formatResolution', () => {
  it('formats fractional resolutions for humans', () => {
    expect(formatResolution(0.24912640553924656)).toBe('0.25 m');
    expect(formatResolution(0.2371341596282012)).toBe('0.24 m');
    expect(formatResolution(0.05)).toBe('0.05 m');
  });

  it('formats meter-scale resolutions', () => {
    expect(formatResolution(1.0)).toBe('1 m');
    expect(formatResolution(1.5)).toBe('1.5 m');
    expect(formatResolution(6.0)).toBe('6 m');
  });

  it('formats coarse and regional resolutions', () => {
    expect(formatResolution(18.0)).toBe('18 m');
    expect(formatResolution(100.0)).toBe('100 m');
    expect(formatResolution(181.27)).toBe('181 m');
    expect(formatResolution(1000)).toBe('1 km');
    expect(formatResolution(2500)).toBe('2.5 km');
  });
});

describe('getLayerDisplayName', () => {
  it('shortens known technical and pipeline layer titles', () => {
    expect(
      getLayerDisplayName({
        id: 'bd1900_2',
        title: 'CRISM 1.9 µm hydration band depth (BD1900_2)',
      })
    ).toBe('Hydration (CRISM 1.9 µm)');

    expect(
      getLayerDisplayName({
        id: 'd2300',
        title: 'CRISM 2.3 µm Mg-OH index (D2300)',
      })
    ).toBe('Mg-OH clays (CRISM 2.3 µm)');

    expect(
      getLayerDisplayName({
        id: 'thermal',
        title: 'THEMIS thermal inertia',
      })
    ).toBe('Thermal inertia (THEMIS)');

    expect(
      getLayerDisplayName({
        id: 'walkability',
        title: 'Experimental walkability (rover-preference model)',
      })
    ).toBe('Walkability (experimental)');
  });

  it('falls back to title if unknown', () => {
    expect(
      getLayerDisplayName({
        id: 'custom_layer',
        title: 'Custom Feature Layer',
      })
    ).toBe('Custom Feature Layer');
  });
});

describe('getLayerSourceAgency', () => {
  it('maps known layers to short source and agency', () => {
    expect(
      getLayerSourceAgency({
        id: 'bd1900_2',
        source: 'CRISM MRDR summary parameter BD1900_2; 1.9 µm H2O absorption depth...',
        agency: 'NASA',
      })
    ).toBe('CRISM · NASA');

    expect(
      getLayerSourceAgency({
        id: 'image',
        source: 'MRO HiRISE colour mosaic',
        agency: 'NASA',
      })
    ).toBe('HiRISE · NASA');
  });
});

describe('formatLegendValue and cleanUnits', () => {
  it('formats legend values with correct precision and signs', () => {
    expect(formatLegendValue(0)).toBe('0');
    expect(formatLegendValue(10)).toBe('10');
    expect(formatLegendValue(260.492279)).toBe('260');
    expect(formatLegendValue(653.498779)).toBe('653');
    expect(formatLegendValue(-0.023184)).toBe('\u22120.02');
    expect(formatLegendValue(0.034782)).toBe('0.03');
  });

  it('cleans long or technical units', () => {
    expect(cleanUnits('degrees')).toBe('°');
    expect(cleanUnits('dimensionless band depth')).toBe('band depth');
    expect(
      cleanUnits('relative rover-preference score (0-1; not a safety probability)')
    ).toBe('score');
    expect(cleanUnits('J m^-2 K^-1 s^-1/2')).toBe('J m⁻² K⁻¹ s⁻¹/²');
  });
});
