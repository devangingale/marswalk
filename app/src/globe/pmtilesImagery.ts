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
import { isGreyscalePixels, tintGreyscalePixels } from './marsTint';

const MIME_TYPES: Partial<Record<TileType, string>> = {
  [TileType.Png]: 'image/png',
  [TileType.Jpeg]: 'image/jpeg',
  [TileType.Webp]: 'image/webp',
  [TileType.Avif]: 'image/avif',
};

export class PMTilesImageryProvider extends UrlTemplateImageryProvider {
  private readonly archive: PMTiles;
  private readonly mimeType: string;
  private readonly naturalTint: boolean;

  private constructor(
    archive: PMTiles,
    bounds: Rectangle,
    minimumLevel: number,
    maximumLevel: number,
    mimeType: string,
    credit: string | undefined,
    naturalTint: boolean,
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
    this.naturalTint = naturalTint;
  }

  static async fromUrl(url: string, credit?: string, naturalTint = false): Promise<PMTilesImageryProvider> {
    const archive = new PMTiles(url);
    const header = await archive.getHeader();
    const bounds = Rectangle.fromDegrees(header.minLon, header.minLat, header.maxLon, header.maxLat);
    const mimeType = MIME_TYPES[header.tileType] ?? 'image/png';
    return new PMTilesImageryProvider(archive, bounds, header.minZoom, header.maxZoom, mimeType, credit, naturalTint);
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
    const bitmap = await createImageBitmap(new Blob([tile.data], { type: this.mimeType }), { imageOrientation: 'flipY' });
    if (!this.naturalTint) return bitmap;

    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    const context = canvas.getContext('2d', { willReadFrequently: true }) as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) return bitmap;
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    if (!isGreyscalePixels(image.data, bitmap.width, bitmap.height)) return bitmap;
    tintGreyscalePixels(image.data);
    context.putImageData(image, 0, 0);
    return useOffscreen ? createImageBitmap(canvas as OffscreenCanvas) : canvas as HTMLCanvasElement;
  }
}

export function createPMTilesImagery(url: string, credit?: string, naturalTint = false): Promise<ImageryProvider> {
  return PMTilesImageryProvider.fromUrl(url, credit, naturalTint);
}
