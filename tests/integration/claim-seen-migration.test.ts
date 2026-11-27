import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {expect, it} from "vitest";
import {diffSeen, seenOf, type SeenItem} from "../../src/server/lists/claims/changes";

it.each(["wishlist/existing-photo.webp", null])("backfills photo identity %s for existing claims", async (imageKey) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for migration tests");
  const pool = new Pool({connectionString: databaseUrl});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE items (
      family_id uuid, id uuid, title text, note text, url text, store text, price numeric(10, 2), image_key text
    ) ON COMMIT DROP`);
    await client.query("CREATE TEMP TABLE claims (family_id uuid, item_id uuid) ON COMMIT DROP");
    const familyId = randomUUID(), itemId = randomUUID();
    const item: SeenItem = {title: "Slippers", note: "Large", url: null, store: null, price: "18.00", imageKey};
    await client.query(`INSERT INTO items (family_id, id, title, note, url, store, price, image_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [familyId, itemId, item.title, item.note, item.url, item.store, item.price, imageKey]);
    await client.query("INSERT INTO claims (family_id, item_id) VALUES ($1, $2)", [familyId, itemId]);

    const migration = await readFile(new URL("../../drizzle/0018_claim-seen.sql", import.meta.url), "utf8");
    await client.query(migration);
    const {rows: [claim]} = await client.query<{seen: SeenItem}>("SELECT seen FROM claims");
    expect(claim.seen).toEqual(seenOf(item));
    expect(diffSeen(claim.seen, item)).toEqual([]);
    expect(diffSeen(claim.seen, {...item, imageKey: "wishlist/new-photo.webp"})).toEqual([
      {field: "photo", hasPhoto: true},
    ]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
