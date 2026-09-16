# Karigari Connect — Mobile Application (Frontend)

Karigari Connect is a mobile platform empowering Indian artisans to photograph, speak, catalogue, and price their authentic handloom and handicraft products with AI assistance and fair wage protections.

Built with **React Native (0.86)**, **Expo (SDK 57)**, **React 19**, **React Navigation (v7)**, and **TypeScript**.

---

## Quick Start

### 1. Prerequisites
- **Node.js**: `v18.x` or `v20.x+` (LTS recommended)
- **Package Manager**: `npm` (v9+) or `yarn` / `pnpm`
- **Expo CLI**: bundled automatically via `npx expo`
- **Mobile Environment**:
  - **Android**: Android Studio with an Android Emulator (API 33+) or an Android device running **Expo Go** / Dev Client.
  - **iOS**: Xcode Simulator (macOS only) or an iPhone running **Expo Go** / Dev Client.

---

### 2. Install Dependencies

From the repository root or the `frontend/` directory:

```bash
cd frontend
npm install
```

If you ever need to reinstall or reconcile Expo-compatible native module versions, run:

```bash
npx expo install --fix
```

---

### 3. Launch Development Server

```bash
# Start the Metro bundler
npx expo start

# Or with clear cache
npx expo start -c
```

**Terminal Shortcuts:**
- Press `a` to open on Android emulator/connected device
- Press `i` to open on iOS simulator
- Press `r` to reload the bundle
- Scan the QR code with the **Expo Go** app on your physical mobile phone

---

## Required Libraries & Module Breakdown

Below is the complete catalogue of libraries used in this project and how to install them:

### 1. Core Framework & Engine
| Package | Version | Purpose |
| :--- | :--- | :--- |
| `expo` | `~57.0.21` | Expo managed workflow runtime & core modules |
| `react` | `19.2.3` | React 19 engine |
| `react-native` | `0.86.3` | React Native framework with New Architecture support |

```bash
npm install react@19.2.3 react-dom@19.2.3 react-native@0.86.3 expo@~57.0.21
```

---

### 2. Navigation Layer (React Navigation v7)
| Package | Purpose |
| :--- | :--- |
| `@react-navigation/native` | Root navigation container and navigation state |
| `@react-navigation/native-stack` | High-performance native screen transitions & headers |
| `react-native-screens` | Native view hierarchy primitives for memory efficiency |
| `react-native-safe-area-context` | Notch, dynamic island, and gesture inset handling |

```bash
npx expo install react-native-screens react-native-safe-area-context
npm install @react-navigation/native @react-navigation/native-stack
```

---

### 3. Hardware, Media & AI Studio
| Package | Purpose |
| :--- | :--- |
| `expo-camera` | High-resolution multi-angle camera viewfinder with flashlight torch control |
| `expo-audio` | Low-latency native voice recording for craft story transcription |
| `expo-image` | Smooth caching and progressive rendering of craft images |
| `expo-image-manipulator` | Client-side compression, orientation correction, and aspect cropping |
| `expo-asset` | Pre-loading of static assets, logos, and placeholders |

```bash
npx expo install expo-camera expo-audio expo-image expo-image-manipulator expo-asset
```

---

### 4. Offline Database, Secure Storage & Outbox
| Package | Purpose |
| :--- | :--- |
| `expo-sqlite` | Local SQLite database (`karigari.db`) for offline drafts & transactional outbox |
| `expo-secure-store` | Hardware-backed encrypted storage for user tokens and role credentials |
| `expo-crypto` | Cryptographic UUIDv4 generation for offline draft & media identifiers |

```bash
npx expo install expo-sqlite expo-secure-store expo-crypto
```

---

### 5. UI Components, Design System & Icons
| Package | Purpose |
| :--- | :--- |
| `react-native-paper` | Material Design 3 component library (TextInput, Button, Card, Chip, FAB, IconButton) |
| `@expo/vector-icons` | Vector iconography (MaterialCommunityIcons, Feather, Ionicons) |
| `react-native-svg` | Native SVG rendering engine |
| `react-native-qrcode-svg` | Generation of verification QR codes for published craft certificates |
| `lottie-react-native` | Fluid vector micro-animations for loading & status states |

```bash
npx expo install react-native-svg
npm install react-native-paper @expo/vector-icons react-native-qrcode-svg lottie-react-native
```

---

### 6. State Management, Networking & Internationalization
| Package | Purpose |
| :--- | :--- |
| `zustand` | Lightweight client state for Auth session (`authStore`) and active draft tracking (`draftStore`) |
| `@tanstack/react-query` | Asynchronous server state, polling job statuses, and cache invalidation |
| `axios` | HTTP client with automatic idempotency tokens and retry headers |
| `i18next` & `react-i18next` | Multi-language support (Kannada `kn`, Hindi `hi`, English `en`) |
| `react-hook-form` | Form state and input validation |

```bash
npm install zustand @tanstack/react-query axios i18next react-i18next react-hook-form
```

---

### 7. Gestures & Worklets
| Package | Purpose |
| :--- | :--- |
| `react-native-gesture-handler` | Native touch and swipe gestures |
| `react-native-reanimated` | 60/120fps UI animations (glow rings, audio visualizer pulses) |
| `react-native-worklets` | Worklet execution thread |

```bash
npx expo install react-native-gesture-handler react-native-reanimated react-native-worklets
```

---

## All-In-One Scratch Install Command

If you are initializing a fresh clone or setting up on a new machine, you can run:

```bash
# 1. Native & Expo modules
npx expo install expo-camera expo-audio expo-image expo-image-manipulator expo-sqlite expo-secure-store expo-crypto expo-asset react-native-screens react-native-safe-area-context react-native-gesture-handler react-native-reanimated react-native-svg react-native-worklets

# 2. Application & UI libraries
npm install @react-navigation/native @react-navigation/native-stack react-native-paper @expo/vector-icons zustand @tanstack/react-query axios i18next react-i18next react-hook-form lottie-react-native react-native-qrcode-svg
```

---

## Directory Structure

```
frontend/
├── App.tsx                          # App entry with PaperProvider, QueryClient, and DB init
├── app.json                         # Expo configuration (permissions, plugins, keyboard modes)
├── package.json                     # Dependencies and scripts
├── src/
│   ├── app/                         # Navigators & Role routing
│   │   ├── RootNavigator.tsx        # Auth gate (Unauthenticated / Artisan / Coordinator)
│   │   ├── ArtisanStack.tsx         # Artisan workflow stack with "Karigari Connect" header
│   │   └── CoordinatorStack.tsx     # Coordinator verification and export stack
│   ├── components/                  # Shared accessible components
│   │   ├── BottomDock.tsx           # Floating action dock pinned above keyboard & insets
│   │   ├── StepHeader.tsx           # Step counter, progress bar & craft step title
│   │   ├── ConfidenceDot.tsx        # Visual AI confidence indicator
│   │   ├── ErrorRetryCard.tsx       # Recoverable error card with retry triggers
│   │   └── ProcessingIndicator.tsx  # Accessible loading spinner with localized hints
│   ├── features/                    # Modular feature screens
│   │   ├── onboarding/              # Role selection & sign in
│   │   ├── my-listings/             # Artisan listings dashboard with metric cards & filters
│   │   ├── capture/                 # Camera capture with flashlight, framing & X-mark removal
│   │   ├── image-review/            # AI studio image comparison & primary cover selector
│   │   ├── speak/                   # Voice story recorder with native Kannada/Hindi selection
│   │   ├── confirm-details/         # Extracted taxonomy review with craft placeholders
│   │   ├── price/                   # Minimum wage protection & recommended price calculator
│   │   ├── submit-approval/         # Verification summary & coordinator submission
│   │   ├── coordinator-review/      # Coordinator claims review & verification dashboard
│   │   └── publish-export/          # ONDC/GeM export generation with QR certificate
│   ├── i18n/                        # Internationalization translations
│   │   ├── index.ts                 # i18next configuration
│   │   └── locales/                 # JSON dictionaries for en, hi, kn
│   ├── services/                    # Networking & storage services
│   │   ├── api.ts                   # Production REST endpoints
│   │   ├── mockApi.ts               # Standalone local simulator for offline testing
│   │   ├── database.ts              # SQLite database initialization and draft operations
│   │   └── outbox.ts                # Offline transactional queue sync processor
│   ├── store/                       # Zustand stores
│   │   ├── authStore.ts             # Role authentication & persistent token hydration
│   │   └── draftStore.ts            # Active draft UUID tracker
│   ├── theme/                       # Color system & spacing rules
│   │   ├── colors.ts                # Terracotta (#B84A2A), Indigo (#243354), Bone White (#F9F7F4)
│   │   └── spacing.ts               # 48dp touch target rules and layout scale
│   └── types/                       # TypeScript contracts & schemas
│       ├── contracts.ts             # Listing, Catalogue, and Pricing interfaces
│       └── navigation.ts            # Stack param route list types
```

---

## Key System Behaviors

### 1. Integer Paise Standard for Pricing
All monetary amounts are stored and transmitted as **integer paise** (e.g., `140000` paise = ₹1,400.00). Avoid floating-point arithmetic to prevent currency rounding errors.

### 2. Offline-First Resilience
- All drafts are stored in local SQLite (`expo-sqlite`) immediately upon creation.
- Network mutations write to the `outbox` table first. When internet connectivity resumes or the user pulls down to refresh, `processOutbox()` automatically synchronizes pending drafts.

### 3. Keyboard Protection & Bottom Dock
- Android software keyboard mode is set to `resize` in `app.json`.
- All primary action buttons are docked using [`BottomDock.tsx`](file:///Users/avinav/projects/karigari-connect/frontend/src/components/BottomDock.tsx), ensuring buttons remain visible as an overlay right above the keyboard.

---

## Verification & Type Check

To ensure zero TypeScript errors before committing or building:

```bash
npx tsc --noEmit
```
