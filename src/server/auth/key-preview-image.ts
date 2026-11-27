import "server-only";
import sharp from "sharp";
import {previewSvg} from "./key-preview-svg";

/** The link preview picture as a PNG: every chat app shows PNG, few show SVG. */
export async function keyPreviewPng(name: string | null) {
  return sharp(Buffer.from(previewSvg(name))).png({compressionLevel: 9}).toBuffer();
}
