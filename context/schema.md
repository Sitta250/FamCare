# FamCare — Database Schema

## Core Design Decisions
- Every `User` is identified by `lineUserId` — this is the single identity across LINE bot, iOS app, and backend
- `FamilyMember` is always owned by one `User` (the account owner) — accounts are not merged
- `FamilyAccess` grants a second user (Caregiver or Viewer) access to specific family members only — not the whole account
- `addedByUserId` on all child records tracks who created the entry — owner can review and delete caregiver additions
- Owner access is implicit — no `FamilyAccess` row needed for the owner themselves

---

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String   @id @default(cuid())
  lineUserId    String   @unique
  displayName   String
  photoUrl      String?
  phone         String?
  createdAt     DateTime @default(now())

  familyMembers  FamilyMember[]  @relation("OwnedMembers")
  addedMembers   FamilyMember[]  @relation("AddedMembers")
  accessGranted  FamilyAccess[]  @relation("GrantedBy")
  accessReceived FamilyAccess[]  @relation("GrantedTo")
}

model FamilyMember {
  id          String   @id @default(cuid())
  ownerId     String
  addedById   String
  name        String
  relation    String   // "mother", "father", "self", "child", etc.
  dateOfBirth DateTime?
  bloodType   String?
  allergies   String?  // free text
  conditions  String?  // free text chronic conditions
  photoUrl    String?
  createdAt   DateTime @default(now())

  owner        User           @relation("OwnedMembers", fields: [ownerId], references: [id])
  addedBy      User           @relation("AddedMembers", fields: [addedById], references: [id])
  accessList   FamilyAccess[]
  appointments Appointment[]
  medications  Medication[]
  healthMetrics HealthMetric[]
  documents    Document[]
  symptomLogs  SymptomLog[]
}

model FamilyAccess {
  id                String     @id @default(cuid())
  grantedByUserId   String
  grantedToUserId   String
  familyMemberId    String
  role              AccessRole
  createdAt         DateTime   @default(now())

  grantedBy    User         @relation("GrantedBy", fields: [grantedByUserId], references: [id])
  grantedTo    User         @relation("GrantedTo", fields: [grantedToUserId], references: [id])
  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id])

  @@unique([grantedToUserId, familyMemberId])
}

model Appointment {
  id             String            @id @default(cuid())
  familyMemberId String
  addedByUserId  String
  title          String
  appointmentAt  DateTime
  doctor         String?
  hospital       String?
  reason         String?
  preNotes       String?
  postNotes      String?
  status         AppointmentStatus @default(UPCOMING)
  createdAt      DateTime          @default(now())

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id])
  reminders    Reminder[]
}

model Reminder {
  id            String       @id @default(cuid())
  appointmentId String
  type          ReminderType
  scheduledAt   DateTime
  sent          Boolean      @default(false)

  appointment Appointment @relation(fields: [appointmentId], references: [id])
}

model Medication {
  id             String   @id @default(cuid())
  familyMemberId String
  addedByUserId  String
  name           String
  dosage         String?
  frequency      String?  // "twice daily", "every 8 hours", etc.
  instructions   String?
  startDate      DateTime?
  endDate        DateTime?
  quantity       Int?
  photoUrl       String?
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())

  familyMember FamilyMember   @relation(fields: [familyMemberId], references: [id])
  logs         MedicationLog[]
}

model MedicationLog {
  id             String            @id @default(cuid())
  medicationId   String
  loggedByUserId String
  status         MedicationStatus
  takenAt        DateTime
  createdAt      DateTime          @default(now())

  medication Medication @relation(fields: [medicationId], references: [id])
}

model HealthMetric {
  id             String      @id @default(cuid())
  familyMemberId String
  addedByUserId  String
  type           MetricType
  value          Float
  unit           String
  note           String?
  measuredAt     DateTime
  createdAt      DateTime    @default(now())

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id])
}

model Document {
  id             String       @id @default(cuid())
  familyMemberId String
  addedByUserId  String
  type           DocumentType
  cloudinaryUrl  String
  ocrText        String?
  createdAt      DateTime     @default(now())

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id])
}

model SymptomLog {
  id             String   @id @default(cuid())
  familyMemberId String
  addedByUserId  String
  description    String
  severity       Int      // 1-10
  note           String?
  loggedAt       DateTime
  createdAt      DateTime @default(now())

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id])
}

// Enums

enum AccessRole {
  CAREGIVER
  VIEWER
}

enum AppointmentStatus {
  UPCOMING
  COMPLETED
  CANCELLED
  MISSED
}

enum ReminderType {
  SEVEN_DAYS
  TWO_DAYS
  ONE_DAY
  TWO_HOURS
}

enum MedicationStatus {
  TAKEN
  MISSED
  SKIPPED
}

enum MetricType {
  BLOOD_PRESSURE
  BLOOD_SUGAR
  WEIGHT
  TEMPERATURE
  CUSTOM
}

enum DocumentType {
  PRESCRIPTION
  LAB_RESULT
  DOCTOR_NOTE
  BILL
  XRAY
  OTHER
}
```

---

## Access Control Logic

When a request comes in, the backend checks access in this order:

1. Is `lineUserId` the owner of this `FamilyMember`? → Full access
2. Does a `FamilyAccess` row exist for this user + this member?
   - `CAREGIVER` → can read and write
   - `VIEWER` → can read only
3. Neither → 403 Forbidden

This check lives in a single middleware/service function and is called before every family member data operation.

---

## Notification Triggers

| Event | Who gets notified |
|-------|------------------|
| Caregiver adds any record | Owner gets LINE push |
| Appointment reminder fires | Owner + all Caregivers for that member |
| Medication missed | Owner + all Caregivers (if owner has enabled) |
| New FamilyAccess invite sent | Invitee gets LINE push |
