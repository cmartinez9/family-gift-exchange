import {randomUUID} from "node:crypto";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import {expect, it, vi} from "vitest";
import {
  localListPhotoStorage, MAX_PHOTO_OUTPUT, processListPhoto, storeListPhoto,
} from "../../src/server/lists/photo-storage";

vi.mock("server-only", () => ({}));

it("rotates and re-encodes a photo without EXIF GPS or other metadata before storage", async () => {
  const original = await sharp({create: {width: 1600, height: 1200, channels: 3, background: "#8669ac"}})
    .withMetadata({orientation: 6})
    .withExifMerge({IFD3: {GPSLatitudeRef: "N", GPSLatitude: "1/1 2/1 3/1",
      GPSLongitudeRef: "E", GPSLongitude: "4/1 5/1 6/1"}})
    .jpeg().toBuffer();
  const originalMetadata = await sharp(original).metadata();
  expect(originalMetadata.exif?.includes(Buffer.from("Exif"))).toBe(true);
  const tiff = originalMetadata.exif!.subarray(6);
  const littleEndian = tiff[0] === 0x49;
  const readShort = (offset: number) => littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const firstDirectory = littleEndian ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  const tags = Array.from({length: readShort(firstDirectory)}, (_, index) => readShort(firstDirectory + 2 + index * 12));
  expect(tags).toContain(0x8825); // GPS info in the input fixture.
  const clean = await processListPhoto(original);
  const metadata = await sharp(clean).metadata();
  expect(metadata).toMatchObject({format: "webp", width: 900, height: 1200, hasProfile: false});
  expect(metadata.exif).toBeUndefined();
  expect(metadata.xmp).toBeUndefined();
  expect(clean.length).toBeLessThanOrEqual(MAX_PHOTO_OUTPUT);

  const directory = await mkdtemp(join(tmpdir(), "fge-photos-test-"));
  try {
    const storage = localListPhotoStorage(directory);
    const key = await storeListPhoto(storage, randomUUID(), clean);
    expect(await storage.get(key)).toEqual(Uint8Array.from(clean));
    await storage.remove(key);
    expect(await storage.get(key)).toBeNull();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

it("refuses documents and SVG instead of storing active content", async () => {
  await expect(processListPhoto(Buffer.from("This is not an image"))).rejects.toMatchObject({code: "invalid-photo"});
  await expect(processListPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')))
    .rejects.toMatchObject({code: "invalid-photo"});
});
