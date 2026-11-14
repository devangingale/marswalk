// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import { VisorGlobe, type VisorViewProps } from '../globe/walk/VisorGlobe';
import { useSafetyModel } from '../safety/useSafetyModel';
import { SafetyCompact } from '../safety/SafetyCompact';

export const VisorView: React.FC<VisorViewProps> = (props) => {
  // The safety layer follows the playback, as in Walk.
  const safety = useSafetyModel({
    plan: props.plan,
    origin: props.siteData.origin,
    siteId: props.siteData.id,
    lat: props.siteData.origin.lat0,
    lonEast: props.siteData.origin.lon0,
    elapsedS: props.elapsedS,
  });
  return (
    <VisorGlobe {...props}>{safety && props.plan.stops.length > 0 && <SafetyCompact model={safety} surface="visor" />}</VisorGlobe>
  );
};

export default VisorView;
