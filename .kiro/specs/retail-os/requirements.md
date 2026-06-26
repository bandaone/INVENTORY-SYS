# Requirements Document

## Introduction

The Retail OS is a physical retail operating system for clothing stores. Its purpose is to ensure every garment on a rack has an exact matching digital record, and that every inventory event — sale, transfer, stocktake, or loss — is immediately reflected in that record. The system serves four user roles simultaneously: Owner, Store Manager, Cashier, and Stock Clerk.

The system is offline-first: all core operations continue without internet connectivity. It scales from a single stall to a 20-location chain under a multi-tenant SaaS model. It integrates with the Zambia Revenue Authority (ZRA) Smart Invoice standard and with MTN MoMo and Airtel Money mobile payment networks.

---

## Glossary

- **System**: The Retail OS platform as a whole.
- **POS**: Point-of-Sale application; the Flutter-based desktop/tablet app used at the cashier counter.
- **Stocktake_App**: The mobile web application used by Stock Clerks to scan and count inventory on the floor.
- **Owner_Dashboard**: The Next.js web portal used by the Owner/Manager for reporting and configuration.
- **Sync_Engine**: The background process responsible for replicating local SQLite data to cloud PostgreSQL and resolving conflicts.
- **Label_Printer**: A Bluetooth or USB thermal printer that produces garment labels in ESC/POS format.
- **Garment**: A single physical item of clothing tracked by the system.
- **Serial**: A unique alphanumeric identifier assigned to one Garment at the point of stock ingestion.
- **Variant**: A product definition combining name, color, and size (e.g., "Blue Polo Shirt — Large").
- **Label**: A printed tag attached to a Garment showing its product name, color, size, retail price, Serial number, and QR code.
- **QR_Code**: A machine-readable 2D barcode encoding the Serial, printed on the bottom half of a Label.
- **Cart**: The list of Garments and their prices assembled during a POS checkout session before payment.
- **Transaction**: A completed sale event with a unique receipt number, cashier, location, payment method, total, and optional ZRA invoice code.
- **Stock_Movement**: An immutable log record of any inventory status change (ingestion, sale, transfer, stocktake adjustment, loss).
- **Stocktake**: A scheduled or ad-hoc physical count of Garments in a defined area, reconciled against system records.
- **Transfer**: A recorded movement of one or more Garments from one Location to another.
- **Location**: A physical store or warehouse registered in the system (e.g., "Lusaka Main Branch").
- **Tenant**: A single retail business that subscribes to the Retail OS; all data is isolated per Tenant.
- **Owner**: A Tenant user with full access to all Locations, reports, staff management, and configuration.
- **Store_Manager**: A Tenant user with access to stock ingestion, label printing, and location-level reports.
- **Cashier**: A Tenant user with access only to the POS checkout and shift reconciliation screens.
- **Stock_Clerk**: A Tenant user with access only to the Stocktake App.
- **PIN**: A 4-digit numeric code used to authenticate staff on the POS and Stocktake App.
- **Float**: The cash amount placed in the cash drawer at the start of a Cashier shift.
- **ZRA**: Zambia Revenue Authority; the tax body requiring Smart Invoice compliance.
- **ZRA_Certificate**: A cryptographic certificate stored on-device used to sign receipts without internet.
- **Mobile_Money**: A mobile payment method using MTN MoMo or Airtel Money USSD push flows.
- **Payment_Adapter**: An interchangeable software module implementing the interface for a specific payment provider.
- **Offline_Queue**: A local ordered list of actions awaiting sync, ordered by sequence number.
- **RFID_Wand**: A premium Bluetooth RFID reader capable of reading hundreds of tags simultaneously.
- **Reorder_Threshold**: A per-Variant minimum stock level that triggers a reorder alert on the Owner Dashboard.
- **Shrinkage**: The value of Garments lost to theft, misplacement, or counting error, as tracked by the system.
- **Subscription_Tier**: One of three commercial service levels (Boutique Starter, Growth, Enterprise Fleet) with defined feature limits.

---

## Requirements

### Requirement 1: Garment Serial Assignment and Label Generation

**User Story:** As a Store Manager, I want every garment entered into the system to receive a unique serial number and a printed label, so that every physical item on the rack has an exact digital identity.

#### Acceptance Criteria

1. WHEN a Store Manager submits a new stock entry, THE System SHALL generate a globally unique Serial for each individual Garment unit in the batch.
2. THE System SHALL store each Serial linked to its Variant, Location, cost price, retail price, and status "In Stock" in the local SQLite database before sending a print command.
3. WHEN a Serial is generated, THE System SHALL record a Stock_Movement entry of type "Ingestion" with the timestamp, Store Manager identity, quantity, and Location.
4. THE Label_Printer SHALL receive ESC/POS print commands for each Label immediately after Serials are saved to the local database, without requiring an internet connection.
5. THE Label SHALL contain the product name, color, size, retail price, Serial number in human-readable text, and a QR_Code encoding the Serial.
6. IF the Label_Printer is unreachable at print time, THEN THE System SHALL queue the print jobs and display a notification, and SHALL retry automatically when the printer is detected again.
7. WHERE a Variant does not already exist in the system, THE System SHALL allow the Store Manager to create a new Variant by specifying name, category, cost price, retail price, and Reorder_Threshold before generating Serials.
8. THE Stock_Ingestion_Screen SHALL present a color/size quantity matrix grid so that a Store Manager can specify quantities for multiple size and color combinations in a single entry session.

---

### Requirement 2: QR Code and Barcode Scanning

**User Story:** As a Cashier or Stock Clerk, I want to scan a garment's QR code or barcode and have the system instantly identify it, so that manual data entry errors are eliminated.

#### Acceptance Criteria

1. WHEN a QR_Code or barcode is scanned on the POS, THE System SHALL resolve the Serial to its Variant, retail price, and status within 300 milliseconds using the local SQLite database.
2. IF a scanned Serial has status other than "In Stock", THEN THE POS SHALL display an error message stating the Serial and its current status, and SHALL NOT add the Garment to the Cart.
3. WHEN a QR_Code is scanned in the Stocktake_App, THE System SHALL record the Serial as "Counted" for the active Stocktake session within 300 milliseconds.
4. THE Stocktake_App SHALL support both camera-based QR scanning via the device browser and Bluetooth RFID_Wand input within the same scan session.
5. IF a scanned Serial is not found in the local database, THEN THE System SHALL classify it as "Unexpected" and display it in the amber category on the Stocktake results screen.
6. THE System SHALL accept input from a USB or Bluetooth scanner gun on the POS without requiring any driver installation beyond standard HID keyboard emulation.

---

### Requirement 3: Point-of-Sale Checkout

**User Story:** As a Cashier, I want to assemble a cart of scanned garments and complete a sale with cash or mobile money, so that every sale is recorded and the customer receives a receipt.

#### Acceptance Criteria

1. THE POS SHALL display a split-screen layout with a searchable product catalog grid on the left and the active Cart on the right.
2. WHEN a Garment is added to the Cart, THE POS SHALL display the Variant name, size, color, retail price, and running subtotal including applicable ZRA tax.
3. THE POS SHALL support three payment methods: Cash, Mobile_Money, and Split (partial cash and partial Mobile_Money) for any single Transaction.
4. WHEN the Cashier selects Cash payment, THE POS SHALL display a calculator popup for entering the tendered amount and SHALL show the change amount before confirming the Transaction.
5. WHEN a Cash Transaction is confirmed, THE System SHALL send an open-drawer signal to the connected cash drawer and SHALL print a receipt on the Label_Printer.
6. WHEN the Cashier selects Mobile_Money payment, THE POS SHALL prompt for the customer's phone number, initiate a USSD push via the appropriate Payment_Adapter, and wait for webhook confirmation before marking the Transaction complete.
7. IF a Mobile_Money webhook confirmation is not received within 60 seconds, THEN THE POS SHALL display a timeout prompt allowing the Cashier to retry, cancel, or switch to Cash payment.
8. WHEN a Transaction is completed, THE System SHALL update every Garment Serial in the Cart to status "Sold", record a Stock_Movement of type "Sale", and write a Transaction record with a unique receipt number to the local SQLite database.
9. WHEN the Cashier enters a Manual Item (an untagged garment without a QR code), THE POS SHALL allow entry of a description and price and SHALL include it in the Transaction without requiring a Serial.
10. WHILE the device has no internet connection, THE POS SHALL complete all Transaction operations using the local SQLite database and SHALL display an amber offline indicator in the status bar with the count of unsynced operations.
11. THE POS status bar SHALL display the logged-in Cashier's name, pending sync count, network status, and current time at all times during a shift.

---

### Requirement 4: ZRA Smart Invoice Compliance

**User Story:** As an Owner, I want every receipt to include a ZRA-compliant Smart Invoice signature, so that the business meets its legal tax obligations without depending on internet connectivity at the point of sale.

#### Acceptance Criteria

1. THE System SHALL store the ZRA_Certificate on the local device and SHALL use it to generate a cryptographic signature for each Transaction without requiring an internet connection.
2. WHEN a Transaction is completed, THE System SHALL generate a ZRA invoice code and embed it as a QR code on the printed receipt.
3. WHEN internet connectivity is available, THE Sync_Engine SHALL transmit queued ZRA invoice records to the ZRA gateway in the order they were generated, using the Serial sequence number to determine order.
4. IF the ZRA gateway returns a rejection for a queued invoice, THEN THE System SHALL flag the Transaction in the Audit_Trail with the rejection reason and SHALL notify the Owner via the Owner_Dashboard.
5. THE System SHALL allow the Owner to input and update ZRA credentials (certificate, taxpayer TIN) through the Settings screen of the Owner_Dashboard without requiring application redeployment.

---

### Requirement 5: Mobile Money Payment Integration

**User Story:** As a Cashier, I want to accept MTN MoMo and Airtel Money payments, so that customers who do not carry cash can complete purchases.

#### Acceptance Criteria

1. THE System SHALL support MTN MoMo and Airtel Money as Payment_Adapters, each implementing a common payment interface.
2. WHEN a Mobile_Money payment is initiated, THE Payment_Adapter SHALL send a USSD push request to the customer's phone number using the appropriate provider API.
3. WHEN the provider sends a payment confirmation webhook, THE Payment_Adapter SHALL validate the webhook signature and notify the POS to complete the Transaction.
4. IF the provider sends a payment failure webhook, THEN THE POS SHALL display the failure reason and return the Cart to an unpaid state without modifying any Serial statuses.
5. THE System SHALL allow the Owner to configure MTN MoMo and Airtel Money API credentials through the Settings screen without requiring application redeployment.
6. WHERE a new payment provider must be added, THE System SHALL support integration through a new Payment_Adapter module without modifying existing adapter code.

---

### Requirement 6: Offline-First Sync Engine

**User Story:** As an Owner, I want the system to work fully without internet and sync automatically when connectivity returns, so that operations are never interrupted by load shedding or poor connectivity.

#### Acceptance Criteria

1. THE System SHALL maintain a local SQLite database on every POS and Stocktake_App device that mirrors the schema of the cloud PostgreSQL database.
2. WHEN a user performs any action that modifies inventory or transaction data, THE Sync_Engine SHALL write the action to the local SQLite database first and assign it a monotonically increasing sequence number before acknowledging success to the user.
3. WHEN internet connectivity is restored, THE Sync_Engine SHALL replay the Offline_Queue to the cloud PostgreSQL database in sequence-number order.
4. WHEN the Sync_Engine detects a conflict where a Sale and a Stocktake_Adjustment affect the same Serial, THE Sync_Engine SHALL apply the Sale record and SHALL flag the Stocktake_Adjustment for manual review in the Owner_Dashboard.
5. WHEN the Sync_Engine detects a conflict where a Transfer and a Sale affect the same Serial from different Locations simultaneously, THE Sync_Engine SHALL flag the conflict as requiring manual review in the Owner_Dashboard and SHALL NOT auto-resolve it.
6. THE Sync_Engine SHALL use sequence numbers, not device timestamps, as the ordering mechanism for all queued actions to prevent clock-skew conflicts.
7. THE POS SHALL display the count of pending unsynced actions in the status bar and SHALL update this count in real time as sync progresses.

---

### Requirement 7: Stocktake (Inventory Count)

**User Story:** As a Stock Clerk, I want to scan all garments in an area and immediately see which items are missing or unexpected, so that shrinkage is identified quickly and accurately.

#### Acceptance Criteria

1. THE Stocktake_App SHALL allow the Stock Clerk to start a Stocktake session by selecting a Location and an optional sub-area before scanning begins.
2. WHEN a Stocktake session is active, THE Stocktake_App SHALL display a large active scanning button and SHALL continuously add scanned Serials to the session without requiring confirmation between scans.
3. WHEN RFID_Wand input is active, THE Stocktake_App SHALL read all RFID tag Serials within range simultaneously and SHALL deduplicate repeated reads of the same Serial within the same session.
4. THE Stocktake_App SHALL display scan results in three categories: Matched (green — Serial in database at this Location and status "In Stock"), Missing (red — Serial in database at this Location with status "In Stock" but not scanned), and Unexpected (amber — Serial scanned but not found in the database or associated with a different Location).
5. WHEN the Stock Clerk commits a Stocktake, THE System SHALL update the status of all Missing Serials to "Missing", record a Stock_Movement of type "Stocktake" for each affected Serial, and write the full session result to the Audit_Trail.
6. IF a Stocktake is committed for a Serial that was sold after the session began (confirmed via sync), THEN THE System SHALL reclassify that Serial as "Sold" rather than "Missing" in the committed results.
7. THE Stocktake_App SHALL function on any Android device browser using the device camera for QR scanning without requiring app installation.

---

### Requirement 8: Stock Transfer Between Locations

**User Story:** As a Store Manager, I want to transfer garments between locations with a full audit record, so that stock movements across the chain are always traceable.

#### Acceptance Criteria

1. THE Stock_Transfer_Screen SHALL allow the Store Manager to select a source Location and a destination Location from dropdowns before scanning begins.
2. WHEN a Garment Serial is scanned on the Stock_Transfer_Screen, THE System SHALL add it to the transfer list and SHALL display the Variant name, size, color, and current location for confirmation.
3. IF a scanned Serial's current Location does not match the selected source Location, THEN THE System SHALL display a warning and SHALL NOT add the Serial to the transfer list without explicit Store Manager override.
4. WHEN the Store Manager confirms a Transfer, THE System SHALL update the Location field of all listed Serials to the destination Location, update their status to "In Stock" at the new Location, and record a Stock_Movement of type "Transfer" for each Serial.
5. THE System SHALL record every Transfer with the initiating Store Manager's identity, timestamp, source Location, destination Location, and the full list of transferred Serials in the Audit_Trail.

---

### Requirement 9: Cashier Shift and Cash Reconciliation

**User Story:** As a Cashier, I want to open and close a shift with a formal cash reconciliation, so that any cash discrepancy is identified and logged at the end of every shift.

#### Acceptance Criteria

1. WHEN a Cashier starts a shift, THE POS SHALL require the Cashier to enter the opening Float amount, which is stored as the baseline for the shift's cash reconciliation.
2. THE End_of_Shift_Screen SHALL display the opening Float, total cash sales during the shift, and the expected closing cash total.
3. WHEN the Cashier enters the actual cash count at shift end, THE System SHALL compare it to the expected total and SHALL display a green confirmation if they match within K0.00 or a red discrepancy amount if they do not match.
4. WHEN the Cashier completes the shift, THE System SHALL log the opening Float, all cash sales, expected total, actual count, and discrepancy amount to the Cash_Drawer record and SHALL log the Cashier out.
5. THE System SHALL prevent a Cashier from processing new Transactions after the Complete_Shift button has been pressed without starting a new shift.

---

### Requirement 10: Owner Dashboard — Real-Time Metrics and Reporting

**User Story:** As an Owner, I want a browser-based dashboard that shows live sales, stock levels, and shrinkage across all my locations, so that I can manage the business remotely without being on site.

#### Acceptance Criteria

1. THE Owner_Dashboard SHALL display four summary metric cards: Today's Revenue, Active Stock Value, Items Sold Today, and Shrinkage This Month, updated within 60 seconds of each underlying event.
2. THE Owner_Dashboard SHALL display an hourly sales graph for the current day and a live transaction feed showing the most recent 20 Transactions across all Locations.
3. THE Owner_Dashboard SHALL provide an Inventory Matrix view with Variant rows and Location columns showing current stock quantities, with cells highlighted amber when stock is at or below 150% of the Reorder_Threshold and red when at or below the Reorder_Threshold.
4. WHEN stock for a Variant at any Location reaches or falls below the Reorder_Threshold, THE System SHALL display a reorder alert on the Owner_Dashboard.
5. THE Owner_Dashboard SHALL provide a Reports section with the following named reports: Best Sellers, Slowest Moving, Staff Performance, Stock Ageing, and Profit Margin, each filterable by Location and date range.
6. THE Owner_Dashboard SHALL provide an immutable Audit_Trail view showing a chronological log of every Stock_Movement, Transaction, Transfer, Stocktake, and staff configuration change, with no record deletable through the UI.
7. THE Owner_Dashboard SHALL be accessible from any modern browser on any device without requiring app installation.

---

### Requirement 11: Staff Management

**User Story:** As an Owner, I want to create and manage staff accounts with role-based access and PIN authentication, so that each staff member can only access the features relevant to their role.

#### Acceptance Criteria

1. THE System SHALL enforce four distinct roles with non-overlapping default permissions: Owner (all access), Store_Manager (stock ingestion, label printing, transfers, location reports), Cashier (POS checkout and shift reconciliation), and Stock_Clerk (Stocktake_App only).
2. THE System SHALL authenticate Cashiers and Stock Clerks on the POS and Stocktake_App using a 4-digit PIN, stored as a hashed value in the database.
3. WHEN an Owner creates a new staff account, THE System SHALL require a name, role, assigned Location, and 4-digit PIN.
4. THE Owner_Dashboard SHALL allow the Owner to deactivate a staff account, which SHALL immediately prevent that account from authenticating on any device, within one sync cycle.
5. IF a Cashier enters an incorrect PIN three times consecutively, THEN THE POS SHALL lock that Cashier out for 5 minutes and SHALL log the event to the Audit_Trail.
6. THE System SHALL prevent a deactivated staff account from appearing as an active user in any report or live feed.

---

### Requirement 12: Multi-Tenant Data Isolation

**User Story:** As an Owner of one retail business, I want my data to be completely isolated from other businesses using the platform, so that my stock, sales, and staff information is never visible to other tenants.

#### Acceptance Criteria

1. THE System SHALL assign every data record (Variants, Serials, Transactions, Staff, Locations) to exactly one Tenant at the time of creation.
2. THE System SHALL enforce PostgreSQL Row-Level Security policies so that no database query can return records belonging to a different Tenant, even if application-level filtering is bypassed.
3. THE System SHALL assign every API request to a Tenant context derived from the authenticated user's token before executing any database operation.
4. IF a request is received without a valid Tenant context, THEN THE System SHALL reject the request with a 401 Unauthorized response and SHALL NOT execute any database query.
5. THE System SHALL ensure that Tenant isolation applies to the Sync_Engine so that device sync operations can only read and write records belonging to the authenticated Tenant.

---

### Requirement 13: Subscription Tier Feature Enforcement

**User Story:** As the platform operator, I want each tenant's features to be limited by their subscription tier, so that the commercial model is enforced consistently.

#### Acceptance Criteria

1. THE System SHALL enforce the Boutique_Starter tier limit of 1 Location and 1 POS device per Tenant.
2. THE System SHALL enforce the Growth_Tier limit of 3 Locations per Tenant and SHALL enable Stock_Transfer and ZRA_Smart_Invoice features only at Growth_Tier and above.
3. THE System SHALL enable RFID_Wand support, unlimited Locations, and multi-warehouse Transfers only for Enterprise_Fleet tier Tenants.
4. WHEN a Tenant attempts to activate a feature or Location that exceeds their Subscription_Tier limit, THE System SHALL display a clear upgrade prompt identifying the required tier.
5. THE Owner_Dashboard Settings screen SHALL display the Tenant's current Subscription_Tier, active Location count, and active POS device count.

---

### Requirement 14: Hardware Connectivity — Label Printer and Scanner

**User Story:** As a Store Manager or Cashier, I want the system to communicate with a thermal label printer and barcode scanner without manual configuration, so that printing and scanning work reliably out of the box.

#### Acceptance Criteria

1. THE POS SHALL discover available Bluetooth label printers and display them in a device list during initial hardware setup without requiring manual IP or MAC address entry.
2. WHEN a label print job is sent, THE System SHALL format the print data as ESC/POS commands before transmitting to the Label_Printer via Bluetooth or USB.
3. IF a Bluetooth label printer connection is lost during a print job, THEN THE System SHALL retry the connection up to 3 times at 5-second intervals before marking the job as failed and queuing it for the next successful connection.
4. THE POS SHALL accept barcode and QR code input from a USB HID scanner gun without requiring any configuration beyond plugging in the device.
5. THE Stocktake_App SHALL pair with a Bluetooth RFID_Wand and SHALL provide a range sensitivity slider to allow the Stock Clerk to control the effective read radius to prevent scanning adjacent racks.

---

### Requirement 15: Audit Trail Integrity

**User Story:** As an Owner, I want every action in the system to be permanently logged with the actor's identity and timestamp, so that disputes and discrepancies can always be investigated.

#### Acceptance Criteria

1. THE System SHALL record a Stock_Movement entry for every change to a Serial's status or Location, including the actor's identity, sequence number, device ID, and timestamp.
2. THE Audit_Trail SHALL be append-only: THE System SHALL NOT provide any API endpoint or UI control that deletes or modifies an existing Stock_Movement or Audit_Trail record.
3. THE System SHALL record all staff authentication events (successful login, failed login, lockout) in the Audit_Trail with device ID and timestamp.
4. THE System SHALL record all configuration changes (staff edits, ZRA credential updates, Location changes) in the Audit_Trail with the Owner's identity and timestamp.
5. WHEN the Sync_Engine writes a queued action to the cloud database, THE System SHALL preserve the original sequence number and device ID from the local record, not the sync timestamp.

---

### Requirement 16: Inventory Serial Lifecycle and Status Management

**User Story:** As an Owner, I want each garment's status to transition through a defined lifecycle, so that the system always reflects the true physical state of every item.

#### Acceptance Criteria

1. THE System SHALL define the following valid Serial statuses and SHALL reject any attempt to set a Serial to an undefined status: "In Stock", "Sold", "Missing", "Transferred".
2. WHEN a Serial is created during stock ingestion, THE System SHALL set its status to "In Stock".
3. WHEN a Serial is included in a completed Transaction, THE System SHALL set its status to "Sold" and SHALL prevent the Serial from being added to any future Cart.
4. WHEN a Stocktake is committed and a Serial is categorized as Missing, THE System SHALL set its status to "Missing" and SHALL record the Shrinkage value (retail price) against that month's Shrinkage total.
5. WHEN a Transfer is confirmed, THE System SHALL set each transferred Serial's status to "In Stock" at the destination Location and SHALL remove its association with the source Location.
6. THE System SHALL track Shrinkage as the sum of retail prices of all Serials with status "Missing", grouped by month and Location, and SHALL display this aggregate on the Owner_Dashboard.

---

### Requirement 17: Parser and Serializer Integrity

**User Story:** As a developer, I want all data serialized for sync, label printing, and ZRA invoice generation to be accurately round-tripped, so that data is never corrupted during serialization or deserialization.

#### Acceptance Criteria

1. WHEN the Sync_Engine serializes a queued action to JSON for transmission to the cloud API, THE Sync_Engine SHALL produce JSON that deserializes back to an object semantically equivalent to the original.
2. WHEN the Label_Printer service serializes a Label to ESC/POS command bytes, THE Label_Printing_Service SHALL produce a byte sequence that the printer interprets as the correct product name, size, retail price, Serial, and QR_Code.
3. THE System SHALL include a round-trip property: FOR ALL valid Transaction records, serializing then deserializing a Transaction SHALL produce an object equal in all fields to the original Transaction.
4. WHEN the ZRA_Invoice_Service generates a cryptographic signature for a Transaction, THE ZRA_Invoice_Service SHALL produce a signature that the ZRA gateway accepts as valid upon transmission.
5. IF the Sync_Engine receives a malformed JSON payload from a device, THEN THE Sync_Engine SHALL reject the payload, log the raw payload and parsing error to the Audit_Trail, and SHALL NOT partially apply the payload to the database.

---

### Requirement 18: Performance and Scalability

**User Story:** As an Owner operating a chain of up to 20 locations, I want the system to remain responsive under peak load, so that customers are never kept waiting due to system slowness.

#### Acceptance Criteria

1. THE POS SHALL resolve a scanned Serial to Variant and price within 300 milliseconds using the local SQLite database, regardless of total Serial count in the local database.
2. THE Owner_Dashboard SHALL load the main metrics page within 3 seconds on a standard broadband connection with up to 20 Locations active.
3. THE Sync_Engine SHALL process a backlog of up to 1,000 queued actions within 60 seconds of internet connectivity being restored.
4. THE Stocktake_App SHALL display scan results within 500 milliseconds of each individual scan event during a Stocktake session of up to 5,000 items.
5. THE System SHALL support up to 20 concurrent Location sync sessions without data corruption or Tenant cross-contamination.
