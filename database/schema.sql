-- SICTADAU Database Schema

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- App Users (max ~3 accounts)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('superadmin','admin','staff')),
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until DATETIME,
  last_login DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Members (Artists)
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_no TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  whatsapp_no TEXT,
  address TEXT,
  slang TEXT,
  languages TEXT DEFAULT '[]',
  admission_year INTEGER,
  gender TEXT CHECK(gender IN ('Male','Female','Other')),
  dob DATE,
  contact_no TEXT,
  blood_group TEXT,
  email TEXT,
  aadhaar_no TEXT,
  bank_name TEXT,
  bank_account_no TEXT,
  ifsc_code TEXT,
  qualification TEXT,
  years_experience INTEGER,
  status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Expired','Cancelled')),
  family_members TEXT,
  nominee TEXT,
  member_type TEXT NOT NULL DEFAULT 'Ordinary',
  profile_picture TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Representatives
CREATE TABLE IF NOT EXISTS representatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Projects (Working Reports)
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  film_name TEXT NOT NULL,
  production_company TEXT NOT NULL,
  production_company_address TEXT,
  language TEXT,
  production_contact_no TEXT,
  representative_id INTEGER REFERENCES representatives(id) ON DELETE SET NULL,
  place_of_dubbing TEXT,
  start_date DATE,
  end_date DATE,
  company_email TEXT,
  amount REAL NOT NULL DEFAULT 0,
  payment_received REAL NOT NULL DEFAULT 0,
  invoice_no TEXT,
  representative_form TEXT,
  working_report_file TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Completed','Paid')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Project Payments (payment history per working report)
CREATE TABLE IF NOT EXISTS project_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  payment_type TEXT,
  notes TEXT,
  amount REAL NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vouchers (Artist Payments)
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_type TEXT NOT NULL DEFAULT 'Artist',
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  character TEXT,
  representative_id INTEGER REFERENCES representatives(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Paid')),
  amount REAL NOT NULL DEFAULT 0,
  gw_fund_percent REAL NOT NULL DEFAULT 5,
  gw_fund_amount REAL NOT NULL DEFAULT 0,
  representative_percent REAL NOT NULL DEFAULT 5,
  representative_amount REAL NOT NULL DEFAULT 0,
  final_amount REAL NOT NULL DEFAULT 0,
  paid_on DATETIME,
  payment_method TEXT NOT NULL DEFAULT 'NEFT' CHECK(payment_method IN ('Cash','Cheque','NEFT','RTGS','Others')),
  payment_notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Statement (Union Ledger)
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_date DATE NOT NULL,
  income_type TEXT,
  paid_to TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  payment_mode TEXT CHECK(payment_mode IN ('Cash','NEFT','Cheque','Others')),
  transaction_remarks TEXT,
  amount_type TEXT NOT NULL CHECK(amount_type IN ('Debit','Credit')),
  amount REAL NOT NULL DEFAULT 0,
  receipt TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_members_membership_no ON members(membership_no);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_member ON vouchers(member_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_project ON vouchers(project_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_statements_date ON statements(transaction_date);
