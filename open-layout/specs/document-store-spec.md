# Open Layout Document Store — Format & API Spec

Status: **Draft v0.4** — 2026-04-18

### Implementation progress

- [x] Server GET/PUT/DELETE under `/store/` (`server.js`)
- [x] `?aggregate` endpoint for directory-level JSON collection
- [x] Per-asset metadata + low-res preview sidecars
- [x] One-file-per-entry for styles (paragraph + character)
- [x] Example documents (`store/alice/brochure-q2/`, `store/demo/typography-sampler/`)
- [x] Story editor reads from store via `?doc=` URL param (`store-loader.js`)
- [x] Playwright E2E test for store loading
- [x] POST copy endpoint for document instantiation from templates
- [x] Save (PUT) back to store from the spread editor (`doc.save` command, Ctrl+S)
- [x] Spread editor loads from store via `?doc=` URL param (`_loadFromStore()`)
- [x] Document browser with template cloning and per-document Open routing
- [x] Story editor save-back

## Goals

1. **Exploded file format** — every logical piece is a separate file on disk so
   that `git diff`, `git merge`, and line-level conflict resolution work
   naturally.
2. **AI-editable** — an LLM with file-read/write tools can create or modify a
   document without understanding a binary container.  Human-readable JSON
   everywhere; binary assets kept separate.
3. **Trivial server** — the HTTP layer is a thin GET/PUT file store.  No
   sessions, no database, no query language.
4. **User separation** — the user-id appears in the URL path so that future
   authorization can be a simple path-prefix check.
5. **IDML-inspired, but simpler** — borrows the idea of one file per spread
   and one file per story, but drops the XML verbosity, packaging manifests,
   and ZIP container.

---

## 1  On-disk layout

```
store/
  {user-id}/
    {doc-id}/
      document.json               # document-level metadata
      spreads/
        spread-{n}.json           # one file per spread
      stories/
        story-{id}.json           # one file per text story
      styles/
        paragraph/
          {style-id}.json         # one file per paragraph style
        character/
          {style-id}.json         # one file per character style
      assets/
        {name}/                   # one folder per placed asset
          {name}.{ext}            # full-resolution file, keeps its real name
          preview.webp            # low-resolution preview
          meta.json               # asset metadata (dimensions, MIME)
```

### Design principle: one file per entry, no manifests

Every collection (spreads, stories, styles, assets) stores **one entry per
file**.  There are no manifest or index files that list entries — the
directory listing *is* the manifest.  The server supports a virtual
`.aggregate.json` extension that reads all JSON files in a directory and
returns them as a single array, giving the client the equivalent of a
manifest without the git-conflict risk of maintaining one.

For example, `GET .../styles/paragraph.aggregate.json` reads every `.json`
file in the `styles/paragraph/` directory and returns them as a JSON array.
The `.aggregate.json` suffix is not a real file — it is a server convention
that maps to a directory of the same name (minus the extension).

| Decision | Rationale |
|---|---|
| One file per spread | Parallel editing — two users rarely touch the same spread. |
| Stories separate from spreads | A story can flow across frames/spreads.  Editing text never touches geometry. |
| One file per style | Two users editing different styles never conflict. |
| Per-asset folder | Adding/removing an asset is a self-contained directory add/remove — no shared manifest. |
| Low-res preview sidecar | Clients can show thumbnails without downloading full-res originals. |
| Human-readable asset names | Folder names match the original filename — browsable and editable without tooling. |
| `.aggregate.json` instead of manifests | Clients get one-request convenience; git gets zero-conflict granularity. |

---

## 2  File schemas

All metadata files are UTF-8 JSON.  No trailing commas, no comments.

### 2.1  `document.json`

```jsonc
{
  "format": "open-layout/v1",
  "title": "My Brochure",
  "created": "2026-04-12T10:00:00Z",
  "modified": "2026-04-12T14:32:00Z",
  "defaultUnits": "mm",
  "pageSize": { "width": 210, "height": 297 },
  "bleed": { "top": 3, "right": 3, "bottom": 3, "left": 3 }
}
```

### 2.2  `spreads/spread-{n}.json`

```jsonc
{
  "id": "spread-1",
  "pages": [
    { "index": 0, "label": "1" }
  ],
  "frames": [
    {
      "id": "frame-a",
      "type": "text",
      "x": 20, "y": 30,
      "width": 170, "height": 240,
      "storyRef": "story-main"
    },
    {
      "id": "frame-b",
      "type": "image",
      "x": 50, "y": 50,
      "width": 100, "height": 80,
      "assetRef": "hero-photo",
      "fitting": "proportional"
    }
  ]
}
```

Frames reference stories by id and assets by folder name — they never embed
content inline.  This is the key IDML idea worth keeping.

### 2.3  `stories/story-{id}.json`

```jsonc
{
  "id": "story-main",
  "paragraphs": [
    {
      "styleRef": "body",
      "runs": [
        { "text": "Hello, ", "style": {} },
        { "text": "world", "style": { "bold": true } }
      ]
    }
  ]
}
```

A story is an ordered list of paragraphs; a paragraph is an ordered list of
styled runs.  This is the minimal unit an AI can edit: it can append a
paragraph, change a run's text, or flip `bold` to `true` — all with a simple
JSON patch.

### 2.4  `styles/paragraph/{style-id}.json`

Each paragraph style is its own file:

```jsonc
{
  "id": "body",
  "fontFamily": "EB Garamond",
  "fontSize": 12,
  "lineHeight": 1.4,
  "alignment": "justify"
}
```

To fetch all paragraph styles at once:
`GET /store/{user}/{doc}/styles/paragraph.aggregate.json`

### 2.5  `styles/character/{style-id}.json`

```jsonc
{
  "id": "emphasis",
  "italic": true
}
```

Same aggregation pattern:
`GET /store/{user}/{doc}/styles/character.aggregate.json`

### 2.6  `assets/{name}/meta.json`

```jsonc
{
  "mime": "image/jpeg",
  "width": 3000,
  "height": 2000,
  "sizeBytes": 1482930
}
```

### 2.7  Asset folder convention

Each placed asset lives in its own folder under `assets/`, named after the
original file (minus extension).  The folder contains up to three files:

| File | Purpose |
|---|---|
| `{name}.{ext}` | Full-resolution file, keeps its real name (e.g. `hero-photo.jpg`) |
| `preview.webp` | Low-resolution preview, typically 800px on the long edge |
| `meta.json` | Metadata: MIME type, dimensions, file size |

The folder name matches the file stem — `assets/hero-photo/hero-photo.jpg`.
Spreads reference assets by folder name: `"assetRef": "hero-photo"`.
Renaming an asset means renaming the folder, the file inside it, and the
`assetRef` in the spread — a single coherent git commit.

Clients load `preview.webp` for canvas thumbnails and only fetch the
full-resolution file when needed (export, zoom-to-100%).

To fetch all asset metadata at once:
`GET /store/{user}/{doc}/assets.aggregate.json`

The aggregation endpoint reads `meta.json` from each immediate subdirectory
of `assets/` and returns them as a JSON array.

---

## 3  HTTP API

The server exposes a flat file-shaped REST surface under `/store/`.

### 3.1  Endpoints

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/store/{user}/{doc}/` | List document files (JSON array of relative paths) |
| `GET` | `/store/{user}/{doc}/{dir}.aggregate.json` | Aggregate: read all `.json` files in `{dir}/`, return as JSON array |
| `GET` | `/store/{user}/{doc}/stories/{id}/edit` | Serve the story editor for this story |
| `GET` | `/store/{user}/{doc}/{file...}` | Return file content |
| `PUT` | `/store/{user}/{doc}/{file...}` | Create or overwrite file; parent dirs created automatically |
| `POST`  | `/store/{user}/{newDoc}` | Copy a document from a template (see §3.6) |
| `DELETE`| `/store/{user}/{doc}/{file...}` | Remove a file (optional, for cleanup) |

### 3.2  Content types

- JSON files are served as `application/json`.
- Asset files are served with their natural MIME type (extension-based lookup).
- PUT requests store bytes verbatim.

### 3.3  Listing

`GET /store/alice/brochure-q2/` returns:

```json
[
  "assets/hero-photo/meta.json",
  "assets/hero-photo/preview.webp",
  "document.json",
  "spreads/spread-1.json",
  "spreads/spread-2.json",
  "stories/story-body.json",
  "stories/story-intro.json",
  "stories/story-sidebar.json",
  "stories/story-title.json",
  "styles/character/emphasis.json",
  "styles/character/strong.json",
  "styles/paragraph/body.json",
  "styles/paragraph/heading-1.json",
  "styles/paragraph/heading-2.json"
]
```

### 3.4  Aggregation

`GET /store/alice/brochure-q2/styles/paragraph.aggregate.json` returns:

```json
[
  { "id": "body", "fontFamily": "EB Garamond", "fontSize": 12, ... },
  { "id": "heading-1", "fontFamily": "EB Garamond", "fontSize": 24, ... },
  { "id": "heading-2", "fontFamily": "EB Garamond", "fontSize": 18, ... }
]
```

The `.aggregate.json` suffix is a virtual file extension.  The server strips
it, resolves the remaining path as a directory, reads each `.json` file in
that directory (non-recursive), parses it, and returns the parsed objects as
an array sorted by filename.  Non-JSON files in the directory are ignored.

This means `assets.aggregate.json` returns only the `.meta.json` entries
from `assets/` — the `.preview.webp` and original image files are skipped
because they are not JSON.

### 3.5  Error codes

| Code | When |
|---|---|
| 200 | Success (GET, PUT) |
| 201 | Created (PUT, new file) |
| 204 | Deleted (DELETE) |
| 400 | Malformed path / traversal attempt |
| 404 | File or document not found |
| 409 | Conflict (POST copy target already exists) |

### 3.6  Document copy (POST)

`POST /store/{user}/{newDoc}` with a JSON body creates a new document by
recursively copying an existing one:

```json
{ "from": "demo/typography-sampler" }
```

**Behavior:**

1. The `from` field identifies the source document (relative to `/store/`).
2. The source must exist and be a directory; otherwise the server returns 404.
3. The target path must not already exist; otherwise the server returns 409.
4. All files and subdirectories are copied recursively (stories, styles,
   spreads, assets — including binary files).
5. After copying, `document.json` in the new document is patched with fresh
   `created` and `modified` timestamps.  If `document.json` is missing or
   malformed, the copy still succeeds — only the timestamp patch is skipped.

**Response (201 Created):**

```json
{ "path": "alice/my-new-brochure" }
```

This endpoint enables "New from Template" workflows: a set of template
documents can live under a shared namespace (e.g. `templates/`) and be
instantiated into a user's workspace with a single POST.

---

## 4  Design notes for AI agents

An AI coding agent can work with this format using only generic file tools:

1. **Read** `document.json` to understand page geometry.
2. **List** the `spreads/` directory to discover pages.
3. **Read** a spread to find text frames and their `storyRef` values.
4. **Read** a story file, **edit** the JSON (add a paragraph, fix a typo,
   change styling), **write** it back.
5. **Read/write** individual style files to adjust typography.
6. **Read** `assets/{name}/meta.json` to understand a placed image.

Because every file is small, self-contained JSON, the agent never needs to
parse a monolithic document or hold the whole thing in context.

### Merge-friendliness

| Operation | Git behavior |
|---|---|
| Two users edit different stories | No conflict — different files |
| Two users edit the same story | Standard JSON line-level merge; usually clean if edits are in different paragraphs |
| User A adds a frame, user B edits text | No conflict — spread file vs story file |
| Two users edit different styles | No conflict — different files |
| Two users add different assets | No conflict — independent `.meta.json` files |

---

## 5  Path-based authorization — future outlook

The store URL structure `/{user}/{doc}/{path}` naturally supports a simple
authorization model:

```
Rule:  A request is authorized if the authenticated user-id matches the
       {user} segment of the path (or if the user is an admin).
```

**Strengths of this approach:**

- Trivial to implement as middleware — one string comparison before the handler
  runs.
- No ACL tables, no database queries.
- Works with any auth mechanism (bearer token, cookie, mutual TLS) — the auth
  layer just needs to extract a user-id.
- Path structure is visible in URLs, making debugging and audit logging
  straightforward.

**Limitations to address later:**

- **Sharing / collaboration** — two users working on the same document need
  either (a) a shared namespace like `/org/{org-id}/{doc}/`, (b) explicit ACL
  entries, or (c) git-style forks where each user has their own copy.
  Git-style forks fit this project's collaboration model best: user A's copy
  lives at `/store/alice/brochure/`, user B forks to `/store/bob/brochure/`,
  and merging happens through the git layer rather than through real-time
  locking.
- **Public/read-only access** — a simple flag in `document.json`
  (`"public": true`) could let the server serve GET requests without auth
  while still requiring auth for PUT.
- **Path segments are not secrets** — user-ids in URLs are visible in logs,
  `Referer` headers, and browser history.  Use opaque ids (UUIDs) rather than
  emails.

Overall, path-based authorization is a sound starting strategy for this
project because the collaboration model is git-flavored (per-user copies,
explicit merge) rather than Google-Docs-flavored (single shared copy,
real-time OT).  The path structure can evolve to `/store/{org}/{user}/{doc}/`
when team workspaces are needed, without breaking the core auth rule.

---

## 6  What this intentionally omits

- **Versioning / undo history** — git handles this.
- **Real-time sync** — out of scope; use git pull/push or polling.
- **Schema validation** — the server stores bytes; validation belongs in the
  client or a CI linter.
- **Compression** — files are small JSON; HTTP gzip is sufficient.
- **Locking** — git merge is the conflict resolution strategy.
