import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { IssueTrackerAccountId } from "@t3tools/contracts";
import * as Host from "@t3tools/source-control-core/server/IssueTrackerHost";
import * as Custom from "./CustomIssueTracker.ts";

const config = (baseUrl = "https://tracker.test/t3/v1") =>
  JSON.stringify({ name: "Internal", baseUrl, token: "test-token" });
const target = { cwd: "/repo", host: "tracker.test", scope: "ENG", key: "FT-1" };
const summary = {
  key: "FT-1",
  displayKey: "FT-1",
  title: "Fix build",
  url: "https://tracker.test/issues/FT-1",
  author: null,
  state: { name: "Todo", category: "open" },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  closedAt: null,
  assignees: [],
  labels: [],
  commentCount: 0,
};
const detail = {
  ...summary,
  body: "Description",
  viewer: "alice",
  viewerPermissions: {
    setState: true,
    comment: true,
    edit: false,
    labels: false,
    assignees: false,
  },
  states: [
    { name: "Todo", category: "open" },
    { name: "Done", category: "closed" },
  ],
  comments: [],
  commentsCursor: null,
  events: [],
  linkedPullRequests: [],
};

function fixture(answer: (request: HttpClientRequest) => Response, credential = config()) {
  const requests: HttpClientRequest[] = [];
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      expect(request.headers.authorization).toBe("Bearer test-token");
      expect(
        Option.getOrThrow(yield* Effect.serviceOption(FetchHttpClient.RequestInit)).redirect,
      ).toBe("manual");
      requests.push(request);
      return HttpClientResponse.fromWeb(request, answer(request));
    }),
  );
  const run = <A, E>(f: (api: Effect.Success<typeof Custom.make>) => Effect.Effect<A, E>) =>
    Custom.make.pipe(
      Effect.flatMap(f),
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.provideService(Host.IssueTrackerHost, {
        credentials: { get: () => Effect.succeedSome(credential) },
      }),
    );
  return { requests, run };
}
type HttpClientRequest = import("effect/http/HttpClientRequest").HttpClientRequest;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("custom tracker REST adapter", () => {
  it.effect("probes, searches, pages and writes using the configured API path", () =>
    Effect.gen(function* () {
      const { requests, run } = fixture((request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/connection"))
          return json({ account: "alice", scopes: [{ key: "ENG", name: "Engineering" }] });
        if (request.method === "POST")
          return json(
            url.pathname.endsWith("/issues")
              ? { key: "FT-1", displayKey: "FT-1", url: summary.url }
              : {},
          );
        if (url.pathname.endsWith("/comments")) return json({ comments: [], nextCursor: null });
        if (url.pathname.endsWith("/FT-1")) return json(detail);
        return json({ items: [summary], nextCursor: "next" });
      });
      yield* run((api) =>
        Effect.gen(function* () {
          expect(yield* api.probeCredential(config())).toEqual({
            account: "alice",
            workspace: "Internal",
            scopes: [{ key: "ENG", name: "Engineering" }],
          });
          expect(yield* api.getHost).toBe("tracker.test");
          const page = yield* api.listIssues({
            ...target,
            involvement: "assigned",
            viewer: "alice",
            state: "open",
            sort: "updated",
            limit: 20,
            query: "build & deploy",
            cursor: "opaque/+",
          });
          expect(page.items[0]?.key).toBe("FT-1");
          expect(page.nextCursor).toBe("next");
          expect(new URL(requests.at(-1)!.url).searchParams.get("query")).toBe("build & deploy");
          expect(new URL(requests.at(-1)!.url).searchParams.get("cursor")).toBe("opaque/+");
          expect(yield* api.getIssue(target)).toEqual(detail);
          expect(yield* api.getComments({ ...target, cursor: "next" })).toEqual({
            comments: [],
            nextCursor: null,
          });
          expect(
            (yield* api.create({
              ...target,
              title: "New",
              body: "body",
              labels: [],
              assignees: [],
            })).key,
          ).toBe("FT-1");
          yield* api.comment({ ...target, body: "hello" });
          const invalid = yield* api.setState({ ...target, state: "Missing" }).pipe(Effect.flip);
          expect(invalid.reason).toBe("failed");
          expect(requests.at(-1)?.method).toBe("GET");
          yield* api.setState({ ...target, state: "Done" });
          expect(requests.at(-1)?.url).toBe(
            "https://tracker.test/t3/v1/scopes/ENG/issues/FT-1/state",
          );
          expect(requests.at(-1)?.method).toBe("POST");
        }),
      );
    }),
  );
  it.effect("rejects invalid credentials and URLs before sending any token", () =>
    Effect.gen(function* () {
      const { run, requests } = fixture(() => json({}));
      for (const value of [
        "secret",
        config("http://remote.test"),
        config("https://user:password@tracker.test"),
        config("https://tracker.test?token=bad"),
        config("file:///tmp/file"),
      ]) {
        const error = yield* run((api) => api.probeCredential(value)).pipe(Effect.flip);
        expect(error.reason).toBe("failed");
      }
      expect(requests).toHaveLength(0);
    }),
  );
  it.effect("maps HTTP failures and rejects malformed responses without exposing bodies", () =>
    Effect.gen(function* () {
      for (const [status, reason] of [
        [401, "unauthenticated"],
        [403, "unauthenticated"],
        [404, "not-found"],
        [429, "rate-limited"],
        [302, "failed"],
        [500, "failed"],
        [200, "failed"],
      ] as const) {
        const { run } = fixture(() => json({ secret: "never expose this" }, status));
        const error = yield* run((api) => api.getIssue(target)).pipe(Effect.flip);
        expect(error.reason).toBe(reason);
        expect(error.message).not.toContain("never expose this");
      }
    }),
  );
  it.effect("uses the selected account's credentials for host resolution", () =>
    Effect.gen(function* () {
      const api = yield* Custom.make.pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("unexpected request")),
        ),
        Effect.provideService(Host.IssueTrackerHost, {
          credentials: {
            get: () =>
              Host.IssueTrackerAccount.pipe(
                Effect.map((id) =>
                  Option.some(config(id === null ? "https://first.test" : "https://second.test")),
                ),
              ),
          },
        }),
      );
      expect(
        yield* Host.asIssueTrackerAccount(api, IssueTrackerAccountId.make("second")).getHost!,
      ).toBe("second.test");
      expect(yield* api.getHost).toBe("first.test");
    }),
  );
});
