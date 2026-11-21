# PayLite: a small payments app

**Course:** COMP 307, group project · **Team:** Alex, Priya, Jordan, Sam · **Deadline:** Friday, December 4, 2026

## Goal

Build a web app where a small business can take card payments, issue refunds, see its payment history on a dashboard, and change a few account settings. Payments go through Stripe's test mode; no real money moves.

## Requirements

### 1. Payment API (backend), owner: Alex
- `POST /payments/charge`: charge a card for an amount in cents and a currency; reject invalid cards, zero or negative amounts, and unsupported currencies.
- `POST /payments/refund`: refund all or part of an earlier charge.
- Unit tests for charging, validation and refunds.
- Code lives in `backend/payments/`.

### 2. Payment history endpoint (backend), owner: Alex
- `GET /payments/history`: paginated list of charges and refunds, newest first, filterable by date range.
- The dashboard depends on this endpoint.
- Code lives in `backend/history/`.

### 3. Checkout page (frontend), owner: Priya
- Card form with amount, card number, expiry and CVC; inline validation errors.
- Confirmation screen after a successful payment.
- Code lives in `frontend/checkout/`.

### 4. Dashboard (frontend), owner: Sam
- Table of recent payments from the history endpoint, with totals for today and this week.
- Filter by date range; link each row to its refund action.
- Code lives in `frontend/dashboard/`. **Needs the payment history endpoint first.**

### 5. Settings page (frontend), owner: Jordan
- Business name, default currency and email receipt preference.
- Saves preferences and shows them again after a reload.
- Code lives in `frontend/settings/`.

### 6. Pitch slides, owner: Priya
- 5-minute demo presentation for the final class. No code.

## Milestones

- **End of week 1:** project skeleton, Stripe test client, frontend scaffold.
- **End of week 2:** charging works end to end; checkout form validates; settings page saves preferences.
- **End of week 3:** history endpoint and dashboard; refunds.
- **Final week:** polish, tests, slides.

## Grading note

Marks come from a working demo, code quality and a short individual reflection. The team is expected to split work fairly and keep each other informed.
