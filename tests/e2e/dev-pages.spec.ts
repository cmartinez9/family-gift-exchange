import {expect, test} from "@playwright/test";

test("keeps the development pages out of production builds", async ({request}) => {
  for (const path of ["/dev/messages", "/dev/design", "/dev/design/push"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
