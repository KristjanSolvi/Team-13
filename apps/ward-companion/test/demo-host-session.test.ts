import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeDemoHostAccessRequest,
  authorizeDemoHostMutation,
  createDemoHostSession,
  demoHostAccessKeyMatches,
  demoHostCookieHeader,
} from "../src/lib/demo-host-session";

const hostKey = "presenter-key-for-tests";
const signingSecret = "server-only-signing-secret-for-tests";
const origin = "https://ward.example";
const now = Date.parse("2026-08-21T09:00:00.000Z");

test("presenter access keys are verified without exposing the expected key", async () => {
  assert.equal(await demoHostAccessKeyMatches(hostKey, hostKey), true);
  assert.equal(await demoHostAccessKeyMatches("wrong-key", hostKey), false);
});

test("the presenter session endpoint requires the key on a same-origin request", async () => {
  const valid = new Request(`${origin}/follow-through-api/api/demo/host/session`, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "x-demo-host-key": hostKey,
    },
  });
  assert.equal(await authorizeDemoHostAccessRequest(valid, hostKey), null);
  const forged = new Request(valid, {
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "x-demo-host-key": "wrong",
    },
  });
  assert.equal((await authorizeDemoHostAccessRequest(forged, hostKey))?.status, 401);
});

test("a signed presenter session authorizes only a same-origin CSRF-bound mutation", async () => {
  const session = await createDemoHostSession(signingSecret, now);
  const headers = {
    cookie: demoHostCookieHeader(session.token, false),
    origin,
    "sec-fetch-site": "same-origin",
    "x-demo-csrf": session.csrfToken,
  };
  const request = new Request(`${origin}/follow-through-api/api/demo/tasks/task-1/route-now`, {
    method: "POST",
    headers,
  });
  assert.equal(await authorizeDemoHostMutation(request, signingSecret, now + 1_000), null);

  const missingCsrf = new Request(request, {
    headers: { ...headers, "x-demo-csrf": "wrong" },
  });
  assert.equal(
    (await authorizeDemoHostMutation(missingCsrf, signingSecret, now + 1_000))?.status,
    403,
  );

  const crossOrigin = new Request(request, {
    headers: { ...headers, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  });
  assert.equal(
    (await authorizeDemoHostMutation(crossOrigin, signingSecret, now + 1_000))?.status,
    403,
  );

  assert.equal(
    (await authorizeDemoHostMutation(request, signingSecret, session.expiresAt + 1))?.status,
    401,
  );
});
