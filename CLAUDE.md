# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BQBQ (表情标签) is a semantic forest-based image tagging and management system for organizing meme/expression images. Fat Client architecture with Python Flask backend and Vanilla JavaScript frontend.

## Commands

```bash
# Install dependencies
pip install Flask Flask-CORS Pillow

# Start backend server (default: http://localhost:5000)
cd "精确搜索SQLite端(旧)"
python app.py
```

No build process - runs directly without compilation.

## Architecture

### Core Pattern: Semantic Forest (语义森林)

Hierarchical tree structure for keyword management:
- Searching "Vehicle" auto-matches children like "Car", "Bike", "Truck" (keyword expansion)
- Supports unlimited nesting levels
- Cycle detection prevents circular references (A→B→C→A)

### Concurrency Model: Optimistic Locking (CAS)

- Version-based conflict detection (every rule modification increments `version_id`)
- Frontend auto-retries up to 3 times on conflict
- ETag caching reduces unnecessary transfers (HTTP 304)

### Data Flow

```
Frontend                          Backend
────────                          ───────
LocalStorage (source of truth)    SQLite3 + FTS5
       ↓                               ↓
  If-None-Match: version_id  →   Check version
       ↓                               ↓
  304: keep cache                200: update LocalStorage
```

## Code Structure

Main application code is in `精确搜索SQLite端(旧)/`:

| File | Description |
|------|-------------|
| `app.py` | Flask backend - 23 API endpoints, all database logic |
| `script.js` | Frontend controller - TagInput, GlobalState, MemeApp classes |
| `index.html` | UI structure with Tailwind CSS |
| `meme.db` | SQLite database (auto-created on first run) |

### Backend Key Tables

- `images` + `images_fts` - Image metadata with FTS5 full-text search
- `search_groups` / `search_keywords` / `search_hierarchy` - Rule tree structure
- `system_meta` / `search_version_log` - Version control for CAS

### Frontend Key Classes

- `TagInput` - Reusable tag capsule component with autocomplete
- `GlobalState` - Centralized state (clientId, rulesTree, queryTags, etc.)
- `MemeApp` - Main controller for lifecycle, API calls, UI rendering

## API Patterns

All rule modifications require `client_id` and `base_version` for CAS:
```json
{
  "client_id": "abc123",
  "base_version": 42,
  "group_name": "Vehicles"
}
```

Responses include conflict stats: `{"success": true, "new_version": 43, "conflicts": 0}`

## Code Style

- Python: PEP 8
- JavaScript: ESLint + Prettier
- Commits: Conventional Commits format
