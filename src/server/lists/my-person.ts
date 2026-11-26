import "server-only";
import type {Viewer} from "../auth";

// TODO(phase 2): call the authorized, read-only assignment lookup once it lands on v2.
// This must not reveal an unopened assignment or mark it as seen when browsing lists.
export async function getListRecipient(viewer: Viewer, exchangeId: string | undefined): Promise<string | null> {
  void viewer;
  void exchangeId;
  return null;
}
