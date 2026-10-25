# SlickSync API Documentation

> An interactive, try-it-yourself version of this doc (Swagger UI, built from
> the same route handlers below) is served by every SlickSync instance at
> `/api/docs` - no login required to view it, only to call an endpoint for
> real.

This reference covers the external integration API. Internal admin and user-panel
routes under `/api` are separate application interfaces.

## Base URL
The supported external API endpoints are prefixed with `/api/ext` (e.g., `/api/ext/account`, `/api/ext/addons/reload`).

## Authentication

**API key authentication required for all endpoints.**

- API key sent via `Authorization: Bearer <api-key>` header
- API key can be generated in the Settings page
- Example: `Authorization: Bearer 415x1e...`

---

## Endpoints

### External API (`/api/ext`)

#### `GET /api/ext/account`
Get account statistics.

**Authentication:** Required (API key)

**Response:**
```json
{
  "lastRunAt": "2026-10-25T00:00:00Z",
  "totalUsers": 10,
  "totalGroups": 5,
  "totalAddons": 20,
  "pendingInvites": 0
}
```

The response also includes account identity fields: `id`, `uuid`, `email`,
`linkedProvider`, `avatarUrl`, and `displayName`. Optional profile values may be null.

#### `GET /api/ext/continue-watching`

Read the authenticated account's household Continue Watching rows, newest activity first.
`limit` defaults to 5 and is clamped to 1 through 20.

Returns `{ "items": [...] }`. Each item includes `show`, `showId`, `contentType`,
`user`, `provider`, `poster`, `season`, `episode`, `episodeTitle`, `lastWatchedAt`,
`progressPercent`, `resume`, `appUrl`, and `webUrl`. Artwork, episode details,
progress and links can be null. `resume` distinguishes an episode in progress
from the next episode. Treat provider app links as deep links and use `webUrl`
for a browser fallback.

#### `GET /api/ext/metrics.json`
Get the full dashboard metrics for this account; same data the Metrics page renders. Served from an in-memory cache refreshed every 5 minutes when available; built on demand otherwise.

**Authentication:** Required (API key)

**Query Parameters:**
- `period` (optional): `7d` | `30d` | `90d` | `all`; defaults to `30d`

**Response:** Same shape the admin Metrics page consumes.

#### `POST /api/ext/addons/reload`
Reload addons by addon ID, for Nuvio and Stremio accounts alike. This can be used by other addon developers so whenever the addon is updated, a call to SlickSync is made to immediately reload it.

**Authentication:** Required (API key)

**Request Body:**
```json
{
  "stremioAddonId": "com.stremio.addon.id"
}
```

**Response:**
```json
{
  "message": "Addons reloaded",
  "reloaded": 2,
  "total": 2,
  "diffs": [
    {
      "id": "addon-id",
      "name": "Addon Name",
      "diffs": {
        "addedResources": [...],
        "removedResources": [...],
        "addedCatalogs": [...],
        "removedCatalogs": [...]
      }
    }
  ]
}
```

#### `POST /api/ext/addons/sync`
Reload addons by addon ID, then sync all groups containing those addons. Applies to Nuvio and Stremio accounts alike. This can be implemented by other addon developers to enable instant addon configuration update propagation on save to multiple users.

**Authentication:** Required (API key)

**Request Headers (Optional):**
- `Source` or `X-Sync-Source` or `X-App-Name`: Source label for Discord notifications (e.g., "Addon Builder", "My App")
- `Source-Logo` or `X-Source-Logo`: Logo URL for Discord notifications

**Request Body:**
```json
{
  "stremioAddonId": "com.stremio.addon.id"
}
```

**Response:**
```json
{
  "message": "Reload and sync completed",
  "reloaded": 2,
  "groupsSynced": 3,
  "totalUsersSynced": 6,
  "diffs": []
}
```

#### `POST /api/ext/groups/sync`
Sync all groups.

**Authentication:** Required (API key)

**Request Headers (Optional):**
- `Source` or `X-Sync-Source` or `X-App-Name`: Source label for Discord notifications (e.g., "Addon Builder", "My App")
- `Source-Logo` or `X-Source-Logo`: Logo URL for Discord notifications

**Response:**
```json
{
  "message": "Sync triggered",
  "ok": 5,
  "fail": 0,
  "totalFailed": 0,
  "totalSynced": 10
}
```

---

## Error Responses

Errors generally include `message`; the metrics endpoint uses `error` instead.
Some responses include additional detail:

```json
{
  "message": "Error description",
  "error": "Detailed error message (optional)"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized (invalid or missing API key)
- `404` - Not Found
- `500` - Internal Server Error

---

## Notes

- All timestamps are in ISO 8601 format
- Treat IDs as opaque strings
- URLs are normalized and validated
- Manifest URLs are encrypted in the database
- Sync operations respect account-level sync settings (mode: normal/advanced, safe/unsafe)
- The `stremioAddonId` parameter refers to the addon's own manifest identifier (e.g., `com.stremio.addon.id`). Nuvio and Stremio both use the same addon protocol, so this applies to either; the parameter keeps its original name so existing callers are unaffected
- When reloading addons, the system will find all addons in your account that match the given `stremioAddonId` and reload their manifests
- The `diffs` array in reload responses shows what changed in each addon's manifest (new/removed resources and catalogs)
