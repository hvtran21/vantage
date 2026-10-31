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
