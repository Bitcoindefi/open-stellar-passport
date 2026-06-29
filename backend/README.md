# Passport Suspension Appeal — Backend

Implements **ROADMAP-122** (issue #709): an appeal mechanism for suspended passports.

## Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/passports/:id/appeal` | Holder only | Submit appeal (reason ≤ 1000 chars) |
| `GET`  | `/api/passports/:id/appeal` | Holder or Admin | Read current appeal status |
| `PATCH`| `/api/admin/appeals/:appealId` | Admin only | Approve / reject with optional note |

## Status Codes

- `201` — Appeal created
- `403` — Not the passport holder / not admin
- `404` — Passport or appeal not found
- `409` — Appeal already pending
- `422` — Passport not suspended

## Audit Events

- `appeal_submitted`
- `passport_reactivated` (on approve)
- `appeal_rejected` (on reject)

## Quick Start

```bash
cd backend
npm install
npm run dev       # ts-node-dev on :3000
npm test          # jest with coverage

## Environment
| Variable    | Default                                           | Purpose            |
| ----------- | ------------------------------------------------- | ------------------ |
| `PORT`      | `3000`                                            | HTTP port          |
| `MONGO_URI` | `mongodb://localhost:27017/open_stellar_passport` | MongoDB connection |


## Tests
npm test

Covers:
Full lifecycle (submit → get → approve → verify reactivation)
403 guard (non-holder, non-admin)
409 guard (duplicate pending appeal)
422 guard (passport not suspended)
Role checks on admin PATCH