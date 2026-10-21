import sharp from 'sharp';

// Some exported screenshots have uniform black bands above/below the desktop.
// Locate only full-width near-black rows; never trim panels or screenshot text.
export async function screenshotContentBounds(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('IMAGE_DIMENSIONS_UNREADABLE');
  const { data, info } = await sharp(buffer).resize({ width: 64, height: metadata.height, fit: 'fill' })
    .removeAlpha().grayscale().raw().toBuffer({ resolveWithObject: true });
  const black = (row: number) => data.subarray(row * info.width, (row + 1) * info.width).every((value) => value <= 8);
  let top = 0, bottom = metadata.height;
  while (top < metadata.height * .25 && black(top)) top++;
  while (bottom > metadata.height * .75 && black(bottom - 1)) bottom--;
  // A whole dark image or exceptionally large bands are not a desktop layout.
  if (top >= metadata.height * .25 || bottom <= metadata.height * .75 || bottom - top < 100) {
    top = 0; bottom = metadata.height;
  }
  return { left: 0, top, width: metadata.width, height: bottom - top };
}
