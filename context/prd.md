# FamCare — Product Requirements Document

> **For AI coding assistants (Claude, Cursor):** This is the single source of truth for the FamCare product. Reference this file for all feature decisions, architecture choices, naming conventions, and scope boundaries.

---

## What Is FamCare?

A **LINE-based family health coordination bot** with a companion web dashboard. It helps Thai families (35–50 year old parents) track medications, appointments, and health records for multiple generations — elderly parents, children, and themselves — all within LINE, the app they already use daily.

**Core insight:** Thai families manage healthcare for 2–6+ people across generations. No tool exists that does this in Thai, in LINE, with shared family access.

---

## Target User

| Attribute | Detail |
|-----------|--------|
| Primary user | Thai parent, 35–50 years old |
| Location | Thai cities, online-first |
| Income | Middle to upper-middle class |
| Tech level | Daily LINE user, not tech expert |
| Family managed | 2–6+ members across generations |
| Pain point | "Can't keep track of medications and appointments for my whole family" |
| Current solution | Messy notes app, unshared with family |
| Willingness to pay | ฿99/month for unlimited family + full features |

### Three Personas

**Persona 1 — Admin/Primary Caregiver** (core user)
- 40-year-old working mother
- Manages: her elderly parents (70+), her kids, herself
- Overwhelmed, feels guilty when things slip
- Uses LINE daily, keeps disorganized phone notes
- Role in app: **Admin** (full control)

**Persona 2 — Secondary Family Member**
- 38-year-old husband/sibling
- Wants to stay informed, help when needed, not manage everything
- Always asking "when's the next appointment?"
- Role in app: **Caregiver** or **Viewer**

**Persona 3 — Tech-Savvy Elder**
- 65-year-old grandmother with diabetes + hypertension
- Uses LINE independently, already sends photos to family
- Forgets which pill when, confuses doctor instructions
- Role in app: Can be tracked by others OR input her own data

---

## Product Vision

**Mission:** Help Thai families prevent health crises by making it effortless to track and coordinate care across multiple family members.

**Positioning:** The family health coordination assistant that lives in LINE — no new app to learn, just chat naturally in Thai.

---

## Roles & Access Control

Each user has their own independent account. There is no shared family pool. A user owns their own `FamilyMember` records and can invite others to access specific members only.

| Role | Permissions |
|------|-------------|
| **Owner** (implicit) | Full control over their own account and all family members they created. Can delete anything including entries added by caregivers. |
| **Caregiver** (invited) | Can add and edit data for the specific family members they were granted access to. Cannot access the owner's other family members. |
| **Viewer** (invited) | Read-only access to specific family members they were granted access to. |

- Access is per family member, not per account — a sibling can be Caregiver for "Dad" without seeing the owner's kids
- Owner is notified via LINE push whenever a Caregiver adds any record
- Owner can revoke access at any time
- See `SCHEMA.md` for the `FamilyAccess` table implementation

---

## MVP Features (Build These)

### 1. Family Member Profiles
- Add unlimited family members (elders, children, self)
- Profile fields: name, age, photo, blood type, allergies, chronic conditions
- Members can span households (siblings in different cities share same parent's data)

### 2. Appointment Management
- Add: date, time, doctor, hospital, reason, pre-appointment notes
- Views: upcoming list + calendar
- Actions: edit, cancel, reschedule, mark completed with post-visit notes

### 3. Smart Appointment Reminders
- 1 week before → 2 days before → 1 day before → 2 hours before
- LINE push notifications (not just in-chat messages)
- Customizable reminder timing per appointment

### 4. Medication Tracking
- Profile per medication: name (Thai/English), dosage, frequency, start/end date, instructions, photo
- Daily reminders: "Time to take [medicine]"
- Tap-to-confirm: "Did you take it?"
- Missed dose alert: notify caregiver when elder misses dose (admin-configurable)
- Refill reminders based on quantity/duration

### 5. Health Documentation
- Photo uploads: prescriptions, lab results, doctor notes, medical bills, X-rays
- Auto-organized by date and family member
- OCR: extract text from Thai and English documents
- Search by date, keyword, or member

### 6. Health Metrics Logging
- Track: blood pressure, blood sugar, weight, temperature
- Custom metrics for specific conditions
- Trend graphs in web dashboard
- Flag abnormal values

### 7. Symptom & Notes Log
- Quick entry: "Grandma has a headache today"
- Severity scale 1–10
- Free text, photo, or voice note attachment
- Timeline view of all entries

### 8. Emergency Info Card
- One-tap access: allergies, medications, conditions, emergency contacts, blood type, preferred hospital
- Share as image instantly in LINE
- Accessible in web app even if LINE is down

### 9. Pre-Appointment Report
- Auto-generated summary before each doctor visit:
  - Symptoms since last visit
  - Medication adherence
  - Health metric trends
  - Suggested questions for doctor
- Export as PDF or image to share in LINE

### 10. Family Coordination (Group Chat)
- See who's taking a family member to an appointment
- Volunteer or assign caregiving tasks
- Shared family calendar
- Configurable notifications: who gets notified for what event

### 11. Communication Modes
- Private 1-on-1 chat with bot (data stays private)
- Group chat mode: family sees updates based on assigned roles
- Natural conversational Thai language interface
- Voice message support → converted to text for logging

---

## Out of Scope for MVP

These are explicitly **deferred to Version 2** or later. Do not build these in MVP:

- ❌ Physical QR emergency cards
- ❌ Insurance claim tracking
- ❌ Doctor video calls / telemedicine
- ❌ Medicine delivery integration
- ❌ Hospital system integration (auto-fetch records)
- ❌ AI health advice or predictions
- ❌ Medication interaction warnings
- ❌ Native iOS/Android apps (build only if web dashboard shows demand)

---

## Architecture & Tech Stack

### Phase 1 — LINE Bot MVP (Months 1–2)

All user interactions happen in LINE:
- LINE Messaging API for all inputs/outputs
- Natural Thai language conversation
- Rich Menus for quick actions
- Flex Messages for structured data display
- LINE Notify for push reminders

**Example conversation flow:**
```
User:  "ยายนัดหมอพรุ่งนี้ 2 โมง"
Bot:   "บันทึกนัดหมอให้คุณยายแล้ว
        วันที่: พรุ่งนี้ 11 เม.ย. 2026
        เวลา: 14:00 น.
        [เพิ่มหมอ] [เพิ่มโรงพยาบาล] [เสร็จแล้ว]"
```

### Phase 2 — Web Dashboard (Months 3–4)

- React or Next.js, mobile-first responsive
- Login via LINE account (no separate credentials)
- Dashboard: all family members' health status at a glance
- Calendar: all appointments across all members
- Charts: health metric trends (Recharts or Chart.js)
- PDF report generator
- Photo/document gallery
- Settings: members, roles, privacy, notifications
- Real-time sync: LINE ↔ web dashboard

### Phase 3 — Native Apps (Month 5+, conditional)

Only build if web dashboard analytics show demand. Would add offline mode and better performance.

### Tech Stack

| Layer | Options |
|-------|---------|
| Backend | Node.js or Python |
| Database | PostgreSQL or Firebase |
| File storage | AWS S3 or Firebase Storage |
| Hosting | Railway, Render, or AWS |
| Frontend | React or Next.js |
| LINE integration | LINE Messaging API, LINE Notify, LINE Login |
| Development | Cursor + Claude Code (AI-assisted, solo founder) |

---

## Business Model

### Freemium

**Free tier:**
- Up to 2 family members
- Last 3 months of history
- All core features

**Premium — ฿99/month:**
- Unlimited family members
- Unlimited history
- Advanced reports
- Data export
- Priority support

**Annual — ฿990/year** (2 months free)

### Launch Pricing Strategy
- Months 1–3: 100% free, no limits (build user base + get feedback)
- Month 4: Introduce freemium model
- Target: 5% free-to-premium conversion

---

## Success Metrics

MVP is successful when **all 3** criteria are met:

| Metric | Target |
|--------|--------|
| Active users (used in last 30 days, ≥1 family member, ≥1 appointment or medication logged) | 2,000 within 6 months |
| Appointment attendance rate (completed vs missed) | ≥90% |
| Premium conversion rate | ≥5% → ~100 paying users → ฿9,900 MRR |

### Kill Criteria (stop the project if):
- < 500 active users after 6 months
- Users add data but don't return (no retention)
- < 2% premium conversion

---

## Go-to-Market

| Phase | Activity |
|-------|----------|
| Months 1–2 | Friends & family beta (10–20 families), fix bugs, collect testimonials |
| Months 3–4 | Public LINE launch, Thai parenting Facebook groups, Pantip forums, word-of-mouth referral system |
| Months 5–6 | Outreach to small clinics, senior centers, pharmacies |
| Post 6 months | Hospital white-label partnerships, insurance company pilots, corporate wellness |

---

## PDPA Compliance (Thailand)

FamCare handles health data — PDPA compliance is required from day one.

**Requirements:**
- Explicit consent at onboarding: "We'll store your family's health data. Agree?"
- Clear privacy policy: what's collected, how it's used, who can see it
- Users can access, edit, and delete all their data
- Delete account = delete all data (hard delete)
- Encrypted database storage
- Data breach notification within 72 hours
- No selling or sharing data with third parties without explicit consent

---

## Competitive Positioning

| Competitor | Weakness | FamCare Advantage |
|------------|----------|-------------------|
| Hospital apps (Bumrungrad, etc.) | Siloed to one hospital | Works across all hospitals |
| MyDoc, Doctor Raksa | Individual-focused, not family | Multi-member, multi-generation |
| Medisafe | English only, no LINE, no family features | Thai language, LINE-native, family-centric |
| Any LINE bot | None specialise in family health coordination | First mover in this specific niche |

**Market gap:** No Thai LINE-based family health coordination tool exists that tracks multiple generations with shared role-based access.

---

## Development Milestones

### Milestone 1 — LINE Bot MVP (End of Month 2)
- [ ] LINE Official Account set up
- [ ] Database schema: family members, appointments, medications, health metrics, documents
- [ ] Core bot: add family member, add appointment, send reminder
- [ ] Medication tracking + tap-to-confirm
- [ ] Photo upload + OCR
- [ ] Role-based access (Admin/Caregiver/Viewer)
- [ ] Group chat coordination
- [ ] Emergency info card
- [ ] **Target: 20–50 beta users**

### Milestone 2 — Web Dashboard (End of Month 4)
- [ ] LINE Login integration
- [ ] Dashboard (all family members at a glance)
- [ ] Calendar view (all appointments)
- [ ] Health metric graphs
- [ ] PDF report generator
- [ ] Photo gallery
- [ ] Real-time LINE ↔ web sync
- [ ] **Target: 200–500 users**

### Milestone 3 — Growth (End of Month 6)
- [ ] Freemium model launched (Month 4)
- [ ] Referral system live
- [ ] First clinic partnership
- [ ] **Target: 2,000 active users, 100 paying customers**

---

## Core Product Principles

1. **LINE-First** — most interactions happen in LINE where users already are
2. **Family-Centered** — built for multi-generational care, not individuals
3. **Thai-Optimized** — Thai language, Thai healthcare context, Thai family culture
4. **Zero Learning Curve** — feels like chatting with a friend, not using software
5. **Privacy Flexible** — private when needed, shared when helpful
6. **Proactive, Not Reactive** — reminds before problems happen
7. **Simple Over Complete** — MVP does a few things excellently rather than many things poorly
