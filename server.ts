import http from "http";
import { Server } from "socket.io";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import fs from "fs";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, addDoc, query, where, deleteDoc, doc, setDoc, getDoc, orderBy, updateDoc } from "firebase/firestore";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import session from "express-session";

// INLINED CONFIG FOR VERCEL STABILITY
const firebaseConfig = {
  projectId: "gen-lang-client-0544401461",
  appId: "1:1002039546251:web:5f8163ab28288957bcdf8e",
  apiKey: "AIzaSyC3fqP86iCu1bEF_4_w7hDtERV7dBKU7lw",
  authDomain: "gen-lang-client-0544401461.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-6dad5aaf-fd6d-4877-b62a-0975cc9bef14",
  storageBucket: "gen-lang-client-0544401461.firebasestorage.app",
  messagingSenderId: "1002039546251"
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("join-room", (roomId) => socket.join(roomId));
  socket.on("call-user", (data) => socket.to(data.to).emit("call-made", { offer: data.offer, from: socket.id }));
  socket.on("make-answer", (data) => socket.to(data.to).emit("answer-made", { answer: data.answer, from: socket.id }));
  socket.on("add-ice-candidate", (data) => socket.to(data.to).emit("ice-candidate", { candidate: data.candidate, from: socket.id }));
});

app.set('trust proxy', 1);

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

// Middleware
app.use(session({ secret: process.env.SESSION_SECRET || "secret", resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID || "dummy",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "dummy",
    callbackURL: "/auth/github/callback"
  },
  (accessToken: string, refreshToken: string, profile: any, done: any) => {
    return done(null, profile);
  }
));

passport.serializeUser((user: any, done) => done(null, user));
passport.deserializeUser((user: any, done) => done(null, user));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ limit: '10gb', extended: true }));

// Rate Limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Too many attempts, please try again later." },
  validate: { trustProxy: false, xForwardedForHeader: false, forwardedHeader: false }
});

// Files Setup
const isVercel = process.env.VERCEL === '1';
const baseFilesDir = isVercel ? path.join("/tmp", "files") : path.join(process.cwd(), "files");
const adminFilesDir = path.join(baseFilesDir, "admin");
const chatFilesDir = path.join(baseFilesDir, "chat");

if (!fs.existsSync(adminFilesDir)) fs.mkdirSync(adminFilesDir, { recursive: true });
if (!fs.existsSync(chatFilesDir)) fs.mkdirSync(chatFilesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isChat = req.path.includes('chat');
    cb(null, isChat ? chatFilesDir : adminFilesDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-z0-9.]/gi, "_").toLowerCase();
    cb(null, Date.now() + "-" + safeName);
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }
});

// --- API ROUTES ---

app.get("/api/health", (req, res) => res.json({ status: "ok", vercel: isVercel }));

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Username and password required" });
    
    const englishRegex = /^[\x20-\x7E]+$/;
    if (!englishRegex.test(username) || !englishRegex.test(password)) {
      return res.status(400).json({ success: false, message: "Please use only English letters, numbers, and standard symbols." });
    }

    const userRef = doc(db, "users", username);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) return res.status(400).json({ success: false, message: "Username exists" });
    const hashedPassword = await bcrypt.hash(password, 10);
    await setDoc(userRef, { username, password: hashedPassword, role: "user", createdAt: new Date().toISOString() });
    
    const newUser = { username, role: "user" };
    req.login(newUser, (err) => {
      if (err) return res.status(500).json({ success: false, message: "Login after register failed" });
      res.json({ success: true, user: newUser });
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const englishRegex = /^[\x20-\x7E]+$/;
    if (!englishRegex.test(username) || !englishRegex.test(password)) {
      return res.status(400).json({ success: false, message: "Please use only English letters, numbers, and standard symbols." });
    }

    if (username === "k1ros" && password === "9876543210pol") {
      const adminUser = { username: "k1ros", role: "admin" };
      return req.login(adminUser, (err) => {
        if (err) return res.status(500).json({ success: false, message: "Login failed" });
        res.json({ success: true, user: adminUser });
      });
    }
    const userRef = doc(db, "users", username);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data();
      if (userData.banned) {
        return res.status(403).json({ success: false, message: "This account has been banned." });
      }
      const match = await bcrypt.compare(password, userData.password);
      if (match) {
        const loggedInUser = { username: userData.username, role: userData.role || "user" };
        return req.login(loggedInUser, (err) => {
          if (err) return res.status(500).json({ success: false, message: "Login failed" });
          res.json({ success: true, user: loggedInUser });
        });
      }
    }
    res.status(401).json({ success: false, message: "Invalid credentials" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/auth/github", passport.authenticate("github", { scope: ["user:email"] }));

app.get("/auth/github/callback", passport.authenticate("github", { failureRedirect: "/login" }), (req, res) => {
  res.send(`
    <html>
      <body>
        <script>
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
          window.close();
        </script>
      </body>
    </html>
  `);
});

app.get("/api/user", async (req, res) => {
  if (req.isAuthenticated()) {
    const user = req.user as any;
    let role = user.role || "user";
    if (user.username === "k1ros") {
      role = "admin";
    } else {
      try {
        const userRef = doc(db, "users", user.username);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          role = userSnap.data().role || "user";
        }
      } catch (e) {
        console.error("Error fetching user role", e);
      }
    }
    res.json({ success: true, user: { username: user.username, role } });
  } else {
    res.status(401).json({ success: false, message: "Not authenticated" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

app.get("/api/users", async (req, res) => {
  try {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map(d => ({ username: d.id, ...d.data() }));
    // Add admin if not in DB
    if (!users.find(u => u.username === "k1ros")) {
      users.push({ username: "k1ros" });
    }
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/chat/messages", async (req, res) => {
  try {
    const { username } = req.query;
    const q = query(collection(db, "messages"), orderBy("timestamp", "asc"));
    const snap = await getDocs(q);
    const allMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Filter messages: 
    // 1. Public messages (no recipient)
    // 2. Messages sent by the user
    // 3. Messages sent to the user
    const filteredMessages = allMessages.filter((msg: any) => {
      if (!msg.recipient) return true; // Public
      if (msg.user === username) return true; // Sent by user
      if (msg.recipient === username) return true; // Sent to user
      return false;
    });

    res.json(filteredMessages);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/chat/messages", async (req, res) => {
  try {
    const msg = { ...req.body, timestamp: Date.now() };
    const ref = await addDoc(collection(db, "messages"), msg);
    res.json({ id: ref.id, ...msg });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/chat/messages/:id", async (req, res) => {
  try {
    const { username } = req.body;
    const adminRef = doc(db, "users", username as string);
    const adminSnap = await getDoc(adminRef);
    const role = (username === "k1ros") ? "admin" : (adminSnap.exists() ? adminSnap.data().role : "user");
    const isModOrAdmin = role === "admin" || role === "moderator";
    
    if (!isModOrAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    
    await deleteDoc(doc(db, "messages", req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/chat/poll/vote", async (req, res) => {
  try {
    const { messageId, optionId, username } = req.body;
    const ref = doc(db, "messages", messageId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const msg = snap.data();
      if (msg.type === 'poll') {
        if (!msg.poll.options) msg.poll.options = [];
        msg.poll.options.forEach((opt: any) => {
          if (!opt.votes) opt.votes = [];
          opt.votes = opt.votes.filter((v: string) => v !== username);
          if (opt.id === optionId) opt.votes.push(username);
        });
        await setDoc(ref, msg);
        return res.json({ success: true });
      }
    }
    res.status(404).json({ success: false });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/chat/messages/:id/react", async (req, res) => {
  try {
    const { emoji, username } = req.body;
    const { id } = req.params;
    const ref = doc(db, "messages", id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const msg = snap.data();
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      
      const userIndex = msg.reactions[emoji].indexOf(username);
      if (userIndex > -1) {
        msg.reactions[emoji].splice(userIndex, 1);
        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
      } else {
        msg.reactions[emoji].push(username);
      }
      
      await setDoc(ref, msg);
      return res.json({ success: true, reactions: msg.reactions });
    }
    res.status(404).json({ success: false });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/chat/upload", upload.single("file"), (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ url: `/api/download/chat/${req.file.filename}`, name: req.file.originalname, type: req.file.mimetype });
});

app.get("/api/files", (req, res) => {
  if (!fs.existsSync(adminFilesDir)) return res.json([]);
  const files = fs.readdirSync(adminFilesDir).map(f => ({ name: f, url: `/api/download/admin/${f}`, size: fs.statSync(path.join(adminFilesDir, f)).size }));
  res.json(files);
});

app.get("/api/download/:type/:name", (req, res) => {
  const targetDir = req.params.type === 'chat' ? chatFilesDir : adminFilesDir;
  const filePath = path.join(targetDir, req.params.name);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Not found");
});

app.get("/api/admin/users", async (req, res) => {
  try {
    const { adminUsername } = req.query;
    const adminRef = doc(db, "users", adminUsername as string);
    const adminSnap = await getDoc(adminRef);
    const role = (adminUsername === "k1ros") ? "admin" : (adminSnap.exists() ? adminSnap.data().role : "user");
    const isModOrAdmin = role === "admin" || role === "moderator";
    
    if (!isModOrAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    
    const snap = await getDocs(collection(db, "users"));
    const users: any[] = snap.docs.map(d => ({ 
      username: d.id, 
      ...d.data() 
    }));
    
    // Ensure admin is in the list
    if (!users.find(u => u.username === "k1ros")) {
      users.push({ username: "k1ros", role: "admin", createdAt: new Date().toISOString() });
    }
    
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch("/api/admin/users/:username/role", async (req, res) => {
  try {
    const { adminUsername, role } = req.body;
    const { username } = req.params;

    if (!adminUsername) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const adminQuery = query(collection(db, "users"), where("username", "==", adminUsername));
    const adminSnapshot = await getDocs(adminQuery);
    
    if (adminSnapshot.empty) {
      return res.status(401).json({ success: false, message: "Admin not found" });
    }

    const adminData = adminSnapshot.docs[0].data();
    if (adminData.role !== "admin" && adminData.username !== "k1ros") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (username === "k1ros") {
      return res.status(403).json({ success: false, message: "Cannot change role of superadmin" });
    }

    const userQuery = query(collection(db, "users"), where("username", "==", username));
    const userSnapshot = await getDocs(userQuery);

    if (userSnapshot.empty) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const userDoc = userSnapshot.docs[0];
    const targetRole = userDoc.data().role || "user";
    if (adminUsername !== "k1ros" && targetRole === "admin") {
      return res.status(403).json({ success: false, message: "Admins cannot change roles of other admins" });
    }

    await setDoc(doc(db, "users", userDoc.id), { role }, { merge: true });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch("/api/admin/users/:username/password", async (req, res) => {
  try {
    const { adminUsername, newPassword } = req.body;
    const { username } = req.params;
    
    const adminRef = doc(db, "users", adminUsername as string);
    const adminSnap = await getDoc(adminRef);
    const isAdmin = (adminUsername === "k1ros") || (adminSnap.exists() && adminSnap.data().role === "admin");
    
    if (!isAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    
    const targetUserRef = doc(db, "users", username);
    const targetUserSnap = await getDoc(targetUserRef);
    if (targetUserSnap.exists()) {
      const targetRole = targetUserSnap.data().role || "user";
      if (adminUsername !== "k1ros" && targetRole === "admin") {
        return res.status(403).json({ success: false, message: "Admins cannot change passwords of other admins" });
      }
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const userRef = doc(db, "users", username);
    await setDoc(userRef, { password: hashedPassword }, { merge: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/settings", async (req, res) => {
  try {
    const settingsRef = doc(db, "system", "settings");
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      return res.json({ welcomeMessage: "Welcome to the chat!", maintenanceMode: false, chatEnabled: true });
    }
    res.json(settingsSnap.data());
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch("/api/admin/settings", async (req, res) => {
  try {
    const { adminUsername, settings } = req.body;
    
    const adminRef = doc(db, "users", adminUsername as string);
    const adminSnap = await getDoc(adminRef);
    const isAdmin = (adminUsername === "k1ros") || (adminSnap.exists() && adminSnap.data().role === "admin");
    
    if (!isAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    
    const settingsRef = doc(db, "system", "settings");
    await setDoc(settingsRef, settings, { merge: true });
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/admin/users/:username", async (req, res) => {
  try {
    const { adminUsername } = req.body;
    const adminRef = doc(db, "users", adminUsername as string);
    const adminSnap = await getDoc(adminRef);
    const isAdmin = (adminUsername === "k1ros") || (adminSnap.exists() && adminSnap.data().role === "admin");
    
    if (!isAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    const { username } = req.params;
    if (username === "k1ros") return res.status(400).json({ success: false, message: "Cannot delete superadmin" });
    
    const targetUserRef = doc(db, "users", username);
    const targetUserSnap = await getDoc(targetUserRef);
    if (targetUserSnap.exists()) {
      const targetRole = targetUserSnap.data().role || "user";
      if (adminUsername !== "k1ros" && targetRole === "admin") {
        return res.status(403).json({ success: false, message: "Admins cannot delete other admins" });
      }
    }
    
    await deleteDoc(doc(db, "users", username));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch("/api/admin/users/:username/ban", async (req, res) => {
  try {
    const { adminUsername, banned } = req.body;
    const { username } = req.params;
    
    const adminRef = doc(db, "users", adminUsername as string);
    const adminSnap = await getDoc(adminRef);
    const role = (adminUsername === "k1ros") ? "admin" : (adminSnap.exists() ? adminSnap.data().role : "user");
    const isModOrAdmin = role === "admin" || role === "moderator";
    
    if (!isModOrAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    if (username === "k1ros") return res.status(400).json({ success: false, message: "Cannot ban superadmin" });
    
    const targetUserRef = doc(db, "users", username);
    const targetUserSnap = await getDoc(targetUserRef);
    if (targetUserSnap.exists()) {
      const targetRole = targetUserSnap.data().role || "user";
      if (role === "moderator" && (targetRole === "admin" || targetRole === "moderator")) {
        return res.status(403).json({ success: false, message: "Moderators cannot ban admins or other moderators" });
      }
      if (role === "admin" && targetRole === "admin" && adminUsername !== "k1ros") {
        return res.status(403).json({ success: false, message: "Admins cannot ban other admins" });
      }
    }
    
    const userRef = doc(db, "users", username);
    await setDoc(userRef, { banned }, { merge: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/announce", async (req, res) => {
  try {
    const { adminUsername, text } = req.body;
    const adminRef = doc(db, "users", adminUsername as string);
    const adminSnap = await getDoc(adminRef);
    const role = (adminUsername === "k1ros") ? "admin" : (adminSnap.exists() ? adminSnap.data().role : "user");
    const isModOrAdmin = role === "admin" || role === "moderator";
    
    if (!isModOrAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    
    const msg = { 
      user: "SYSTEM", 
      text, 
      timestamp: Date.now(),
      type: "text",
      isSystem: true
    };
    const ref = await addDoc(collection(db, "messages"), msg);
    res.json({ success: true, id: ref.id, ...msg });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/admin/messages", async (req, res) => {
  try {
    const { adminUsername } = req.body;
    const adminRef = doc(db, "users", adminUsername as string);
    const adminSnap = await getDoc(adminRef);
    const role = (adminUsername === "k1ros") ? "admin" : (adminSnap.exists() ? adminSnap.data().role : "user");
    const isModOrAdmin = role === "admin" || role === "moderator";
    
    if (!isModOrAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    
    const snap = await getDocs(collection(db, "messages"));
    const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/admin/messages", async (req, res) => {
  try {
    const { adminUsername } = req.query;
    const adminRef = doc(db, "users", adminUsername as string);
    const adminSnap = await getDoc(adminRef);
    const role = (adminUsername === "k1ros") ? "admin" : (adminSnap.exists() ? adminSnap.data().role : "user");
    const isModOrAdmin = role === "admin" || role === "moderator";
    
    if (!isModOrAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    
    const snap = await getDocs(collection(db, "messages"));
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort on server to handle mixed timestamp types
    messages.sort((a: any, b: any) => {
      const tA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp;
      const tB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp;
      return (tB || 0) - (tA || 0);
    });
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (username === "k1ros" && password === "9876543210pol") return res.json({ success: true, role: "admin" });
    
    const userRef = doc(db, "users", username);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data();
      const match = await bcrypt.compare(password, userData.password);
      if (match && (userData.role === "admin" || userData.role === "moderator")) return res.json({ success: true, role: userData.role });
    }
    res.status(401).json({ success: false, message: "Invalid credentials or not an admin/moderator" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/files/upload", upload.single("file"), (req: any, res) => res.json({ success: true, file: req.file }));

app.delete("/api/files/:name", (req, res) => {
  const p = path.join(adminFilesDir, req.params.name);
  if (fs.existsSync(p)) { fs.unlinkSync(p); res.json({ success: true }); }
  else res.status(404).json({ success: false });
});

// --- VITE / STATIC ---

async function startServer() {
  if (process.env.NODE_ENV !== "production" && !isVercel) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API not found' });
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!isVercel) {
    server.listen(3000, "0.0.0.0", () => console.log("Server on 3000"));
  }
}

startServer();

export default app;
