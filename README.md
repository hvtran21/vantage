# Vantage

Just the headlines that matter. A cross-platform mobile app for discovering technology news: browse by genre, save articles for later, and read the rest in your browser.

<p align="center">
  <img width="398" height="884" alt="image" src="https://github.com/user-attachments/assets/051b8751-feaf-4810-931a-e62b608e2cf8" />

  <img width="398" height="884" alt="image" src="https://github.com/user-attachments/assets/9e68216b-d22a-440a-ad2d-b44113b2ef9b" />

  <img width="398" height="884" alt="image" src="https://github.com/user-attachments/assets/a9725fb0-3f25-4a5a-9ea3-49a40d565b94" />
  
  <img width="398" height="884" alt="image" src="https://github.com/user-attachments/assets/c26e1fdf-9bac-4069-bbe6-3159b1821be2" />

  <img width="398" height="884" alt="image" src="https://github.com/user-attachments/assets/4d7b5bdc-51f1-40e7-ba71-4a52af1356b2" />

  <img width="398" height="884" alt="image" src="https://github.com/user-attachments/assets/85cdc6ef-0b49-4186-a5c7-eec828ab1c82" />

  
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
