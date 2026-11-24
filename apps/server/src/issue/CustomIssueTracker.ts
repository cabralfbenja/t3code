import * as Effect from "effect/Effect";
import * as Struct from "effect/Struct";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  IssueTrackerKind,
  IssueTrackerScope,
  IssueSummary,
  IssueDetail,
  IssueCommentsPage,
  IssueCreateResult,
} from "@t3tools/contracts";
import {
  IssueTrackerError,
  type StandaloneIssueTrackerApi,
} from "@t3tools/source-control-core/server/IssueTracker";
import * as IssueTrackerHost from "@t3tools/source-control-core/server/IssueTrackerHost";

const KIND = IssueTrackerKind.make("custom");
const Credential = Schema.Struct({
  name: Schema.NonEmptyString,
  baseUrl: Schema.String,
  token: Schema.NonEmptyString,
});
const decodeCredential = Schema.decodeEffect(Schema.fromJsonString(Credential));
const isTrackerError = Schema.is(IssueTrackerError);
const Summary = Schema.Struct(Struct.omit(IssueSummary.fields, ["tracker", "host", "scope"]));
const Detail = Schema.Struct(
  Struct.omit(IssueDetail.fields, [
    "tracker",
    "host",
    "scope",
    "projectId",
    "projectTitle",
    "writable",
    "capabilities",
    "reactions",
  ]),
);
const Page = Schema.Struct({
  items: Schema.Array(Summary),
  nextCursor: Schema.NullOr(Schema.String),
});
const Connection = Schema.Struct({
  account: Schema.NonEmptyString,
  scopes: Schema.Array(IssueTrackerScope),
});
const fail = (
  operation: string,
  reason: IssueTrackerError["reason"],
  detail: string,
  cause?: unknown,
) =>
  new IssueTrackerError({
    tracker: KIND,
    operation,
    reason,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

export const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const host = yield* IssueTrackerHost.IssueTrackerHost;
  const credential = Effect.fn("CustomIssueTracker.credential")(function* (value?: string) {
    const raw =
      value ??
      (yield* host.credentials
        .get(KIND)
        .pipe(
          Effect.flatMap(
            Effect.fromOption(() =>
              fail("credential", "unauthenticated", "Connect the custom tracker in Settings."),
            ),
          ),
        ));
    const config = yield* decodeCredential(raw).pipe(
      Effect.mapError((cause) =>
        fail("credential", "failed", "Enter a name, base URL and token.", cause),
      ),
    );
    const url = yield* Effect.try({
      try: () => new URL(config.baseUrl),
      catch: (cause) => fail("credential", "failed", "The base URL is invalid.", cause),
    });
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    ) {
      return yield* fail(
        "credential",
        "failed",
        "Use HTTPS, or HTTP on localhost, without credentials, query or fragment.",
      );
    }
    return { ...config, baseUrl: url.href.replace(/\/+$/, "") };
  });
  const request = Effect.fn("CustomIssueTracker.request")(function* <A, I>(
    operation: string,
    schema: Schema.Codec<A, I>,
    path: string,
    body?: unknown,
    supplied?: string,
  ) {
    const config = yield* credential(supplied);
    const base = HttpClientRequest.make(body === undefined ? "GET" : "POST")(
      `${config.baseUrl}${path}`,
    ).pipe(
      HttpClientRequest.bearerToken(config.token),
      HttpClientRequest.setHeader("accept", "application/json"),
    );
    return yield* Effect.gen(function* () {
      const response = yield* http.execute(
        body === undefined ? base : base.pipe(HttpClientRequest.bodyJsonUnsafe(body)),
      );
      if (response.status < 200 || response.status >= 300) {
        const reason =
          response.status === 401 || response.status === 403
            ? "unauthenticated"
            : response.status === 404
              ? "not-found"
              : response.status === 429
                ? "rate-limited"
                : "failed";
        return yield* fail(operation, reason, `Custom tracker returned HTTP ${response.status}.`);
      }
      return yield* Schema.decodeUnknownEffect(schema)(yield* response.json);
    }).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.timeout("30 seconds"),
      Effect.mapError((cause) =>
        isTrackerError(cause)
          ? cause
          : fail(
              operation,
              "failed",
              "The custom tracker request failed or returned an invalid response.",
              cause,
            ),
      ),
    );
  });
  const issuePath = (input: { scope: string; key: string }) =>
    `/scopes/${encodeURIComponent(input.scope)}/issues/${encodeURIComponent(input.key)}`;
  return {
    kind: KIND,
    standalone: {
      tracker: KIND,
      displayName: "Custom",
      host: "custom",
      scopeNoun: "project",
      credential: {
        label: "API token",
        helpUrl: null,
        fields: [
          { key: "name", label: "Name" },
          { key: "baseUrl", label: "Base URL" },
        ],
      },
    },
    capabilities: {
      create: true,
      comment: true,
      search: true,
      edit: false,
      labels: false,
      assignees: false,
      reactions: false,
      templates: false,
      linkedPullRequests: false,
      events: false,
    },
    getHost: credential().pipe(Effect.map((config) => new URL(config.baseUrl).host)),
    parseIssueUrl: () => null,
    probeCredential: Effect.fn("CustomIssueTracker.probeCredential")(function* (token: string) {
      const config = yield* credential(token);
      const connection = yield* request("connect", Connection, "/connection", undefined, token);
      return { ...connection, workspace: config.name };
    }),
    getViewer: () =>
      request("viewer", Connection, "/connection").pipe(Effect.map((value) => value.account)),
    listIssues: (input) => {
      const query = new URLSearchParams({
        state: input.state,
        involvement: input.involvement,
        sort: input.sort,
        limit: String(input.limit),
      });
      if (input.involvement !== "all") query.set("viewer", input.viewer);
      if (input.query) query.set("query", input.query);
      if (input.cursor) query.set("cursor", input.cursor);
      return request("list", Page, `/scopes/${encodeURIComponent(input.scope)}/issues?${query}`);
    },
    getIssue: (input) => request("read", Detail, issuePath(input)),
    getComments: (input) =>
      request(
        "comments",
        IssueCommentsPage,
        `${issuePath(input)}/comments?${new URLSearchParams({ cursor: input.cursor })}`,
      ),
    create: (input) =>
      request("create", IssueCreateResult, `/scopes/${encodeURIComponent(input.scope)}/issues`, {
        title: input.title,
        body: input.body,
      }),
    comment: (input) =>
      request("comment", Schema.Unknown, `${issuePath(input)}/comments`, { body: input.body }).pipe(
        Effect.asVoid,
      ),
    setState: Effect.fn("CustomIssueTracker.setState")(function* (input) {
      const issue = yield* request("read", Detail, issuePath(input));
      if (
        !issue.viewerPermissions.setState ||
        !issue.states.some((state) => state.name === input.state)
      )
        return yield* fail("setState", "failed", "This state change is not available.");
      yield* request("setState", Schema.Unknown, `${issuePath(input)}/state`, {
        state: input.state,
      });
    }),
  } satisfies StandaloneIssueTrackerApi;
});
