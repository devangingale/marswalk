// Written with AI assistance, directed and reviewed by the team.
import { Credit, Ellipsoid, Rectangle, UrlTemplateImageryProvider, WebMercatorTilingScheme } from 'cesium';
import { PMTiles } from 'pmtiles';

export class PMTilesImageryProvider extends UrlTemplateImageryProvider {
  private readonly archive: PMTiles;

  private constructor(archive: PMTiles, bounds: Rectangle, minimumLevel: number, maximumLevel: number) {
    super({
      url: '',
      tilingScheme: new WebMercatorTilingScheme({ ellipsoid: Ellipsoid.MARS }),
      rectangle: bounds,
      minimumLevel,
      maximumLevel,
      credit: new Credit('Sample orbital image'),
    });
    this.archive = archive;
  }

  static async fromUrl(url: string): Promise<PMTilesImageryProvider> {
    const archive = new PMTiles(url);
    const header = await archive.getHeader();
    const bounds = Rectangle.fromDegrees(header.minLon, header.minLat, header.maxLon, header.maxLat);
    return new PMTilesImageryProvider(archive, bounds, header.minZoom, header.maxZoom);
  }

  override async requestImage(x: number, y: number, level: number): Promise<ImageBitmap | HTMLCanvasElement> {
    const tile = await this.archive.getZxy(level, x, y);
    if (!tile) {
      const empty = document.createElement('canvas');
      empty.width = this.tileWidth;
      empty.height = this.tileHeight;
      return empty;
    }
    // Cesium uploads imagery bitmaps without flipping, so they must arrive pre-flipped.
    return createImageBitmap(new Blob([tile.data], { type: 'image/jpeg' }), { imageOrientation: 'flipY' });
  }
}
