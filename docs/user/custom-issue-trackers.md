# Custom issue trackers

Connect an internal tracker under **Settings → Source control & issues → Issue trackers → Custom**.
Enter a name, the base URL of its adapter API, and an API token. Then select the
tracker project each T3 Code project should use. **Add account** connects another
named tracker or account. Disconnecting removes its project bindings.

Requests run on the T3 Code server, so the URL must be reachable from that machine,
including when using a remote client. Credentials stay in its secret store. Replacing
a credential requires entering the name and URL again. HTTPS is required, except
HTTP on localhost for development. Redirects are refused.

## REST contract, version 1

Implement these routes beneath the configured base URL (for example,
`https://tracker.example.com/t3/v1`). Requests carry `Authorization: Bearer <token>`
and JSON bodies. Every response is JSON, including write acknowledgements (`{}`).
Never put secrets in response fields. Return 401/403 for rejected credentials,
404 for missing resources and 429 for rate limits. Other non-2xx responses fail the
operation; T3 Code does not retry writes automatically.

| Method | Route                                            | Response                                                                                       |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| GET    | `/connection`                                    | `{ "account": "alice", "scopes": [{ "key": "ENG", "name": "Engineering" }] }`                  |
| GET    | `/scopes/:scope/issues`                          | `{ "items": [summary], "nextCursor": null }`                                                   |
| GET    | `/scopes/:scope/issues/:key`                     | detail                                                                                         |
| GET    | `/scopes/:scope/issues/:key/comments?cursor=...` | `{ "comments": [comment], "nextCursor": null }`                                                |
| POST   | `/scopes/:scope/issues`                          | `{ "key": "ENG-1", "displayKey": "ENG-1", "url": "https://tracker.example.com/issues/ENG-1" }` |
| POST   | `/scopes/:scope/issues/:key/comments`            | `{}`                                                                                           |
| POST   | `/scopes/:scope/issues/:key/state`               | `{}`                                                                                           |

Scope and issue path segments are percent encoded. Keys must be stable and unique
within a scope. Scope keys should differ by more than case. A flat tracker can
expose one scope, such as `all`.

List query parameters are `state=all|open|closed`,
`involvement=all|assigned|authored|mentioned`, `sort=updated|created` (newest first),
`limit`, optional `query` (free text) and optional opaque `cursor`. A narrowed
involvement also carries `viewer` from `/connection`. Apply filters before pagination;
return a null cursor only when exhausted. Limit pages to the requested size.

Create receives `{ "title": "...", "body": "markdown" }`; comment receives
`{ "body": "markdown" }`; state receives `{ "state": "Done" }`. The API must enforce
scope access and write permissions for the authenticated user on every route.
State changes use an exact name from the issue's `states`, never a category.

A summary looks like:

```json
{
  "key": "ENG-1",
  "displayKey": "ENG-1",
  "title": "Fix the build",
  "url": "https://tracker.example.com/issues/ENG-1",
  "author": null,
  "state": { "category": "open", "name": "In progress" },
  "createdAt": "2026-11-01T00:00:00.000Z",
  "updatedAt": "2026-11-01T00:00:00.000Z",
  "closedAt": null,
  "assignees": [],
  "labels": [],
  "commentCount": 0
}
```

A detail has every summary field plus:

```json
{
  "body": "Markdown description",
  "viewer": "alice",
  "viewerPermissions": {
    "setState": true,
    "comment": true,
    "edit": false,
    "labels": false,
    "assignees": false
  },
  "states": [
    { "category": "open", "name": "In progress" },
    { "category": "closed", "name": "Done" }
  ],
  "comments": [],
  "commentsCursor": null,
  "events": [],
  "linkedPullRequests": []
}
```

A comment has `id`, `body`, `createdAt` (ISO timestamp), `author` and `url`
(nullable). An actor is `{ "login": "alice", "name": "Alice", "avatarUrl": null }`. A label is
`{ "name": "bug", "color": "ff0000" }`. The schemas in
[`packages/contracts/src/issue.ts`](../../packages/contracts/src/issue.ts) and
[`pullRequest.ts`](../../packages/contracts/src/pullRequest.ts) define the exact
field shapes. Responses are validated before use.

Search, creation and comments are required by this version. To disable comments
or state changes on an issue, return false in its viewer permissions and an empty
`states` array when no transitions are available. Editing, label/assignee mutation,
reactions, templates, events, linked pull requests and pasted-URL recognition are
not supported. Leave `events` and `linkedPullRequests` empty. Labels and assignees
may still appear as read-only metadata.
