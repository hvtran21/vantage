# Vantage

Just the headlines that matter. A cross-platform mobile app for discovering technology news: browse by genre, save articles for later, and read the rest in your browser.

<p align="center">
  <img src="screenshots/feed.png" width="260" alt="Feed screen" />
  <img src="screenshots/profile.png" width="260" alt="Profile screen" />
  <img src="screenshots/saved.png" width="260" alt="Saved screen" />
</p>

---

## Overview

The app is a discovery tool, not a reader. The goal is to surface headlines fast across genres you care about, then hand off to the browser for the actual read. Articles are aggregated server-side from [NewsAPI](https://newsapi.org), stored in PostgreSQL, and synced into a local SQLite cache on-device for offline-first browsing.

```
Mobile (Expo Router)  ──HTTP──▶  Express API  ──HTTP──▶  NewsAPI
   SQLite cache                      │
                                      └──▶  PostgreSQL
```

## Features

**Mobile**
- Genre-based discovery feed across 14 tech categories (AI, Gaming, Apple, Cybersecurity, and more)
- Home / Recent / Top filters, plus in-app search
- Save articles for later, offline
- Cursor-based pagination for loading more articles from the server without re-fetching
- Offline-first: all reads come from a local SQLite cache, synced in the background
- Onboarding genre picker, no account required

**Backend**
- REST API built on Express + TypeScript, validated end-to-end with Zod
- OpenAPI docs generated directly from the same Zod schemas that validate requests: one source of truth
- PostgreSQL schema managed with versioned migrations (`node-pg-migrate`)
- Admin endpoints protected by a shared-secret token, rate-limited separately from public routes
- Structured logging (`pino`), graceful shutdown, health check endpoint
- Test suite (`vitest` + `supertest`) covering route contracts against mocked services

## Tech Stack

| | |
|---|---|
| **Mobile** | React Native, Expo, Expo Router, TypeScript, SQLite, Reanimated |
| **Backend** | Node.js, Express, TypeScript, PostgreSQL, pg-promise, Zod |
| **Tooling** | node-pg-migrate, pino, vitest, tsx |
| **External** | NewsAPI |

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Liveness probe (checks database connectivity) |
| GET | `/api/articles` | None | List articles by genre or category, with cursor pagination |
| GET | `/api/articles/search` | None | Full-text search across cached articles |
| POST | `/api/admin/refresh` | `x-admin-token` | Force-fetch all genres/categories from NewsAPI |
| POST | `/api/admin/cleanup` | `x-admin-token` | Delete articles older than N days |
| GET | `/api-docs` | None | Swagger UI |
| GET | `/api-docs/openapi.json` | None | Raw OpenAPI 3.0 spec |

## Getting Started

### Prerequisites
- Node.js and npm
- PostgreSQL running locally
- A [NewsAPI](https://newsapi.org) key
- Expo Go (for physical device testing) or iOS Simulator / Android emulator

### Backend

```bash
cd src/server
npm install
```

Create `src/server/.env`:

```
NEWS_API_KEY=your_newsapi_key
PORT=8000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=newsapp
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DATABASE_URL=postgres://your_db_user:your_db_password@localhost:5432/newsapp
ADMIN_TOKEN=a-secret-at-least-16-characters
```

```bash
createdb newsapp
npm run migrate:up   # applies the schema
npm run dev           # tsx watch, hot reload
```

### Mobile

```bash
cd src
npm install
```

Create `src/.env`:

```
EXPO_PUBLIC_BASE_URL=http://localhost:8000
```

> On a physical device, replace `localhost` with your machine's LAN IP.

A release build (not `__DEV__`) refuses to start unless `EXPO_PUBLIC_BASE_URL` is an `https://` URL. Run the unit tests with `npm test` in `src`; they need Node 22.18 or newer, which runs TypeScript directly.

```bash
npx expo start
```

Press `i` for iOS Simulator, `a` for Android emulator, or scan the QR code with Expo Go.

### Tests

```bash
cd src/server
npm test
```

## Project Structure

```
src/
├── app/                          # Mobile app (Expo Router)
│   ├── index.tsx                 # Entry: font loading, first-launch routing
│   ├── welcome.tsx                # Onboarding + genre selection
│   ├── (tabs)/
│   │   ├── index.tsx              # Feed
│   │   ├── profile.tsx            # Profile + genre preferences
│   │   └── saved.tsx              # Saved articles
│   ├── article/[id].tsx           # Article detail
│   └── components/
│       ├── services.tsx           # Data fetching + SQLite access
│       ├── database.ts            # SQLite schema + migrations
│       ├── news_card.tsx          # Article card UI
│       └── styles.tsx             # Theme, shared components
│
└── server/                        # Backend (Node.js + Express)
    ├── db.ts                      # PostgreSQL connection
    ├── constants.ts                # Genre/category definitions
    ├── migrations/                 # Versioned SQL migrations
    └── src/
        ├── app.ts                  # Express app factory
        ├── server.ts                # Entry point (listen + shutdown)
        ├── config/                  # Zod-validated environment
        ├── routes/                  # articles, admin, health
        ├── services/                 # Business logic
        ├── repositories/             # SQL queries
        ├── schemas/                  # Zod request/response schemas
        ├── middleware/                # validate, adminAuth, errorHandler
        └── openapi/                   # Generated API spec
```

---

Feel free to further expand sections as the project grows!
