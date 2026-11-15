// Written with AI assistance, directed and reviewed by the team.

import React, { useMemo } from 'react';
import { SiteFeeds } from '../walk/feeds';
import { Waypoint } from '../walk/track';
import { CHEMISTRY_RADIUS_M, chemistryNear, compositionFields, PHOTO_RADIUS_M, photosNear } from '../walk/nearby';
import { formatDistance, waypointStatus } from '../walk/format';

interface StopDetailsProps {
  waypoint: Waypoint;
  arrived: boolean;
  feeds: SiteFeeds;
  solarEvent: boolean;
}

export function isSafePhotoUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('/');
}

export const StopDetails: React.FC<StopDetailsProps> = ({ waypoint, arrived, feeds, solarEvent }) => {
  const photos = useMemo(
    () => photosNear(feeds.photos, waypoint.lon, waypoint.lat),
    [feeds.photos, waypoint.lon, waypoint.lat]
  );
  const chemistry = useMemo(
    () => chemistryNear(feeds.chemistry, waypoint.lon, waypoint.lat),
    [feeds.chemistry, waypoint.lon, waypoint.lat]
  );
  const conditions = feeds.conditions;

  return (
    <article className="s48-stop" aria-labelledby="s48-stop-name">
      <header className="s48-stop-header">
        <p className={`s48-stop-status${arrived ? ' is-arrived' : ''}`}>{waypointStatus(waypoint.id, arrived)}</p>
        <h2 id="s48-stop-name" className="s48-stop-name">{waypoint.name}</h2>
        {waypoint.note && <p className="s48-stop-note">{waypoint.note}</p>}
      </header>

      {feeds.status === 'loading' && <p className="s48-stop-loading">Loading site data…</p>}
      {feeds.status === 'error' && (
        <p role="alert" className="s48-stop-error">
          Site data could not be loaded: {feeds.error}
        </p>
      )}

      {feeds.status === 'ready' && (
        <>
          <section className="s48-stop-photos" aria-label="Rover photos">
            <h3>Rover photos</h3>
            {!feeds.photosAvailable ? (
              <p className="s48-stop-no-photo">Rover photos are not available for this site.</p>
            ) : photos.length === 0 ? (
              <p className="s48-stop-no-photo">
                No rover photo near this stop (none within {formatDistance(PHOTO_RADIUS_M)}).
              </p>
            ) : (
              <ul className="s48-photo-list">
                {photos.map(({ photo }) => (
                  <li key={photo.id} className="s48-photo">
                    <figure>
                      {isSafePhotoUrl(photo.url) ? <a href={photo.url} target="_blank" rel="noreferrer">
                        <img
                          className="s48-photo-thumb"
                          src={photo.thumb}
                          alt={`${photo.camera}, sol ${photo.sol}`}
                          loading="lazy"
                        />
                      </a> : <img className="s48-photo-thumb" src={photo.thumb} alt={`${photo.camera}, sol ${photo.sol}`} loading="lazy" />}
                      <figcaption className="s48-photo-caption">
                        Sol {photo.sol} · {photo.camera} · {photo.credit}
                      </figcaption>
                    </figure>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="s48-stop-conditions" aria-label="Conditions">
            <h3>Conditions</h3>
            {conditions ? (
              <>
                <dl className="s48-conditions-list">
                  {conditions.weather ? (
                    <>
                      <dt>Air temperature</dt>
                      <dd>{conditions.weather.latest.air_temp_min_c} to {conditions.weather.latest.air_temp_max_c} °C</dd>
                      <dt>Pressure</dt>
                      <dd>{conditions.weather.latest.pressure_pa} Pa</dd>
                      <dt>Measured</dt>
                      <dd>Sol {conditions.weather.latest.sol} ({conditions.weather.latest.terrestrial_date})</dd>
                    </>
                  ) : (
                    <>
                      <dt>Weather</dt>
                      <dd>Weather data are not available for this site.</dd>
                    </>
                  )}
                  <dt>Radiation{solarEvent ? ' (solar event)' : ''}</dt>
                  <dd>
                    {(solarEvent
                      ? conditions.radiation.solar_event_mgy_per_day
                      : conditions.radiation.surface_dose_mgy_per_day
                    ).toFixed(3)}{' '}
                    mGy/day
                  </dd>
                </dl>
                <details className="s48-source"><summary>Sources</summary><span>{conditions.weather?.source} · {conditions.radiation.source}</span></details>
              </>
            ) : (
              <p className="s48-stop-no-conditions">No conditions file for this site.</p>
            )}
          </section>

          <section className="s48-stop-chemistry" aria-label="Chemistry">
            <h3>Chemistry</h3>
            {!feeds.chemistryAvailable ? (
              <p className="s48-stop-no-chemistry">Chemistry data are not available for this site.</p>
            ) : chemistry ? (
              <>
                <p>
                  {chemistry.measurements.length} APXS measurement
                  {chemistry.measurements.length === 1 ? '' : 's'} {formatDistance(chemistry.distanceM)} from
                  this stop, oxide weight %.
                </p>
                <div className="s48-chem-table-wrap">
                  <table className="s48-chem-table">
                    <thead>
                      <tr>
                        <th scope="col">Oxide</th>
                        {chemistry.measurements.map((m) => (
                          <th scope="col" key={m.target}>
                            <a href={m.source} target="_blank" rel="noreferrer" title={m.target}>
                              Sol {m.sol}
                            </a>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compositionFields(chemistry.measurements[0]).map(([field]) => (
                        <tr key={field}>
                          <th scope="row">{field}</th>
                          {chemistry.measurements.map((m) => {
                            const value = m[field];
                            return <td key={m.target}>{typeof value === 'number' ? value.toFixed(2) : ''}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="s48-stop-no-chemistry">
                No chemistry measurement within {formatDistance(CHEMISTRY_RADIUS_M)}.
              </p>
            )}
          </section>
        </>
      )}
    </article>
  );
};
