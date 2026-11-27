import {removeItem} from "../../../../actions";

export async function POST(request: Request, {params}: {params: Promise<{personId: string; itemId: string}>}) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({error: "forbidden"}, {status: 403});
  }
  const {personId, itemId} = await params;
  return Response.json(await removeItem(personId, itemId));
}
