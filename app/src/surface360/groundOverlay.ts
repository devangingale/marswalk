// Written with AI assistance, directed and reviewed by the team.
// Flat shapes on the ground plane inside a panorama (the walk arrows and the cursor puck). They
// draw with depth testing off in the translucent pass, after the panorama sphere, so they always
// show over the photo and are picked first: the sphere's depth does not order reliably against
// geometry a few metres from the camera, which hid entity polygons behind it.
import {
  Color,
  ColorGeometryInstanceAttribute,
  Ellipsoid,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  type Scene,
} from 'cesium';

export interface GroundShape {
  hierarchy: PolygonHierarchy;
  colour: Color;
}

/** One primitive of flat shapes, drawn in the order given (later shapes on top). */
export class GroundOverlay {
  private primitive: Primitive | null = null;

  constructor(private readonly scene: Scene) {}

  /** Replaces the shapes. `id` is returned by scene.pick on any of them. */
  set(shapes: GroundShape[], id?: object): void {
    this.clear();
    if (!shapes.length) return;
    this.primitive = new Primitive({
      geometryInstances: shapes.map(
        (shape) =>
          new GeometryInstance({
            geometry: new PolygonGeometry({
              polygonHierarchy: shape.hierarchy,
              perPositionHeight: true,
              ellipsoid: Ellipsoid.MARS,
              vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
            }),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(shape.colour) },
            id,
          }),
      ),
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: { depthTest: { enabled: false }, depthMask: false, cull: { enabled: false } },
      }),
      asynchronous: false,
    });
    this.scene.primitives.add(this.primitive);
  }

  set show(on: boolean) {
    if (this.primitive) this.primitive.show = on;
  }

  owns(item: unknown): boolean {
    return item !== null && item === this.primitive;
  }

  clear(): void {
    if (this.primitive && this.scene.primitives.contains(this.primitive)) this.scene.primitives.remove(this.primitive);
    this.primitive = null;
  }
}
