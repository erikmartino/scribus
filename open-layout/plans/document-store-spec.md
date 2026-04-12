# Open Layout Document Store — Format & API Spec

Status: **Draft v0.1** — 2026-04-12

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
      document.json            # document-level metadata
      spreads/
        spread-{n}.json        # one file per spread (page geometry + frame refs)
      stories/
        story-{id}.json        # one file per text story
      styles/
        paragraph-styles.json  # paragraph style definitions
        character-styles.json  # character style definitions
      assets/
        {hash}.{ext}           # images / placed files, content-addressed
      assets.json              # asset manifest: hash → original filename + mime
```

### Why this shape

| Decision | Rationale |
|---|---|
| One JSON file per spread | Parallel editing — two users rarely touch the same spread. Git merges cleanly. |
| Stories separate from spreads | A story can flow across multiple frames/spreads. Editing text never touches layout geometry. |
| Styles in their own files | Style changes are high-frequency in DTP. Isolating them keeps diffs small. |
| Content-addressed assets | Deduplication is free. Renaming an image doesn't move a 50 MB blob. |
| No manifest / TOC file | The directory listing *is* the manifest. The server can enumerate with `readdir`. |

---

## 2  File schemas

All files are UTF-8 JSON.  No trailing commas, no comments.

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
      "assetRef": "a1b2c3d4.jpg",
      "fitting": "proportional"
    }
  ]
}
```

Frames reference stories or assets by id/hash — they never embed content
inline.  This is the key IDML idea worth keeping.

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

### 2.4  `styles/paragraph-styles.json`

```jsonc
{
  "styles": [
    {
      "id": "body",
      "fontFamily": "EB Garamond",
      "fontSize": 12,
      "lineHeight": 1.4,
      "alignment": "justify"
    },
    {
      "id": "heading-1",
      "fontFamily": "EB Garamond",
      "fontSize": 24,
      "lineHeight": 1.2,
      "alignment": "left",
      "bold": true
    }
  ]
}
```

### 2.5  `styles/character-styles.json`

```jsonc
{
  "styles": [
    {
      "id": "emphasis",
      "italic": true
    },
    {
      "id": "link",
      "underline": true,
      "color": "#0057b7"
    }
  ]
}
```

### 2.6  `assets.json`

```jsonc
{
  "assets": [
    {
      "hash": "a1b2c3d4",
      "filename": "hero-photo.jpg",
      "mime": "image/jpeg",
      "width": 3000,
      "height": 2000,
      "sizeBytes": 1482930
    }
  ]
}
```

The hash is the first 8 hex chars of the SHA-256 of the file content (enough
for dedup in a single document; collisions are astronomically unlikely at this
scale).

---

## 3  HTTP API

The server exposes a flat file-shaped REST surface under `/store/`.

### 3.1  Endpoints

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/store/{user}/{doc}/` | List document files (JSON array of relative paths) |
| `GET` | `/store/{user}/{doc}/{file...}` | Return file content |
| `PUT` | `/store/{user}/{doc}/{file...}` | Create or overwrite file; parent dirs created automatically |
| `DELETE`| `/store/{user}/{doc}/{file...}` | Remove a file (optional, for cleanup) |

### 3.2  Content types

- JSON files are served as `application/json`.
- Asset files are served with their natural MIME type.
- PUT requests must set `Content-Type` appropriately; the server stores bytes
  verbatim.

### 3.3  Listing

`GET /store/alice/brochure-q2/` returns:

```json
[
  "document.json",
  "spreads/spread-1.json",
  "spreads/spread-2.json",
  "stories/story-main.json",
  "styles/paragraph-styles.json",
  "styles/character-styles.json",
  "assets.json"
]
```

This replaces the need for an explicit manifest.  The client (or AI agent)
reads the listing, then fetches what it needs.

### 3.4  Error codes

| Code | When |
|---|---|
| 200 | Success (GET, PUT) |
| 201 | Created (PUT, new file) |
| 204 | Deleted (DELETE) |
| 400 | Malformed path / traversal attempt |
| 404 | File or document not found |

---

## 4  Design notes for AI agents

An AI coding agent can work with this format using only generic file tools:

1. **Read** `document.json` to understand page geometry.
2. **List** the `spreads/` directory to discover pages.
3. **Read** a spread to find text frames and their `storyRef` values.
4. **Read** a story file, **edit** the JSON (add a paragraph, fix a typo,
   change styling), **write** it back.
5. **Read/write** style files to adjust typography globally.

Because every file is small, self-contained JSON, the agent never needs to
parse a monolithic document or hold the whole thing in context.

### Merge-friendliness

| Operation | Git behavior |
|---|---|
| Two users edit different stories | No conflict — different files |
| Two users edit the same story | Standard JSON line-level merge; usually clean if edits are in different paragraphs |
| User A adds a frame, user B edits text | No conflict — spread file vs story file |
| Two users change the same style | Conflict in `paragraph-styles.json` — small file, easy to resolve |

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
