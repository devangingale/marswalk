// Written with AI assistance, directed and reviewed by the team.
// A panorama sphere with an opacity, for the crossfade between stops. Cesium's
// EquirectangularPanorama has no alpha, so this rebuilds the same sphere (same geometry, same
// Image material with the horizontally flipped repeat, so the same texture mapping) with the
// material's colour alpha exposed. It draws translucent and ignores depth, over the incoming panorama.
import {
  Cartesian2,
  Color,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Matrix4,
  Primitive,
  type Scene,
  SphereGeometry,
  VertexFormat,
} from 'cesium';

export class FadingPanorama {
  private readonly primitive: Primitive;
  private readonly material: Material;

  constructor(
    private readonly scene: Scene,
    image: HTMLImageElement,
    radius: number,
  ) {
    this.material = new Material({
      fabric: {
        type: 'Image',
        uniforms: { image, repeat: new Cartesian2(-1, 1), color: new Color(1, 1, 1, 1) },
      },
    });
    this.primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new SphereGeometry({ radius, vertexFormat: VertexFormat.POSITION_AND_ST }),
      }),
      appearance: new MaterialAppearance({
        material: this.material,
        flat: true,
        faceForward: false,
        translucent: true,
        closed: false,
        renderState: { cull: { enabled: false }, depthTest: { enabled: false }, depthMask: false },
      }),
      asynchronous: false,
    });
    scene.primitives.add(this.primitive);
  }

  /** Is this the primitive drawing the fade? (So scene housekeeping leaves it alone.) */
  owns(item: unknown): boolean {
    return item === this.primitive;
  }

  /** Where the sphere is and how it is oriented, as headingPitchRollToFixedFrame gives it. */
  set transform(m: Matrix4) {
    this.primitive.modelMatrix = Matrix4.clone(m, this.primitive.modelMatrix);
  }

  set alpha(a: number) {
    (this.material.uniforms.color as Color).alpha = Math.min(1, Math.max(0, a));
  }

  destroy(): void {
    if (this.scene.primitives.contains(this.primitive)) this.scene.primitives.remove(this.primitive);
  }
}
