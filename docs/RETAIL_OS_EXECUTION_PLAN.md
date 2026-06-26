# Retail OS: Comprehensive Wiring & Execution Plan

This document serves as our master roadmap. It defines exactly how each of the system's components communicate ("the wiring") and provides a strict, sequenced step-by-step plan for building the rest of the application.

---

## PART 1: THE WIRING (System Communication Map)

To ensure this system works seamlessly offline and online, we must be very specific about how data flows between the four main entities: **Backend**, **POS App**, **Stocktake App**, and **Dashboard**.

### 1. Flutter POS ↔ Backend (The Sync Flow)
*   **Offline First**: The POS app communicates primarily with its local SQLite database (using Drift).
*   **The Sync Queue**: Every mutation (sale, stock ingestion, transfer) is written to a local `sync_queue` table with a sequence number.
*   **The Sync Worker**: A background isolate in Flutter monitors internet connectivity. When online, it pushes the queue to `POST /sync/push` on the backend.
*   **Mobile Money Flow**: POS sends request to backend -> Backend sends USSD push to customer -> Backend receives webhook from MTN/Airtel -> POS polls backend or receives socket event to print receipt.

### 2. Flutter POS ↔ Hardware
*   **Scanner Gun**: Operates as a Human Interface Device (HID). To the POS, a scan is simply rapid keyboard input followed by an "Enter" keystroke. We will capture this stream in Flutter without needing special drivers.
*   **Thermal Printer**: Connects via Bluetooth or USB. We bypass system print drivers entirely. The Flutter app generates raw **ESC/POS byte commands** (defining text size, bolding, and QR code rendering) and sends them directly to the printer port.

### 3. Stocktake App ↔ Backend
*   **Connection**: Since the stocktake app is used intermittently by roaming staff, it is a Progressive Web App (PWA) built in Vite.
*   **Caching**: Uses `IndexedDB` to cache the expected stock list.
*   **Scanning**: Uses HTML5 WebRTC (`html5-qrcode`) to access the device camera. For RFID, it accepts HID keyboard input from a paired Bluetooth wand.
*   **Committing**: Scanned serials are held in local state. When the user hits "Commit", a single payload is sent to `POST /stocktake/commit`.

### 4. Owner Dashboard ↔ Backend
*   **Connection**: Strictly online. Built with Next.js and the Refine framework.
*   **Data Provider**: Uses `@refinedev/medusa` to instantly hook into our MedusaJS backend admin endpoints.
*   **Real-time**: We will use React Query for automatic polling/refetching so the owner sees the dashboard metrics update live as stock comes in.

---

## PART 2: THE EXECUTION PHASES (Step-by-Step)

We will build from the inside out: Backend -> Dashboard (Visibility) -> POS (Action) -> Stocktake (Auditing).

### PHASE 1: Backend Finalization (The Anchor)
*We have the architecture, but we need the database to physically exist and be populated with test data.*
1.  **Database Migrations**: Generate and run MedusaJS migrations for our custom models (`SerialTracking`, `SyncQueue`, `Stocktake`, `AuditTrail`).
2.  **Row-Level Security (RLS)**: Write and apply the raw SQL migrations to enforce tenant isolation on all tables.
3.  **Seed Data Engine**: Write a robust script (`dev-seed.ts`) that generates 3 test stores, 50 dummy products, and 1,000 active serial numbers. *We cannot build the frontend without realistic data to query.*

### PHASE 2: Owner Dashboard (Visibility)
*Before we build the complex POS, we need a way to easily "see" the database to verify the POS is working.*
1.  **Initialize Next.js + Refine**: Scaffold the dashboard project.
2.  **Authentication**: Wire up standard login to Medusa.
3.  **Core Views**: 
    *   Build the **Inventory Matrix** (Rows: Variants, Cols: Locations).
    *   Build the **Audit Trail** table (to watch POS transactions come in).
4.  **Analytics**: Build the KPI cards (Sales Today, Missing Stock).

### PHASE 3: Flutter POS (The Workhorse)
*This is the most complex component and the heart of the system.*
1.  **Foundation**: Initialize Flutter, setup Riverpod (state management), and configure Drift (SQLite).
2.  **UI Layout**: Build the tablet split-screen (Left: Grid Catalog, Right: Active Cart).
3.  **Checkout Flow**: Implement the logic to scan a serial -> add to cart -> total -> Cash/MoMo selection.
4.  **Offline Sync Engine**: Build the sequence-based queue and the background sync worker.
5.  **Hardware Printing**: Implement the ESC/POS label generator (Product Name, Size, Price, QR code) and receipt printer.
6.  **ZRA Crypto**: Implement local offline signing for receipts.

### PHASE 4: Stocktake App (The Auditor)
*Fast, efficient counting.*
1.  **Foundation**: Initialize Vite + React.
2.  **Scanning Interface**: Build the large circular "Start Scan" button and integrate the camera/barcode input.
3.  **Reconciliation Logic**: Build the engine that compares the scanned list against the cached expected list and categorizes them into Matched (Green), Missing (Red), and Unexpected (Amber).

### PHASE 5: End-to-End Polish & Testing
1.  Full loop test: Add stock on POS -> print label -> sell item -> see on Dashboard -> run Stocktake.
2.  Network failure testing (disconnecting POS, doing 5 sales, reconnecting, verifying sync).
