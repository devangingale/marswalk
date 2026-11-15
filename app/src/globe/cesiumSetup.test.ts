// Written with AI assistance, directed and reviewed by the team.
import { afterEach, describe, expect, it } from 'vitest';
import { ClassificationType, Ellipsoid, RequestErrorEvent } from 'cesium';
import { cesiumFailure, cesiumFailureMessage, initCesium, surfaceClassification } from './cesiumSetup';

describe('initCesium', () => {
  afterEach(() => {
    Ellipsoid.default = Ellipsoid.WGS84;
  });

  it('returns offline without a token', () => {
    expect(initCesium(undefined)).toBe('offline');
    expect(Ellipsoid.default.radii.x).toBe(3396190);
  });

  it('returns offline for an empty token', () => {
    expect(initCesium('')).toBe('offline');
    expect(Ellipsoid.default.radii.x).toBe(3396190);
  });

  it('returns ion for a non-empty token', () => {
    expect(initCesium('abc')).toBe('ion');
    expect(Ellipsoid.default.radii.x).toBe(3396190);
  });
});

describe('surfaceClassification', () => {
  it('drapes on Cesium Mars online and on the globe and site mesh offline', () => {
    expect(surfaceClassification({} as never)).toBe(ClassificationType.CESIUM_3D_TILE);
    expect(surfaceClassification(null)).toBe(ClassificationType.BOTH);
  });
});

describe('initCesium with the chosen mode', () => {
  afterEach(() => {
    Ellipsoid.default = Ellipsoid.WGS84;
  });

  it('stays offline when offline is chosen, even with a token', () => {
    expect(initCesium('abc', false)).toBe('offline');
  });

  it('does not ask ion when the browser is offline', () => {
    expect(initCesium('abc', true, false)).toBe('offline');
  });
});

describe('cesiumFailure', () => {
  it('maps 401 to the invalid token message', () => {
    const failure = cesiumFailure(new RequestErrorEvent(401, '{"code":"INVALID_TOKEN","message":"Invalid access token"}'));
    expect(failure).toBe('invalid-token');
    expect(cesiumFailureMessage(failure)).toBe('Cesium Mars did not load (invalid token)');
  });

  it('maps an INVALID_TOKEN body to the invalid token message', () => {
    expect(cesiumFailure(new RequestErrorEvent(403, { code: 'INVALID_TOKEN' }))).toBe('invalid-token');
  });

  it('maps 403 Forbidden to a token without access', () => {
    const failure = cesiumFailure(new RequestErrorEvent(403, '{"code":"Forbidden","message":""}'));
    expect(failure).toBe('forbidden');
    expect(cesiumFailureMessage(failure)).toBe('Cesium Mars did not load (token not allowed here)');
  });

  it('maps a request without a status to no connection', () => {
    const failure = cesiumFailure(new RequestErrorEvent(undefined));
    expect(failure).toBe('no-connection');
    expect(cesiumFailureMessage(failure)).toBe('Cesium Mars did not load (no connection)');
    expect(cesiumFailure(new TypeError('Failed to fetch'))).toBe('no-connection');
  });

  it('maps a browser that reports offline to no connection whatever the error', () => {
    expect(cesiumFailure(new RequestErrorEvent(500), false)).toBe('no-connection');
  });

  it('maps other failures to server error', () => {
    const failure = cesiumFailure(new RequestErrorEvent(500, 'Internal Server Error'));
    expect(failure).toBe('server-error');
    expect(cesiumFailureMessage(failure)).toBe('Cesium Mars did not load (server error)');
    expect(cesiumFailure(new Error('tileset.json is not valid'))).toBe('server-error');
  });

  it('names a missing token', () => {
    expect(cesiumFailureMessage('no-token')).toBe('Cesium Mars did not load (no token)');
  });
});
