import sharp from 'sharp';
import { screenshotContentBounds } from './ocr-geometry';

describe('coordinate del desktop', () => {
  it('rimuove solo bande nere orizzontali complete', async () => {
    const image = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#222222' } })
      .extend({ top: 50, bottom: 50, background: '#000000' }).png().toBuffer();
    expect(await screenshotContentBounds(image)).toEqual({ left: 0, top: 50, width: 800, height: 400 });
    const dark = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#000000' } }).png().toBuffer();
    expect(await screenshotContentBounds(dark)).toEqual({ left: 0, top: 0, width: 800, height: 400 });
  });
});
