import {previewItemLink} from "../../actions";

const MAX_BODY = 8000;

/**
 * The list form's link preview, as a plain request rather than a Server Action: the client runs Server
 * Actions one at a time, so a slow store page would hold up Save behind it. The form cancels this request
 * when it saves, and the save reads the store page later instead (4.4).
 */
export async function POST(request: Request, {params}: {params: Promise<{personId: string}>}) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({error: "forbidden"}, {status: 403});
  }
  const body = await request.text();
  let link: unknown;
  try {
    link = body.length <= MAX_BODY ? (JSON.parse(body) as {link?: unknown}).link : undefined;
  } catch {
    link = undefined;
  }
  if (typeof link !== "string") return Response.json({error: "invalid-link"}, {status: 400});
  const {personId} = await params;
  return Response.json(await previewItemLink(personId, link));
}
