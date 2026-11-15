// Written with AI assistance, directed and reviewed by the team.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataSourceCollection, EntityCollection, Event, ImageryLayerCollection } from 'cesium';
import { installRenderOnDemand, renderFor, SETTLE_MS } from './renderOnDemand';

const inputs = new EventTarget();

function fakeViewer() {
  const postRender = new Event();
  const scene = {
    requestRenderMode: false,
    maximumRenderTimeChange: 0,
    requestRender: vi.fn(),
    isDestroyed: () => false,
    postRender,
  };
  let destroyed = false;
  const viewer = {
    scene,
    entities: new EntityCollection(),
    dataSources: new DataSourceCollection(),
    imageryLayers: new ImageryLayerCollection(),
    isDestroyed: () => destroyed,
  };
  return { viewer, scene, destroy: () => { destroyed = true; } };
}

describe('installRenderOnDemand', () => {
  afterEach(() => vi.useRealTimers());

  it('turns on request render mode with no time-driven frames', () => {
    const { viewer, scene } = fakeViewer();
    const remove = installRenderOnDemand(viewer as never, inputs);
    expect(scene.requestRenderMode).toBe(true);
    expect(scene.maximumRenderTimeChange).toBe(Number.POSITIVE_INFINITY);
    remove();
  });

  it('requests a frame when an entity is added or changed', () => {
    const { viewer, scene } = fakeViewer();
    const remove = installRenderOnDemand(viewer as never, inputs);
    scene.requestRender.mockClear();
    const entity = viewer.entities.add({ name: 'a' });
    expect(scene.requestRender).toHaveBeenCalled();
    scene.requestRender.mockClear();
    entity.name = 'b';
    expect(scene.requestRender).toHaveBeenCalled();
    remove();
  });

  it('requests a frame when an imagery layer is shown or hidden', () => {
    const { viewer, scene } = fakeViewer();
    const remove = installRenderOnDemand(viewer as never, inputs);
    scene.requestRender.mockClear();
    viewer.imageryLayers.layerShownOrHidden.raiseEvent();
    expect(scene.requestRender).toHaveBeenCalledTimes(1);
    viewer.imageryLayers.layerAdded.raiseEvent();
    expect(scene.requestRender).toHaveBeenCalledTimes(2);
    remove();
  });

  it('keeps drawing for a while after user input, then stops', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { viewer, scene } = fakeViewer();
    const remove = installRenderOnDemand(viewer as never, inputs);
    inputs.dispatchEvent(new globalThis.Event('input'));
    scene.requestRender.mockClear();
    scene.postRender.raiseEvent();
    expect(scene.requestRender).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SETTLE_MS + 1);
    scene.requestRender.mockClear();
    scene.postRender.raiseEvent();
    expect(scene.requestRender).not.toHaveBeenCalled();
    remove();
  });

  it('stops listening once the viewer is destroyed', () => {
    const { viewer, scene, destroy } = fakeViewer();
    installRenderOnDemand(viewer as never, inputs);
    destroy();
    inputs.dispatchEvent(new globalThis.Event('click'));
    scene.requestRender.mockClear();
    inputs.dispatchEvent(new globalThis.Event('click'));
    expect(scene.requestRender).not.toHaveBeenCalled();
  });
});

describe('renderFor', () => {
  it('ignores a missing or destroyed scene', () => {
    expect(() => renderFor(null)).not.toThrow();
    const scene = { isDestroyed: () => true, requestRender: vi.fn() };
    renderFor(scene as never, 100);
    expect(scene.requestRender).not.toHaveBeenCalled();
  });
});
