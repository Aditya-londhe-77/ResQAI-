# ResQAI Visual Redesign — Humanitarian Operations Theme

## Goal

Redesign the entire ResQAI frontend from its current dark sci-fi glassmorphism aesthetic to a professional humanitarian operations theme inspired by UN situation reports, Red Cross field dashboards, and emergency briefing documents. **All existing Firebase logic, state management, routing, and feature functionality must remain 100% intact.**

---

## Design System Summary

| Token | Value | Purpose |
|-------|-------|---------|
| `--bg-page` | `#F5F2EB` | Warm off-white page background |
| `--bg-card` | `#FFFFFF` | Pure white cards/panels |
| `--bg-surface` | `#EEF0F3` | Cool light gray secondary surfaces |
| `--primary` | `#0072BC` | UN Blue — primary actions, links |
| `--danger` | `#CC0000` | Red Cross red — critical alerts |
| `--success` | `#2A7A4B` | Forest green — resolved states |
| `--warning` | `#C97A00` | Amber — moderate severity |
| `--ink` | `#1A1A1A` | Ink black — headings |
| `--text-body` | `#3D3D3D` | Body text |
| `--text-muted` | `#6B6B6B` | Secondary labels |
| `--border` | `#D4D0C8` | All card/panel borders (1px solid) |
| Font Headings | IBM Plex Serif Bold | All titles and section headers |
| Font UI | IBM Plex Sans | Body, labels, buttons |

**No drop shadows on cards** — depth comes from `#FFFFFF` cards on `#F5F2EB` background.

**Status strips**: Left 4px borders instead of badges — `#CC0000` critical, `#C97A00` moderate, `#2A7A4B` resolved, `#0072BC` assigned/active.

**Buttons**: 44px height, 4px border-radius, tactile `box-shadow: 0 2px 0 rgba(0,0,0,0.08)`.

---

## Open Questions

> [!IMPORTANT]
> **Map tile style**: The spec calls for Leaflet with CartoDB Positron tiles. The current Map.jsx uses a different provider. I will update the tile URL. Confirm if this is acceptable.

> [!NOTE]
> **Google Fonts**: IBM Plex Serif + IBM Plex Sans will be imported from Google Fonts via the CSS `@import`. This requires internet access at runtime (already the case for Firebase).

> [!NOTE]
> **No admin registration** on the auth page — this is already the case (the current form has no admin option). No change needed there.

---

## Proposed Changes

### Design System Foundation

#### [MODIFY] [index.css](file:///e:/ResQAI/src/index.css)

Complete replacement of the CSS design system:
- New `:root` variables (parchment, UN Blue, Red Cross Red, forest green, amber)
- IBM Plex Serif + IBM Plex Sans Google Fonts import
- Warm off-white `body` background with no dot grid
- All card/stat-card styles: white background, 1px `#D4D0C8` border, no shadows
- Sidebar/left-nav: white background, 1px right border, blue active strips
- Buttons: 44px height, flat with bottom tactile shadow
- Table row styles: 44px height, alternating rows
- Severity bar: gradient `#CC0000 → #C97A00 → #2A7A4B`, animated 400ms
- Floating alert: parchment background, 3px red top border strip
- Auth page: centered layout (no hero/form split), card-based with underline tabs
- Role badge: text labels with colored left strip or inline colored tag
- All form fields: white fill, `#D4D0C8` border, focus ring in UN Blue
- Leaflet popup override: white card with serif headers
- Responsive: same structural breakpoints preserved

---

### Components

#### [MODIFY] [TabBar.jsx](file:///e:/ResQAI/src/components/TabBar.jsx)
- Sidebar stays 220px, white background, `1px solid #D4D0C8` right border
- **ResQAI** wordmark in IBM Plex Serif Bold (no gradient)
- "ADMIN" label for admin (red uppercase 11px) or role label in smaller text
- Nav items: active state has **3px left blue border** + blue text (not glow/shadow)
- Footer: `Powered by AI Intelligence` in 11px muted text

#### [MODIFY] [Navbar.jsx](file:///e:/ResQAI/src/components/Navbar.jsx)
- Header bar: white background, `1px solid #D4D0C8` bottom border
- Left: ResQAI wordmark + page title in serif
- Right: role badge + user name + logout button
- Role-color top strip: 3px colored bar below header (blue=citizen, green=NGO, blue=volunteer)

#### [MODIFY] [SeverityBar.jsx](file:///e:/ResQAI/src/components/SeverityBar.jsx)
- Background: `#E5E3DC`
- Fill gradient: `#CC0000` at 100% → `#C97A00` at 50% → `#2A7A4B` at 0%
- Animated width transition `400ms ease`
- Percentage label shown right-aligned above bar in 12px uppercase

#### [MODIFY] [StatCard.jsx](file:///e:/ResQAI/src/components/StatCard.jsx)
- White card, `1px solid #D4D0C8` border, no shadow
- Serif bold 32px number value
- 13px uppercase label
- Delta indicator: small green/red arrow (optional, prop-based)
- Remove gradient text effects

#### [MODIFY] [FloatingAlert.jsx](file:///e:/ResQAI/src/components/FloatingAlert.jsx)
- Full-width sticky bar (not floating bubble)
- Parchment `#F5F2EB` background with `3px solid #CC0000` top border
- Left: red warning icon + bold incident name + location
- Right: dismiss X button
- Multiple alerts stack (already single — no change to state logic)

#### [MODIFY] [Modal.jsx](file:///e:/ResQAI/src/components/Modal.jsx)
- White card, max 540px, centered with `rgba(0,0,0,0.35)` backdrop (no blur)
- Serif bold title
- `1px solid #D4D0C8` horizontal rule below title
- Action buttons right-aligned
- Escape to close

---

### Pages

#### [MODIFY] [Auth.jsx](file:///e:/ResQAI/src/pages/Auth.jsx)
- Remove left hero panel entirely — full-width centered layout on parchment background
- Top: ResQAI wordmark in IBM Plex Serif Bold + thin red `#CC0000` horizontal rule
- Tagline: "Coordinating relief when it matters most." in serif italic
- Auth card: white, 480px max, centered with underline tab switcher (Sign In / Register)
- Login form: email, password, full-width blue submit button
- Register form: role selector as bordered radio cards (Citizen / NGO / Volunteer) with icons
- Error: red-bordered inline alert box (already inline — keep pattern)
- All existing Firebase auth logic unchanged

#### [MODIFY] [Dashboard.jsx](file:///e:/ResQAI/src/pages/Dashboard.jsx)
- Apply new class names and inline style updates throughout for humanitarian theme
- Map tab: two-panel (65%/35%) with incident list using 4px left-strip severity
- Incident cards: white, left-strip severity, serif card titles, no glows
- NGO self-assign button: outline blue → optimistic "Assigned" green label
- Inventory tab: Grid of resource panels with serif headers, amber strip when quantity < 10
- Assignments tab: full-width cards with severity bars
- Tasks tab (volunteer): full-width cards with status strips
- Donate tab: structured form card with serif header, preset amount bordered radio buttons
- AI Scanner tab (remains from current dashboard — for NGO/admin): keep all logic, restyle card
- All state, Firebase calls, handlers preserved exactly

#### [MODIFY] [AdminDashboard.jsx](file:///e:/ResQAI/src/pages/AdminDashboard.jsx)
- Apply new class names throughout for humanitarian theme
- Sidebar (via TabBar): white, 220px, serif wordmark + "ADMIN" red label
- Overview: 5 stat panels with serif numbers, delta indicators (if available)
- Incidents: left sidebar list + right detail panel, both with severity strips
- NGOs tab: card grid with amber border for low-stock NGOs
- Volunteers tab: grouped by NGO cards
- AI Scanner: restyled card, purple accent preserved as accent only (not dominant)
- Map: full-screen with collapsible right panel
- All Firebase logic unchanged

---

### Map

#### [MODIFY] [Map.jsx](file:///e:/ResQAI/src/components/Map.jsx)
- Update tile URL to **CartoDB Positron** (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`)
- Incident markers: square pins (24px) with severity-colored flag
- Critical pins: slow pulse ring animation
- Leaflet popup: white card with serif headers, 1px border

---

## Verification Plan

### Visual Verification (Browser)
1. Open auth page → verify parchment background, serif wordmark, red rule, card layout
2. Login as citizen → verify blue role strip, sidebar with serif nav, map panel layout
3. Login as NGO → verify green role strip, inventory panels with amber strips at low qty
4. Login as volunteer → verify task cards with left-status strips
5. Login as admin → verify white sidebar with ADMIN label, stat cards with serif numbers
6. Trigger floating alert → verify full-width parchment strip with red top border
7. Open report modal → verify white card, serif title, horizontal rule

### Functional Regression (Must-Pass)
- Submit citizen report (with photo AI analysis) — must still work
- NGO self-assign to incident — must still work + optimistic UI green label
- Admin manual assign NGO — must still work
- AI scanner (admin) — must still work
- Mark task complete (volunteer) — must still work
- Donation form — must still work

### Build Verification
- `npm run dev` starts without errors
- No broken imports or missing class names
