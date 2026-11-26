import "server-only";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {del, get, put} from "@vercel/blob";
import sharp from "sharp";
import {isListId, ListError} from "./access";

export const MAX_PHOTO_INPUT = 4 * 1024 * 1024;
export const MAX_PHOTO_OUTPUT = 300_000;
export const PHOTO_CONTENT_TYPE = "image/webp";

const rasterFormats = new Set(["jpeg", "png", "webp", "gif", "heif", "tiff"]);

export async function processListPhoto(input: Buffer) {
  if (!input.length || input.length > MAX_PHOTO_INPUT) throw new ListError("invalid-photo");
  try {
    const image = sharp(input, {limitInputPixels: 50_000_000, failOn: "error"});
    const {format} = await image.metadata();
    if (!format || !rasterFormats.has(format)) throw new ListError("invalid-photo");
    for (const width of [1200, 900, 675, 500]) {
      const result = await image.clone().autoOrient().resize({
        width, height: width, fit: "inside", withoutEnlargement: true,
      }).webp({quality: 76}).toBuffer();
      if (result.length <= MAX_PHOTO_OUTPUT) return result;
    }
  } catch {
    throw new ListError("invalid-photo");
  }
  throw new ListError("invalid-photo");
}

type StoredPhoto = Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>;

export interface ListPhotoStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<StoredPhoto | null>;
  remove(key: string): Promise<void>;
}

export function localListPhotoStorage(root: string): ListPhotoStorage {
  return {
    async put(key, bytes) {
      const filename = photoPath(root, key);
      await mkdir(dirname(filename), {recursive: true, mode: 0o700});
      await writeFile(filename, bytes, {flag: "wx", mode: 0o600});
    },
    async get(key) {
      try {
        return Uint8Array.from(await readFile(photoPath(root, key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async remove(key) {
      await rm(photoPath(root, key), {force: true});
    },
  };
}

function photoPath(root: string, key: string) {
  const [prefix, familyId, file, extra] = key.split("/");
  if (prefix !== "wishlist" || !isListId(familyId ?? "") || !file?.endsWith(".webp") ||
    !isListId(file.slice(0, -5)) || extra !== undefined) {
    throw new ListError("not-found");
  }
  return join(root, prefix, familyId, file);
}

export function photoStorage(): ListPhotoStorage {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    return {
      async put(key, bytes) {
        await put(key, bytes, {access: "private", contentType: PHOTO_CONTENT_TYPE, token});
      },
      async get(key) {
        const result = await get(key, {access: "private", token});
        return result?.statusCode === 200 ? result.stream : null;
      },
      async remove(key) {
        await del(key, {token});
      },
    };
  }
  if (process.env.VERCEL || (process.env.NODE_ENV === "production" && !process.env.LIST_PHOTO_DIR)) {
    throw new ListError("storage-unavailable");
  }
  return localListPhotoStorage(process.env.LIST_PHOTO_DIR ?? join(tmpdir(), "family-gift-exchange-photos"));
}

export async function storeListPhoto(store: ListPhotoStorage, familyId: string, bytes: Buffer) {
  const key = `wishlist/${familyId}/${randomUUID()}.webp`;
  await store.put(key, bytes);
  return key;
}

export async function discardListPhoto(store: ListPhotoStorage, key: string) {
  try {
    await store.remove(key);
  } catch {
    console.warn("Could not remove a wishlist photo");
  }
}
