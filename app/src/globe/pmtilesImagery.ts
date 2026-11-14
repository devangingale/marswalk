// Written with AI assistance, directed and reviewed by the team.
import {
  Credit,
  Ellipsoid,
  ImageryProvider,
  Rectangle,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
} from 'cesium';
import { PMTiles, TileType } from 'pmtiles';

const MIME_TYPES: Partial<Record<TileType, string>> = {
  [TileType.Png]: 'image/png',
  [TileType.Jpeg]: 'image/jpeg',
  [TileType.Webp]: 'image/webp',
  [TileType.Avif]: 'image/avif',
};

export class PMTilesImageryProvider extends UrlTemplateImageryProvider {
  private readonly archive: PMTiles;
  private readonly mimeType: string;

  private constructor(
    archive: PMTiles,
    bounds: Rectangle,
    minimumLevel: number,
    maximumLevel: number,
    mimeType: string,
    credit: string | undefined,
  ) {
    super({
      url: '',
      tilingScheme: new WebMercatorTilingScheme({ ellipsoid: Ellipsoid.MARS }),
      rectangle: bounds,
      minimumLevel,
      maximumLevel,
      credit: credit ? new Credit(credit) : undefined,
    });
    this.archive = archive;
    this.mimeType = mimeType;
  }

  static async fromUrl(url: string, credit?: string): Promise<PMTilesImageryProvider> {
    const archive = new PMTiles(url);
    const header = await archive.getHeader();
    const bounds = Rectangle.fromDegrees(header.minLon, header.minLat, header.maxLon, header.maxLat);
    const mimeType = MIME_TYPES[header.tileType] ?? 'image/png';
    return new PMTilesImageryProvider(archive, bounds, header.minZoom, header.maxZoom, mimeType, credit);
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
    return createImageBitmap(new Blob([tile.data], { type: this.mimeType }), { imageOrientation: 'flipY' });
  }
}

export function createPMTilesImagery(url: string, credit?: string): Promise<ImageryProvider> {
  return PMTilesImageryProvider.fromUrl(url, credit);
}
