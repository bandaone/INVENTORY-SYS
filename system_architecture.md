# How Retail OS Actually Works (System Architecture)

When this project first started, the original idea was to use **MedusaJS** as the backend. You still have a folder named `backend` that contains Medusa code. However, as we developed the system to be faster, cheaper to host, and specifically tailored for Zambian retail (multi-tenant SaaS), **we bypassed Medusa entirely.** 

Here is a simple, plain-English breakdown of exactly how your system is built today.

---

## 1. The Core Technology Stack

Your entire platform runs on two incredibly powerful, modern technologies:

1. **Next.js (Hosted on Vercel):** This is the brain and the face of your app. It handles both what the user sees (the buttons, the UI) AND the backend logic (processing payments, creating users). Because it does both, you don't need a separate Medusa server.
2. **Supabase (PostgreSQL Database):** This is the memory of your app. It stores every single product, sale, user, and tenant. Supabase uses a feature called **Row-Level Security (RLS)**, which acts like a bouncer at a club, ensuring that Store A can *never* accidentally see Store B's data.

---

## 2. Feature-by-Feature Breakdown

Instead of having three separate apps (Dashboard, POS, Stocktake) running on different servers, we combined everything into **one single Next.js application** to make it lightning fast and easy to maintain.

### A. The Super Admin Portal (`/superadmin`)
* **Who uses it:** You (Dennis).
* **How it works:** When you log in with your super admin email, Next.js checks your role. Since you are the platform owner, it bypasses the Row-Level Security (the bouncer) and lets you see *everything* across the entire database.
* **Features:**
  * **Tenant Management:** You can invite new store owners and see their business details.
  * **Revenue Pipeline:** It looks at how many active locations exist in the database, multiplies it by your 2,500 ZMW fee, and tracks which tenants owe you money.

### B. The Owner Dashboard (`/`)
* **Who uses it:** The Store Owner (your paying tenant).
* **How it works:** When an owner logs in, Supabase assigns them a `tenant_id` cookie. Every single time they ask for data (like "show me my products"), the database automatically filters the results so they ONLY see data matching their `tenant_id`. 
* **Features:**
  * **Onboarding Setup:** A wizard that collects their MTN MoMo numbers and ZRA details and saves them to `tenant_settings`.
  * **Catalog & Staff Management:** They can add products (garments/variants) and create PIN codes for their cashiers.

### C. The Point of Sale (POS) (`/pos`)
* **Who uses it:** Cashiers in the physical store.
* **How it works:** A cashier goes to the live URL on a tablet or phone. Instead of typing an email, they type their 4-digit PIN. The system verifies the PIN against the `staff` table for that specific tenant.
* **Features:**
  * **Shift Tracking:** When they log in, it creates an "Active Shift" in the database. Every sale they make is tied to that specific shift.
  * **Cart & Checkout:** They click products, which are added to a digital cart. When they check out, it records a transaction in the database and lowers the `stock_level` of those specific garments.

### D. The Stocktake / Inventory Scanner (`/operations`)
* **Who uses it:** Stock Clerks or Managers doing inventory counts.
* **How it works:** This is a mobile-friendly view designed for speed. 
* **Features:**
  * **Barcode Scanning:** They can use a phone camera or barcode scanner. When a barcode is scanned, Next.js asks the database to find the garment with that exact serial number.
  * **Discrepancy Reporting:** If the system says there are 10 dresses, but the clerk only scans 8, the system logs a "Shrinkage" report for the missing 2 dresses so the owner knows exactly what was stolen or lost.

---

## 3. Why This Is Better Than Medusa

1. **Massive Cost Savings:** Because Next.js Serverless Functions act as your backend, you only pay Vercel when the system is actually being used. Medusa requires a server running 24/7, which costs money even when stores are closed at night.
2. **True Multi-Tenancy:** Medusa is designed for a single brand (like Nike). It is very difficult to force Medusa to host 50 different independent stores safely. Supabase RLS was built exactly for this multi-store SaaS model.
3. **Simplicity:** If there is a bug, we only have to look in one codebase (the `dashboard` folder). If we used Medusa, we would have to debug the frontend, the backend, the Redis queue, and the event bus.

Your system is currently a perfectly optimized, modern SaaS machine. All the old, confusing code (Vite POS apps, Medusa backends) is essentially dead weight that we are ignoring because the Next.js app does it all flawlessly.
