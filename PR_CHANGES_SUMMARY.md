# Pull Request Summary — Karigari Connect (`frontend-avi`)

## Overview
This branch contains comprehensive architectural hardening, full-stack feature implementations, and UI/UX revamps across the mobile frontend and FastAPI backend for **Karigari Connect** (Smart Cataloging & Market Linkage for Marginalized Artisans).

---

## Key Highlights & Changes

### 1. Authentication & Database Connection Resilience
- **Single-Screen Pill-Tab Role Selector**: Unified sign-in screen allowing seamless switching between **Artisan** (Terracotta `#B84A2A`) and **Coordinator** (Indigo `#243354`) personas.
- **One-Tap Demo Authentication**: Instant login for hackathon judges and rapid testing with pre-seeded demo accounts (`artisan_demo` and `coord_demo`).
- **Dual-Identifier Authentication**: Allows artisans to log in using either **Phone Number** or **Username**.
- **Self-Healing Database Architecture**:
  - Increased connection timeout from 3s to 10s with automated retries to gracefully handle Neon serverless compute wake-ups.
  - Automatic fallback to local SQLite (`karigari.db`) with dynamic schema migration (`ensure_sqlite_schema`) and demo user auto-seeding.
  - Guarantees 100% login uptime even when offline or during transient network hiccups.

### 2. Statutory Heuristic Fair Pricing Engine
- **Legal Minimum Wage Enforcement**: Grounded in official minimum wage schedules across pilot states (Karnataka, Uttar Pradesh, West Bengal) and geographic wage zones.
- **4-Tier Skill Resolution**: Resolves statutory skill tier (Unskilled, Semi-Skilled, Skilled, Master Craftsman) considering craft technique floors, self-declaration, and official artisan credentials (Pehchan Card / PM Vishwakarma).
- **Honest Unavailable States**: Eliminated silent tier substitution; missing statutory wage rates return `status: "unavailable"` with `WAGE_RATE_UNAVAILABLE` and an informational reference suggestion.
- **Strict Floor Protection**: Technique multipliers strictly enhance the recommended marketplace price band and never inflate the legal wage floor.
- **Master Craftsman Claim Gating**: Requires coordinator verification for self-declared Master Craftsman claims before listing approval.

### 3. Persistent Artisan Profile & Verification Workstation
- **Persistent Profile Management**: User-level profiles storing state jurisdiction, wage zone, declared skill tier, and official ID credentials.
- **Coordinator Profiles Queue**: Dedicated review workstation allowing field supervisors to inspect ID credentials and verify or adjust artisan skill tiers.
- **Profile-Informed Pricing**: Verified artisan profiles automatically promote craft listings to the verified tier without per-listing claim gating.

### 4. Creation Journey & AI Deadlock Resolution
- **Streamlined 5-Step Creation Wizard**: Restructured into 5 logical steps:
  1. Capture (Camera & photo stack)
  2. Image Review (AI enhancement & cover photo selection)
  3. Speak (Voice dialect storytelling)
  4. Confirm Details (Taxonomy & material cost confirmation)
  5. Price & Submit (Statutory floor calculation & readiness checklist)
- **Confirmation Deadlock Fix**: Added `material_cost_paise` to editable confirmation fields, resolving the disabled Continue button deadlock.
- **English Default for Voice Capture**: Defaulted `SpeakScreen` to English (`en`) while maintaining full support for regional dialects (Kannada, Hindi).

### 5. Mobile Navigation & Visual Modernization
- **4-Tab Floating Bottom Navigation**:
  - **Artisan**: My Listings, In Review, Help, Profile.
  - **Coordinator**: Queue, Profiles, History, Account.
- **GlassTabBar Component**: Floating frosted-glass tab bar with spring animations, dynamic badge counters, and role-specific color accents (Indigo for Coordinator, Terracotta for Artisan).
- **Universal White Background (`#FFFFFF`)**: Clean, modern pure white canvas across the entire application, eliminating legacy beige/off-white tints.
- **Action Button Clearance**: Positioned coordinator approval/rejection actions inline to eliminate overlap with the floating tab bar and software keyboard.

### 6. Support Messaging System
- End-to-end support messaging backend models, schemas, and endpoints (`/api/v1/support/messages`) allowing artisans to send inquiries directly to field coordinators.

---

## Verification & Test Results
- **Frontend TypeScript Check**: `npx tsc --noEmit` -> **0 errors**.
- **Backend Pytest Suite**: **38/38 unit and integration tests passing (100%)**.
- **Authentication Tests**: Verified both online (Neon PostgreSQL) and offline (SQLite fallback) with `TestClient`.
