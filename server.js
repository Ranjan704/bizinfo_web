require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const path = require("path");

const app = express();
const db = new Database("bizinfo.sqlite");
const PORT = process.env.PORT || 3000;
const PRICE = Number(process.env.COMPANY_PRICE_PAISE || 9900);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS companies (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL,
 website TEXT NOT NULL, industry TEXT NOT NULL, description TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS purchases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, company_id INTEGER NOT NULL,
 payment_id TEXT, order_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, company_id)
);
`);

const count = db.prepare("SELECT COUNT(*) n FROM companies").get().n;
if (!count) {
  const add = db.prepare("INSERT INTO companies (name,address,website,industry,description) VALUES (?,?,?,?,?)");
  [
    ["Sample Technologies Pvt. Ltd.","Bhubaneswar, Odisha, India","https://example.com","Information Technology","Demo record — replace with verified, authorized company information."],
    ["Eastern Manufacturing Co.","Cuttack, Odisha, India","https://example.org","Manufacturing","Demo record — replace with verified, authorized company information."],
    ["Coastal Retail Solutions","Puri, Odisha, India","https://example.net","Retail & Trade","Demo record — replace with verified, authorized company information."]
  ].forEach(x => add.run(...x));
}

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(req.session.userId) || null;
}
function requireAuth(req,res,next) {
  if (!currentUser(req)) return res.status(401).json({error:"Please log in first."});
  next();
}
function requireAdmin(req,res,next) {
  const user = currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({error:"Admin access required."});
  next();
}
function razorpayClient() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(email.toLowerCase());
  if (!existing) {
    const hash = await bcrypt.hash(password, 12);
    db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
      .run("BIZINFO Admin", email.toLowerCase(), hash);
    console.log("Admin account created from environment settings.");
  }
}

app.get("/api/me", (req,res) => res.json({user:currentUser(req)}));

app.post("/api/signup", async (req,res) => {
  const {name,email,password} = req.body || {};
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 8)
    return res.status(400).json({error:"Enter a name, valid email and password (minimum 8 characters)."});
  try {
    const hash = await bcrypt.hash(password,12);
    const result = db.prepare("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)")
      .run(name.trim(),email.trim().toLowerCase(),hash);
    req.session.userId = result.lastInsertRowid;
    res.json({user:currentUser(req)});
  } catch { res.status(409).json({error:"This email is already registered."}); }
});

app.post("/api/login", async (req,res) => {
  const {email,password} = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email||"").trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password || "",user.password_hash)))
    return res.status(401).json({error:"Incorrect email or password."});
  req.session.userId = user.id;
  res.json({user:currentUser(req)});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/companies",(req,res)=>{
  const q = String(req.query.q || "").trim();
  const industry = String(req.query.industry || "").trim();
  const rows = db.prepare(`
    SELECT id,name,industry,description FROM companies
    WHERE (?='' OR name LIKE ? OR industry LIKE ?)
      AND (?='' OR industry=?)
    ORDER BY name
  `).all(q,`%${q}%`,`%${q}%`,industry,industry);
  const user = currentUser(req);
  const owned = user ? new Set(db.prepare("SELECT company_id FROM purchases WHERE user_id=? AND status='paid'").all(user.id).map(x=>x.company_id)) : new Set();
  res.json({companies:rows.map(x=>({...x,purchased:owned.has(x.id)})),pricePaise:PRICE});
});

app.get("/api/companies/:id", (req,res)=>{
  const row = db.prepare("SELECT * FROM companies WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).json({error:"Company not found."});
  const user = currentUser(req);
  const purchased = user && db.prepare("SELECT id FROM purchases WHERE user_id=? AND company_id=? AND status='paid'").get(user.id,row.id);
  if (user && user.role === "admin" || purchased) return res.json({company:row,unlocked:true});
  res.json({company:{id:row.id,name:row.name,industry:row.industry,description:row.description},unlocked:false});
});

app.post("/api/checkout/:companyId",requireAuth,async(req,res)=>{
  const company = db.prepare("SELECT id FROM companies WHERE id=?").get(Number(req.params.companyId));
  if (!company) return res.status(404).json({error:"Company not found."});
  const prior = db.prepare("SELECT id FROM purchases WHERE user_id=? AND company_id=? AND status='paid'").get(req.session.userId,company.id);
  if (prior) return res.status(409).json({error:"You already purchased this company."});
  const rp = razorpayClient();
  if (!rp) return res.status(503).json({error:"Payments are not configured yet. Add Razorpay keys to your .env file."});
  try {
    const order = await rp.orders.create({amount:PRICE,currency:"INR",receipt:`bizinfo_${req.session.userId}_${company.id}`});
    db.prepare("INSERT INTO purchases (user_id,company_id,order_id,status) VALUES (?,?,?,'pending') ON CONFLICT(user_id,company_id) DO UPDATE SET order_id=excluded.order_id,status='pending'")
      .run(req.session.userId,company.id,order.id);
    res.json({orderId:order.id,amount:order.amount,currency:order.currency,keyId:process.env.RAZORPAY_KEY_ID});
  } catch { res.status(502).json({error:"Could not create payment order. Please try again."}); }
});

app.post("/api/payment/verify",requireAuth,(req,res)=>{
  const {razorpay_order_id,razorpay_payment_id,razorpay_signature} = req.body || {};
  const purchase = db.prepare("SELECT * FROM purchases WHERE user_id=? AND order_id=?").get(req.session.userId,razorpay_order_id);
  if (!purchase || !process.env.RAZORPAY_KEY_SECRET) return res.status(400).json({error:"Payment order not found."});
  const expected = crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(razorpay_signature || "");
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(400).json({error:"Payment verification failed."});
  db.prepare("UPDATE purchases SET payment_id=?,status='paid' WHERE id=?").run(razorpay_payment_id,purchase.id);
  res.json({ok:true});
});

app.get("/api/admin/companies",requireAdmin,(req,res)=>{
  res.json({companies:db.prepare("SELECT * FROM companies ORDER BY id DESC").all()});
});
app.post("/api/admin/companies",requireAdmin,(req,res)=>{
  const {name,address,website,industry,description=""} = req.body || {};
  if (![name,address,website,industry].every(x=>String(x||"").trim()))
    return res.status(400).json({error:"Name, address, website and industry are required."});
  const result = db.prepare("INSERT INTO companies (name,address,website,industry,description) VALUES (?,?,?,?,?)")
    .run(name.trim(),address.trim(),website.trim(),industry.trim(),description.trim());
  res.json({id:result.lastInsertRowid});
});
app.delete("/api/admin/companies/:id",requireAdmin,(req,res)=>{
  db.prepare("DELETE FROM companies WHERE id=?").run(Number(req.params.id));
  res.json({ok:true});
});
app.get("/api/admin/stats",requireAdmin,(req,res)=>{
  res.json({
    companies:db.prepare("SELECT COUNT(*) n FROM companies").get().n,
    users:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,
    purchases:db.prepare("SELECT COUNT(*) n FROM purchases WHERE status='paid'").get().n
  });
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
seedAdmin().then(()=>app.listen(PORT,()=>console.log(`BIZINFO running at http://localhost:${PORT}`)));
