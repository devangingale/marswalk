// Written with AI assistance, directed and reviewed by the team.
import type { EntityCollection, ImageryLayerCollection, Scene, Viewer } from 'cesium';

/**
 * Render on demand. Cesium redraws by itself when the camera moves and when tiles, imagery or
 * models load; everything else our code changes (imagery opacity, entity styles, label
 * declutter, the dust shell, callback-driven marks) needs a request. Rather than a call at
 * every such line, any user input keeps the scene drawing for SETTLE_MS, which covers the
 * React effects it sets off; entity and imagery-layer collection changes request a frame; and
 * timer-driven changes call renderFor themselves.
 */
export const SETTLE_MS = 500;

const INPUT_EVENTS = ['pointerdown', 'pointerup', 'pointermove', 'click', 'input', 'change', 'keydown', 'keyup', 'wheel'] as const;

const renderUntil = new WeakMap<Scene, number>();

/** Requests a frame now and, with ms, keeps drawing every frame for that long. */
export function renderFor(scene: Scene | undefined | null, ms = 0): void {
  if (!scene || scene.isDestroyed()) return;
  scene.requestRender();
  if (ms > 0) renderUntil.set(scene, Math.max(renderUntil.get(scene) ?? 0, performance.now() + ms));
}

/**
 * Turns on request render mode for a viewer and installs the redraw triggers above. inputs is
 * where user input is heard (the document; a test passes its own target).
 */
export function installRenderOnDemand(viewer: Viewer, inputs: EventTarget = document): () => void {
  const scene = viewer.scene;
  scene.requestRenderMode = true;
  // Simulation time does not drive anything we draw (no time-dynamic entities, fixed lighting).
  scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
  const removers: (() => void)[] = [];
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    removers.splice(0).forEach((r) => r());
  };
  const request = () => {
    if (viewer.isDestroyed()) remove();
    else scene.requestRender();
  };

  removers.push(
    scene.postRender.addEventListener(() => {
      if ((renderUntil.get(scene) ?? 0) > performance.now()) scene.requestRender();
    }),
  );

  const kick = () => {
    if (viewer.isDestroyed()) remove();
    else renderFor(scene, SETTLE_MS);
  };
  for (const type of [...INPUT_EVENTS, 'resize']) {
    inputs.addEventListener(type, kick, { capture: true, passive: true });
    removers.push(() => inputs.removeEventListener(type, kick, { capture: true }));
  }

  // Entity property assignments surface as collectionChanged (with the changed entities).
  const watched = new Map<EntityCollection, () => void>();
  const watch = (entities: EntityCollection) => {
    if (!watched.has(entities)) watched.set(entities, entities.collectionChanged.addEventListener(request));
  };
  const unwatch = (entities: EntityCollection) => {
    watched.get(entities)?.();
    watched.delete(entities);
  };
  watch(viewer.entities);
  for (let i = 0; i < viewer.dataSources.length; i++) watch(viewer.dataSources.get(i).entities);
  removers.push(viewer.dataSources.dataSourceAdded.addEventListener((_c, source) => { watch(source.entities); request(); }));
  removers.push(viewer.dataSources.dataSourceRemoved.addEventListener((_c, source) => { unwatch(source.entities); request(); }));
  removers.push(() => [...watched.keys()].forEach(unwatch));

  removers.push(watchImagery(viewer, viewer.imageryLayers));

  scene.requestRender();
  return remove;
}

/** Requests a frame when layers are added, removed, reordered, shown or hidden. */
export function watchImagery(viewer: Viewer, layers: ImageryLayerCollection): () => void {
  const request = () => {
    if (!viewer.isDestroyed()) viewer.scene.requestRender();
  };
  const removers = [layers.layerAdded, layers.layerRemoved, layers.layerMoved, layers.layerShownOrHidden].map((event) =>
    event.addEventListener(request),
  );
  return () => removers.forEach((r) => r());
}
