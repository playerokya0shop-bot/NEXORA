import React, { useState, useEffect, useRef, createContext, useContext, useMemo } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation, Navigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MessageSquare, FileText, Lock, Home, Send, Trash2, Upload, LogOut, 
  ChevronRight, Download, UserPlus, LogIn, Paperclip, Mic, Video, Phone,
  BarChart2, X, Play, Pause, Check, AlertCircle, Smile, Eye, File, 
  FileAudio, FileVideo, Globe, Users, Bell, Info, CheckCircle2, Github, Settings, ShieldAlert, LayoutDashboard,
  CheckCircle, XCircle, ClipboardList, Search, Plus, MoreVertical, CheckCheck, ArrowLeft, EyeOff, ExternalLink
} from "lucide-react";
import { Toaster, toast } from 'sonner';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  where, 
  limit, 
  Timestamp,
  getDocFromServer,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  increment,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  signInWithPopup, 
  GoogleAuthProvider,
  sendPasswordResetEmail
} from 'firebase/auth';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL,
  uploadBytes
} from 'firebase/storage';
import { db, auth, storage, googleProvider } from './firebase';
import { cn } from "./lib/utils";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

// --- Types ---
interface User {
  username: string;
  role?: string;
  uid?: string;
  profilePicUrl?: string;
}

interface Application {
  id: string;
  username: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface Group {
  id: string;
  name: string;
  members: string[]; // usernames
  createdBy: string; // username
  createdAt: number;
}

interface FileItem {
  name: string;
  url: string;
  size: number;
}

interface PollOption {
  id: string;
  text: string;
  votes: string[];
}

interface Message {
  id: string;
  user: string;
  profilePicUrl?: string;
  type: 'text' | 'file' | 'audio' | 'video_circle' | 'poll';
  text?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  poll?: {
    question: string;
    options: PollOption[];
  };
  reactions?: {
    [emoji: string]: string[];
  };
  recipient?: string | null;
  timestamp: number;
}

// --- Auth Context ---
interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};

// --- Settings Context ---
import { translations, Language } from "./translations";

interface SettingsContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within SettingsProvider");
  return context;
};

const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('language') as Language) || 'en');

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  return (
    <SettingsContext.Provider value={{ language, setLanguage }}>
      {children}
    </SettingsContext.Provider>
  );
};

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Fetch additional user data from Firestore (like role)
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setUser({
              username: userData.username || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || "User",
              role: userData.role || "user",
              uid: firebaseUser.uid,
              profilePicUrl: userData.profilePicUrl
            } as any);
          } else {
            // Create user doc if it doesn't exist
            const newUser = {
              username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || "User",
              role: "user",
              email: firebaseUser.email,
              createdAt: Date.now(),
              profilePicUrl: firebaseUser.photoURL || undefined
            };
            await setDoc(doc(db, "users", firebaseUser.uid), newUser);
            setUser({ ...newUser, uid: firebaseUser.uid } as any);
          }
        } catch (e) {
          console.error("Error fetching user data", e);
          // Fallback so the user isn't stuck loading forever if Firestore fails
          setUser({
            username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || "User",
            role: "user",
            uid: firebaseUser.uid,
            profilePicUrl: firebaseUser.photoURL || undefined
          } as any);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = (userData: User) => {
    setUser(userData);
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    window.location.href = "/login";
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b141a]">
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full"
      />
    </div>
  );

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
};

// --- Notification Context ---
interface Notification {
  id: string;
  type: 'message' | 'mention' | 'system';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAllAsRead: () => void;
  clearNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used within NotificationProvider");
  return context;
};

const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const location = useLocation();
  const lastProcessedTime = useRef(Date.now());

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }

    // Reset last processed time when user logs in to avoid old notifications
    lastProcessedTime.current = Date.now();

    // Listen for new messages
    const q = query(
      collection(db, "messages"),
      orderBy("timestamp", "desc"),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const msg = { id: change.doc.id, ...change.doc.data() } as Message;
          
          // Handle both numeric and ISO string timestamps for robustness
          const msgTimestamp = typeof msg.timestamp === 'string' ? new Date(msg.timestamp).getTime() : msg.timestamp;
          
          // Only process messages newer than when we started listening
          if (msgTimestamp <= lastProcessedTime.current) return;
          
          // Update last processed time
          lastProcessedTime.current = msgTimestamp;
          
          // Don't notify for our own messages
          if (msg.user === user.username) return;

          let shouldNotify = false;
          let title = "New Message";
          let type: 'message' | 'mention' = 'message';

          // 1. Mentions
          if (msg.text && msg.text.includes(`@${user.username}`)) {
            shouldNotify = true;
            title = "You were mentioned!";
            type = 'mention';
          }
          // 2. Direct Messages
          else if (msg.recipient === user.username) {
            shouldNotify = true;
            title = "New Direct Message";
          }
          // 3. Global Chat (only if not on chat page)
          else if (!msg.recipient && location.pathname !== "/chat") {
            shouldNotify = true;
            title = "New Global Message";
          }

          if (shouldNotify) {
            const newNotif: Notification = {
              id: msg.id,
              type,
              title,
              message: msg.text || (msg.type === 'file' ? 'Sent a file' : 'Sent a media message'),
              timestamp: msg.timestamp,
              read: false
            };

            setNotifications(prev => [newNotif, ...prev]);
            
            toast(title, {
              description: `${msg.user}: ${newNotif.message}`,
              icon: type === 'mention' ? <AlertCircle className="text-orange-400" /> : <MessageSquare className="text-blue-400" />,
              action: {
                label: "View",
                onClick: () => window.location.href = "/chat"
              }
            });
          }
        }
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "messages");
    });

    return () => unsubscribe();
  }, [user, location.pathname]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllAsRead, clearNotifications }}>
      {children}
    </NotificationContext.Provider>
  );
};

// --- Components ---

const Navbar = () => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { unreadCount, notifications, markAllAsRead, clearNotifications } = useNotifications();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const { language } = useSettings();
  const t = translations[language];
  
  if (!user || location.pathname === '/login' || location.pathname === '/register') return null;

  const links = [
    { path: "/", label: t.home || "Home", icon: Home },
    { path: "/chat", label: t.chat || "Chat", icon: MessageSquare },
    { path: "/files", label: t.files || "Files", icon: FileText },
    ...(user?.role === "admin" || user?.role === "moderator" || user?.username === "k1ros" ? [{ path: "/admin", label: t.admin || "Admin", icon: Lock }] : []),
  ];

  return (
    <nav className="hidden md:flex fixed top-0 left-0 right-0 z-50 bg-background/50 backdrop-blur-md border-b border-foreground/10">
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="text-2xl font-bold tracking-tighter text-foreground hover:opacity-80 transition-opacity">
          NEXORA
        </Link>
        <div className="flex gap-2 sm:gap-6 items-center">
          {links.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={cn(
                "flex items-center gap-2 text-sm font-medium transition-colors hover:text-foreground",
                location.pathname === link.path ? "text-foreground" : "text-foreground/50"
              )}
            >
              <link.icon size={16} />
              <span className="hidden sm:inline">{link.label}</span>
            </Link>
          ))}
          
          <Link to="/settings" className="p-2 text-foreground/40 hover:text-foreground transition-colors">
            <Settings size={18} />
          </Link>
          
          <div className="relative">
            <button 
              onClick={() => {
                setIsNotifOpen(!isNotifOpen);
                if (!isNotifOpen) markAllAsRead();
              }}
              className={cn(
                "p-2 rounded-xl transition-all relative",
                isNotifOpen ? "bg-foreground/10 text-foreground" : "text-foreground/40 hover:text-foreground hover:bg-foreground/5"
              )}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-background" />
              )}
            </button>

            <AnimatePresence>
              {isNotifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-80 bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
                >
                  <div className="p-4 border-b border-white/5 flex items-center justify-between">
                    <h3 className="font-bold text-sm">Notifications</h3>
                    <button 
                      onClick={clearNotifications}
                      className="text-[10px] text-white/40 hover:text-white uppercase tracking-widest font-bold"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {notifications.length > 0 ? (
                      notifications.map((n) => (
                        <div key={n.id} className="p-4 border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <div className="flex items-start gap-3">
                            <div className={cn(
                              "p-2 rounded-lg",
                              n.type === 'mention' ? "bg-orange-500/10 text-orange-400" : "bg-blue-500/10 text-blue-400"
                            )}>
                              {n.type === 'mention' ? <AlertCircle size={14} /> : <MessageSquare size={14} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold mb-0.5">{n.title}</p>
                              <p className="text-xs text-white/60 line-clamp-2">{n.message}</p>
                              <p className="text-[10px] text-white/20 mt-1 font-mono">
                                {new Date(n.timestamp).toLocaleTimeString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-8 text-center">
                        <Bell size={24} className="mx-auto text-white/10 mb-2" />
                        <p className="text-xs text-white/20">No notifications yet</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button 
            onClick={logout}
            className="p-2 text-white/50 hover:text-red-400 transition-colors"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
};

// --- Auth Error Modal Component ---
const AuthErrorModal = ({ error, onClose }: { error: string, onClose: () => void }) => {
  if (!error) return null;

  const isOperationNotAllowed = error.includes("disabled") || error.includes("operation-not-allowed");
  const isPopupError = error.includes("cancelled") || error.includes("popup");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#1a1a1a] border border-red-500/30 p-6 rounded-2xl max-w-md w-full shadow-2xl"
      >
        <div className="flex items-center gap-3 text-red-400 mb-4">
          <AlertCircle size={28} />
          <h3 className="text-xl font-bold text-white">Authentication Setup Required</h3>
        </div>
        
        <div className="space-y-4 text-gray-300">
          {isOperationNotAllowed ? (
            <>
              <p>
                Email/Password login is currently <strong>disabled</strong> in your Firebase project. 
                This happens automatically when a project is newly created or remixed.
              </p>
              <div className="bg-black/50 p-4 rounded-xl border border-white/10">
                <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                  <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">1</span>
                  How to fix this:
                </h4>
                <ol className="list-decimal pl-5 space-y-2 text-sm">
                  <li>Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1">Firebase Console <ExternalLink size={12}/></a></li>
                  <li>Select your project (<strong>gen-lang-client-0544401461</strong>)</li>
                  <li>Click <strong>Authentication</strong> in the left menu</li>
                  <li>Go to the <strong>Sign-in method</strong> tab</li>
                  <li>Click <strong>Add new provider</strong> &rarr; <strong>Email/Password</strong></li>
                  <li>Enable the first toggle and click <strong>Save</strong></li>
                </ol>
              </div>
            </>
          ) : isPopupError ? (
            <>
              <p>
                Google Login was blocked or cancelled by your browser. This is very common when testing inside the AI Studio preview window (iframe).
              </p>
              <div className="bg-black/50 p-4 rounded-xl border border-white/10">
                <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                  <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">1</span>
                  How to fix this:
                </h4>
                <p className="text-sm">
                  Look at the top right corner of this preview window and click the <strong>"Open in new tab"</strong> button (it looks like a square with an arrow ↗️). 
                  Google Login will work perfectly in the new tab!
                </p>
              </div>
            </>
          ) : (
            <p>{error}</p>
          )}
        </div>

        <button 
          onClick={onClose}
          className="mt-6 w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-bold transition-colors"
        >
          I understand, close this
        </button>
      </motion.div>
    </div>
  );
};

const RegisterPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login, user } = useAuth();

  const [showErrorModal, setShowErrorModal] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/");
    }
  }, [user, navigate]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");
    setShowErrorModal(false);

    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password.");
      return;
    }

    const englishRegex = /^[\x20-\x7E]+$/;
    if (!englishRegex.test(username) || !englishRegex.test(password)) {
      setError("Please use only English letters, numbers, and standard symbols.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setIsLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, `${username}@nexora.com`, password);
      const firebaseUser = userCredential.user;
      
      // Create user profile in Firestore
      const newUser = {
        username,
        role: "user",
        email: firebaseUser.email,
        createdAt: Date.now()
      };
      
      try {
        await setDoc(doc(db, "users", firebaseUser.uid), newUser);
      } catch (firestoreErr) {
        console.error("Failed to create user profile in Firestore:", firestoreErr);
        // Continue anyway so the user isn't stuck, their auth account was created
      }
      
      login({ ...newUser, uid: firebaseUser.uid } as any);
      // Navigation is handled by useEffect when user state changes
    } catch (err: any) {
      setIsLoading(false);
      console.error("Register error:", err);
      if (err.code === 'auth/network-request-failed') {
        setError("Network error. Please check your internet connection or disable ad-blockers/VPNs.");
      } else if (err.code === 'auth/email-already-in-use') {
        setError("Username already taken. Please choose another.");
      } else if (err.code === 'auth/operation-not-allowed') {
        setError("Registration is disabled. Please enable 'Email/Password' in Firebase Console -> Authentication -> Sign-in method.");
        setShowErrorModal(true);
      } else {
        setError(err.message || "Registration failed. Try a different username.");
      }
    }
  };

  const handleGoogleLogin = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
      // AuthProvider will handle the user state via onAuthStateChanged
      // Navigation is handled by useEffect
    } catch (error: any) {
      setIsLoading(false);
      console.error("Google Login Error:", error);
      if (error.code === 'auth/network-request-failed') {
        setError("Network error. Please check your internet connection or disable ad-blockers/VPNs.");
      } else if (error.code === 'auth/popup-closed-by-user') {
        setError("Sign-in was cancelled. Please open the app in a new tab.");
        setShowErrorModal(true);
      } else {
        setError(error.message);
      }
    }
  };

  return (
    <>
      {showErrorModal && <AuthErrorModal error={error} onClose={() => setShowErrorModal(false)} />}
      <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -20 }}
      className="min-h-screen flex items-center justify-center md:px-6"
    >
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full h-screen md:h-auto max-w-md bg-background md:bg-white/5 border-none md:border-solid md:border-white/10 p-6 md:p-8 rounded-none md:rounded-3xl backdrop-blur-xl flex flex-col justify-center">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold mb-2">Join Nexora</h2>
          <p className="text-white/40">Create your account to continue</p>
        </div>
        <form onSubmit={handleRegister} className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-blue-500/50 transition-colors"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-blue-500/50 transition-colors"
            required
          />
          {error && <p className="text-red-400 text-sm text-center bg-red-500/10 p-3 rounded-xl border border-red-500/20">{error}</p>}
          <button type="submit" disabled={isLoading} className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {isLoading ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" /> : "Register"}
          </button>
          <div className="text-center text-white/40 text-sm py-1">or</div>
          <button 
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full bg-white text-black py-3 rounded-xl font-bold hover:bg-white/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Globe size={20} />
            Sign in with Google
          </button>
        </form>
        <p className="text-center mt-6 text-white/40 text-sm">
          Already have an account? <Link to="/login" className="text-blue-400 hover:underline">Login</Link>
        </p>
      </motion.div>
    </motion.div>
    </>
  );
};

const LoginPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  const [showErrorModal, setShowErrorModal] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/");
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");
    setShowErrorModal(false);

    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password.");
      return;
    }

    const englishRegex = /^[\x20-\x7E]+$/;
    if (!englishRegex.test(username) || !englishRegex.test(password)) {
      setError("Please use only English letters, numbers, and standard symbols.");
      return;
    }

    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, `${username}@nexora.com`, password);
      // AuthProvider will handle the user state via onAuthStateChanged
      // Navigation is handled by useEffect
      
      // Safety reset just in case AuthProvider takes too long
      setTimeout(() => {
        setIsLoading(false);
      }, 3000);
    } catch (err: any) {
      setIsLoading(false);
      console.error("Login error:", err);
      if (err.code === 'auth/network-request-failed') {
        setError("Network error. Please check your internet connection or disable ad-blockers/VPNs.");
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError("Invalid username or password.");
      } else if (err.code === 'auth/operation-not-allowed') {
        setError("Login is disabled. Please enable 'Email/Password' in Firebase Console -> Authentication -> Sign-in method.");
        setShowErrorModal(true);
      } else {
        setError("Login failed. Please try again.");
      }
    }
  };

  const handleGoogleLogin = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
      // Navigation is handled by useEffect
      setTimeout(() => {
        setIsLoading(false);
      }, 3000);
    } catch (error: any) {
      setIsLoading(false);
      console.error("Google Login Error:", error);
      if (error.code === 'auth/network-request-failed') {
        setError("Network error. Please check your internet connection or disable ad-blockers/VPNs.");
      } else if (error.code === 'auth/popup-closed-by-user') {
        setError("Sign-in was cancelled. Please open the app in a new tab.");
        setShowErrorModal(true);
      } else {
        setError(error.message);
      }
    }
  };

  return (
    <>
      {showErrorModal && <AuthErrorModal error={error} onClose={() => setShowErrorModal(false)} />}
      <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -20 }}
      className="min-h-screen flex items-center justify-center md:px-6"
    >
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full h-screen md:h-auto max-w-md bg-background md:bg-white/5 border-none md:border-solid md:border-white/10 p-6 md:p-8 rounded-none md:rounded-3xl backdrop-blur-xl flex flex-col justify-center">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold mb-2">Welcome Back</h2>
          <p className="text-white/40">Login to your Nexora account</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-blue-500/50 transition-colors"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-blue-500/50 transition-colors"
            required
          />
          {error && <p className="text-red-400 text-sm text-center bg-red-500/10 p-3 rounded-xl border border-red-500/20">{error}</p>}
          <button type="submit" disabled={isLoading} className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {isLoading ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" /> : "Login"}
          </button>
          <div className="text-center text-white/40 text-sm py-1">or</div>
          <button 
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full bg-white text-black py-3 rounded-xl font-bold hover:bg-white/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Globe size={20} />
            Sign in with Google
          </button>
        </form>
        <p className="text-center mt-6 text-white/40 text-sm">
          Don't have an account? <Link to="/register" className="text-blue-400 hover:underline">Register</Link>
        </p>
      </motion.div>
    </motion.div>
    </>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
};

const HomePage = () => {
  const { user } = useAuth();
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      exit={{ opacity: 0, y: -20 }}
      className="min-h-screen flex flex-col items-center justify-center pt-16 px-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center"
      >
        <h1 className="text-6xl sm:text-8xl font-bold tracking-tighter mb-6 bg-gradient-to-b from-white to-white/40 bg-clip-text text-transparent">
          NEXORA
        </h1>
        <p className="text-white/60 text-lg sm:text-xl max-w-xl mx-auto mb-12">
          Hello, <span className="text-white font-bold">{user?.username}</span>. Experience the future of digital interaction.
        </p>
        <div className="flex flex-wrap justify-center gap-6 max-w-4xl mx-auto w-full">
          {[
            { to: "/chat", label: "Open Chat", icon: MessageSquare, color: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
            { to: "/files", label: "Browse Files", icon: FileText, color: "bg-purple-500/10 border-purple-500/20 text-purple-400" },
            { to: "/admin", label: "Admin Panel", icon: Lock, color: "bg-orange-500/10 border-orange-500/20 text-orange-400", roles: ['admin', 'moderator'] },
          ].filter(item => !item.roles || (user?.role && item.roles.includes(user.role)) || user?.username === 'k1ros').map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "group p-8 rounded-3xl border transition-all hover:scale-105 active:scale-95 flex flex-col items-center gap-4 w-full sm:w-64 h-48 justify-center",
                item.color
              )}
            >
              <item.icon size={40} />
              <span className="text-xl font-bold">{item.label}</span>
              <ChevronRight size={20} className="opacity-0 group-hover:opacity-100 transition-all transform translate-x-[-10px] group-hover:translate-x-0" />
            </Link>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

// --- Enhanced Chat Components ---

const CallModal = ({ isOpen, onClose, callData }: { isOpen: boolean, onClose: () => void, callData: any }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#1f2c33] p-8 rounded-3xl w-96 text-center">
        <h2 className="text-2xl font-bold mb-4">Calling {callData.calleeId}...</h2>
        <div className="w-24 h-24 bg-white/10 rounded-full mx-auto mb-8 flex items-center justify-center">
          <Phone size={48} className="text-white" />
        </div>
        <button 
          onClick={onClose}
          className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold transition-all"
        >
          End Call
        </button>
      </div>
    </div>
  );
};

const ChatPage = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState<'audio' | 'video' | null>(null);
  const [isPollModalOpen, setIsPollModalOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [openReactionPickerId, setOpenReactionPickerId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [activeChat, setActiveChat] = useState<string | 'global' | null>(null);
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [newChatUsername, setNewChatUsername] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [unlockedChats, setUnlockedChats] = useState<Set<string>>(new Set());
  const [lockedChatIds, setLockedChatIds] = useState<Set<string>>(new Set());
  const [isChatLocked, setIsChatLocked] = useState(false);
  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callData, setCallData] = useState<{ callerId: string, calleeId: string, type: 'audio' | 'video' } | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "groups"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const groupsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Group));
      setGroups(groupsList);
    });
    return () => unsubscribe();
  }, [user]);

  const handleCall = (type: 'audio' | 'video') => {
    if (activeChat === 'global' || !activeChat) {
      toast.error("Calls are only available in private chats.");
      return;
    }
    setCallData({ callerId: user?.username || '', calleeId: activeChat, type });
    setIsCallModalOpen(true);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !user) return;
    try {
      const groupRef = doc(collection(db, "groups"));
      await setDoc(groupRef, {
        name: newGroupName,
        members: [user.username],
        createdBy: user.username,
        createdAt: Date.now()
      });
      setNewGroupName("");
      setIsCreateGroupModalOpen(false);
      toast.success("Group created!");
    } catch (err) {
      console.error("Failed to create group", err);
      toast.error("Failed to create group");
    }
  };

  useEffect(() => {
    if (!user?.username) return;
    const fetchLockedChats = async () => {
      try {
        const q = query(collection(db, "chatMetadata"));
        const snapshot = await getDocs(q);
        const lockedIds = new Set<string>();
        snapshot.forEach(doc => {
          if (doc.data().password) {
            lockedIds.add(doc.id);
          }
        });
        setLockedChatIds(lockedIds);
      } catch (err) {
        console.error("Failed to fetch locked chats:", err);
      }
    };
    fetchLockedChats();
    
    // Use onSnapshot for real-time updates to locked chats
    const unsubscribe = onSnapshot(collection(db, "chatMetadata"), (snapshot) => {
      const lockedIds = new Set<string>();
      snapshot.forEach(doc => {
        if (doc.data().password) {
          lockedIds.add(doc.id);
        }
      });
      setLockedChatIds(lockedIds);
    });

    return () => unsubscribe();
  }, [user?.username]);

  useEffect(() => {
    if (!activeChat) return;
    
    const chatId = activeChat === 'global' ? 'global' : [user?.username, activeChat].sort().join('_');
    
    if (unlockedChats.has(chatId)) {
      setIsChatLocked(false);
      return;
    }

    if (lockedChatIds.has(chatId)) {
      setIsChatLocked(true);
      setIsSettingPassword(false);
      return;
    }

    const fetchChatMetadata = async () => {
      setShowPassword(false);
      try {
        const docRef = doc(db, "chatMetadata", chatId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().password) {
          setIsChatLocked(true);
          setIsSettingPassword(false);
        } else {
          setIsChatLocked(true);
          setIsSettingPassword(true);
        }
      } catch (err) {
        console.error("Failed to fetch chat metadata", err);
      }
    };

    fetchChatMetadata();
  }, [activeChat, unlockedChats, user?.username, lockedChatIds]);

  const handleUnlock = async () => {
    const chatId = activeChat === 'global' ? 'global' : [user?.username, activeChat].sort().join('_');
    
    if (!/^\d{4}$/.test(passwordInput)) {
      setPasswordError("Password must be exactly 4 digits");
      return;
    }

    if (isSettingPassword) {
      try {
        await setDoc(doc(db, "chatMetadata", chatId), {
          chatId,
          password: passwordInput // In a real app, this should be hashed, but for simplicity we'll store it as is or handle it in rules
        });
        setUnlockedChats(prev => new Set(prev).add(chatId));
        setLockedChatIds(prev => new Set(prev).add(chatId));
        setPasswordInput("");
        setPasswordError("");
        toast.success("Password set successfully");
      } catch (err) {
        setPasswordError("Failed to set password");
      }
    } else {
      try {
        const docRef = doc(db, "chatMetadata", chatId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().password === passwordInput) {
          setUnlockedChats(prev => new Set(prev).add(chatId));
          setPasswordInput("");
          setPasswordError("");
        } else {
          setPasswordError("Incorrect password");
        }
      } catch (err) {
        setPasswordError("Failed to verify password");
      }
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    fetchUsers();
    
    const q = query(collection(db, "messages"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Message[];
      msgs.sort((a, b) => {
        const tA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp;
        const tB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp;
        return (tA || 0) - (tB || 0);
      });

      // Update unread counts for new messages
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const msg = change.doc.data() as Message;
          if (msg.user !== user?.username) {
            const chatId = msg.recipient ? msg.user : '__global__';
            if (chatId !== (activeChat || '__global__')) {
              setUnreadCounts(prev => ({
                ...prev,
                [chatId]: (prev[chatId] || 0) + 1
              }));
            }
          }
        }
      });

      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "messages");
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    
    // Mark messages as read when activeChat changes
    if (activeChat === 'global') {
      setUnreadCounts(prev => ({ ...prev, '__global__': 0 }));
    } else if (activeChat) {
      setUnreadCounts(prev => ({ ...prev, [activeChat]: 0 }));
    }
  }, [messages, activeChat]);

  const fetchUsers = async () => {
    try {
      const snapshot = await getDocs(collection(db, "users"));
      const usersList = snapshot.docs.map(doc => doc.data() as User);
      setUsers(usersList.filter((u: User) => u.username !== user?.username));
    } catch (err) {
      console.error("Failed to fetch users", err);
    }
  };

  const sendMessage = async (msgData: Partial<Message>) => {
    try {
      const messageRef = doc(collection(db, "messages"));
      await setDoc(messageRef, {
        ...msgData,
        user: user?.username,
        profilePicUrl: user?.profilePicUrl || null,
        recipient: activeChat === 'global' ? null : activeChat,
        timestamp: Date.now(),
        reactions: {}
      });
    } catch (err) {
      console.error("Failed to send message", err);
      toast.error("Failed to send message");
    }
  };

  const handleSendText = (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;
    sendMessage({ type: 'text', text: input.trim() });
    setInput("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const storageRef = ref(storage, `chat/${Date.now()}_${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        setUploadProgress(progress);
      }, 
      (error) => {
        console.error("Upload failed", error);
        setError("Upload failed: " + error.message);
        setTimeout(() => setError(null), 5000);
        setUploadProgress(null);
      }, 
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        sendMessage({ 
          type: 'file', 
          fileUrl: downloadURL, 
          fileName: file.name, 
          fileType: file.type 
        });
        setUploadProgress(null);
      }
    );
  };

  const startRecording = async (type: 'audio' | 'video') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: type === 'video' ? { width: 300, height: 300, facingMode: 'user' } : false 
      });
      
      setIsRecording(type);
      chunksRef.current = [];
      
      const mimeType = type === 'audio' 
        ? (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4')
        : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4');

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      if (type === 'video' && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const extension = mimeType.includes('webm') ? 'webm' : 'mp4';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        
        try {
          const storageRef = ref(storage, `chat_recordings/${Date.now()}_recording.${extension}`);
          const uploadTask = await uploadBytes(storageRef, blob);
          const downloadURL = await getDownloadURL(uploadTask.ref);

          sendMessage({ 
            type: type === 'audio' ? 'audio' : 'video_circle', 
            fileUrl: downloadURL 
          });
        } catch (err) {
          console.error("Recording upload failed", err);
          setError("Failed to upload recording");
        }

        stream.getTracks().forEach(track => track.stop());
        setIsRecording(null);
      };

      recorder.start();
    } catch (err: any) {
      console.error("Recording failed", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError("Permission denied: Please allow camera/microphone access in your browser settings.");
      } else {
        setError("Recording failed: " + (err.message || "Unknown error"));
      }
      setTimeout(() => setError(null), 5000);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const handleCreatePoll = () => {
    if (!pollQuestion.trim() || pollOptions.some(o => !o.trim())) return;
    
    sendMessage({
      type: 'poll',
      poll: {
        question: pollQuestion,
        options: pollOptions.map((text, i) => ({ id: i.toString(), text, votes: [] }))
      }
    });
    
    setIsPollModalOpen(false);
    setPollQuestion("");
    setPollOptions(["", ""]);
  };

  const handleVote = async (messageId: string, optionId: string) => {
    try {
      const msgRef = doc(db, "messages", messageId);
      const msgDoc = await getDoc(msgRef);
      if (msgDoc.exists()) {
        const data = msgDoc.data() as Message;
        if (data.poll) {
          const updatedOptions = data.poll.options.map(opt => {
            if (opt.id === optionId) {
              const votes = opt.votes || [];
              if (!votes.includes(user?.username || "")) {
                return { ...opt, votes: [...votes, user?.username] };
              }
            }
            return opt;
          });
          await updateDoc(msgRef, { "poll.options": updatedOptions });
        }
      }
    } catch (err) {
      console.error("Vote failed", err);
    }
  };

  const handleDeleteMessage = async (id: string) => {
    try {
      await deleteDoc(doc(db, "messages", id));
      toast.success("Message deleted");
    } catch (err) {
      console.error("Delete message failed", err);
      toast.error("Failed to delete message");
    }
  };

  const handleReact = async (messageId: string, emoji: string) => {
    setOpenReactionPickerId(null);
    try {
      const msgRef = doc(db, "messages", messageId);
      const msgDoc = await getDoc(msgRef);
      if (msgDoc.exists()) {
        const data = msgDoc.data() as Message;
        const reactions = data.reactions || {};
        const emojiUsers = reactions[emoji] || [];
        
        if (!emojiUsers.includes(user?.username || "")) {
          reactions[emoji] = [...emojiUsers, user?.username];
          await updateDoc(msgRef, { reactions });
        }
      }
    } catch (err) {
      console.error("Reaction failed", err);
    }
  };

  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a 
            key={i} 
            href={part} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-blue-400 hover:underline break-all"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const filteredMessages = messages.filter(msg => {
    if (activeChat === 'global') {
      return !msg.recipient;
    } else if (activeChat) {
      return (
        (msg.user === user?.username && msg.recipient === activeChat) ||
        (msg.user === activeChat && msg.recipient === user?.username)
      );
    }
    return false;
  });

  // Get list of unique chats
  const chatList = useMemo(() => {
    const chats = new Map<string, Message>();
    
    // Always add Global Chat
    const globalMessages = messages.filter(m => !m.recipient);
    if (globalMessages.length > 0) {
      chats.set('__global__', globalMessages[globalMessages.length - 1]);
    } else {
      chats.set('__global__', { id: 'global', user: 'System', text: 'Welcome to Global Chat', timestamp: Date.now(), type: 'text' } as Message);
    }

    // Add private chats
    messages.forEach(m => {
      if (m.recipient) {
        const otherUser = m.user === user?.username ? m.recipient : m.user;
        if (!chats.has(otherUser) || (m.timestamp > chats.get(otherUser)!.timestamp)) {
          chats.set(otherUser, m);
        }
      }
    });

    return Array.from(chats.entries())
      .map(([id, lastMsg]) => ({ id, lastMsg }))
      .sort((a, b) => b.lastMsg.timestamp - a.lastMsg.timestamp);
  }, [messages, user?.username]);

  const filteredChatList = chatList.filter(chat => 
    chat.id === '__global__' || chat.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startNewChat = () => {
    if (!newChatUsername.trim()) return;
    if (newChatUsername === user?.username) {
      toast.error("You cannot chat with yourself");
      return;
    }
    setActiveChat(newChatUsername);
    setIsNewChatModalOpen(false);
    setNewChatUsername("");
  };

  return (
    <div className="fixed inset-0 md:pt-16 flex bg-[#111b21] text-[#e9edef] overflow-hidden">
      {/* Sidebar */}
      <div className={cn(
        "w-full md:w-[30%] md:min-w-[300px] border-r border-white/10 flex flex-col bg-[#111b21] transition-all duration-300",
        activeChat !== null ? "hidden md:flex" : "flex"
      )}>
        {/* Sidebar Header */}
        <div className="h-16 bg-[#202c33] px-4 flex items-center justify-between">
          <Link to="/settings" className="w-10 h-10 bg-purple-500/10 rounded-full overflow-hidden flex items-center justify-center text-purple-400 font-bold uppercase cursor-pointer hover:opacity-80 transition-opacity">
            {user?.profilePicUrl ? (
              <img src={user.profilePicUrl} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              user?.username[0]
            )}
          </Link>
          <div className="flex items-center gap-4 text-[#aebac1]">
            <button onClick={() => setIsCreateGroupModalOpen(true)} className="p-2 hover:bg-white/5 rounded-full transition-colors" title="New Group">
              <Users size={24} />
            </button>
            <button onClick={() => setIsNewChatModalOpen(true)} className="p-2 hover:bg-white/5 rounded-full transition-colors" title="New Chat">
              <Plus size={24} />
            </button>
            <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <MoreVertical size={24} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-2">
          <div className="bg-[#202c33] rounded-lg flex items-center px-4 py-1.5 gap-4">
            <Search size={18} className="text-[#8696a0]" />
            <input 
              type="text" 
              placeholder="Search or start new chat" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-sm w-full placeholder:text-[#8696a0]"
            />
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <AnimatePresence initial={false}>
            {filteredChatList.map(({ id, lastMsg }) => (
              <motion.button
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                key={id}
                onClick={() => setActiveChat(id === '__global__' ? 'global' : id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 hover:bg-[#2a3942] transition-colors border-b border-white/5",
                  (id === '__global__' && activeChat === 'global') || (id === activeChat) ? "bg-[#2a3942]" : ""
                )}
              >
                <div className={cn(
                  "w-12 h-12 rounded-full overflow-hidden flex items-center justify-center font-bold uppercase flex-shrink-0",
                  id === '__global__' ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"
                )}>
                  {id === '__global__' ? <Globe size={24} /> : (
                    users.find(u => u.username === id)?.profilePicUrl ? (
                      <img src={users.find(u => u.username === id)?.profilePicUrl} alt={id} className="w-full h-full object-cover" />
                    ) : id[0]
                  )}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="font-medium truncate">{id === '__global__' ? "Global Chat" : id}</span>
                      {lockedChatIds.has(id === '__global__' ? 'global' : [user?.username, id].sort().join('_')) && (
                        <Lock size={12} className="text-purple-400 flex-shrink-0" />
                      )}
                    </div>
                    <span className="text-[10px] text-[#8696a0]">
                      {new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1 text-sm text-[#8696a0] truncate flex-1">
                      {lastMsg.user === user?.username && <CheckCheck size={14} className="text-[#53bdeb]" />}
                      <span className={cn(
                        lockedChatIds.has(id === '__global__' ? 'global' : [user?.username, id].sort().join('_')) && 
                        !unlockedChats.has(id === '__global__' ? 'global' : [user?.username, id].sort().join('_')) 
                          ? "blur-sm select-none" 
                          : ""
                      )}>
                        {lastMsg.type === 'text' ? lastMsg.text : 
                         lastMsg.type === 'file' ? "Attachment" :
                         lastMsg.type === 'audio' ? "Voice message" :
                         lastMsg.type === 'video_circle' ? "Video message" : "Poll"}
                      </span>
                    </div>
                    {unreadCounts[id] > 0 && (
                      <motion.span 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="bg-[#00a884] text-[#111b21] text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1"
                      >
                        {unreadCounts[id]}
                      </motion.span>
                    )}
                  </div>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>
      {/* Main Chat Window */}
      <div className={cn(
        "flex-1 flex flex-col bg-[#0b141a] relative transition-all duration-300",
        activeChat === null ? "hidden md:flex" : "flex"
      )}>
        {/* Background Overlay */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]"></div>

        {/* Empty State for Desktop */}
        {!activeChat && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="hidden md:flex flex-1 flex-col items-center justify-center text-center p-12 z-20 bg-[#222e35] border-l border-white/5"
          >
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="w-32 h-32 mb-8 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-400"
            >
              <Globe size={64} />
            </motion.div>
            <motion.h2 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-3xl font-light text-[#e9edef] mb-4"
            >
              Nexora Web
            </motion.h2>
            <motion.p 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-sm text-[#8696a0] max-w-md leading-relaxed"
            >
              Send and receive messages without keeping your phone online.<br/>
              Use Nexora on up to 4 linked devices and 1 phone at the same time.
            </motion.p>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-auto flex items-center gap-2 text-[#8696a0] text-xs"
            >
              <Lock size={12} /> End-to-end encrypted
            </motion.div>
          </motion.div>
        )}

        {/* Chat Header */}
        {activeChat !== null && (
          <div className="flex-1 flex flex-col min-h-0">
            {isChatLocked && !unlockedChats.has(activeChat === 'global' ? 'global' : [user?.username, activeChat].sort().join('_')) ? (
              <div className="flex-1 flex items-center justify-center z-30 bg-[#0b141a]">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-[#202c33] p-10 rounded-3xl shadow-2xl border border-white/5 w-full max-w-lg mx-4 text-center"
                >
                  <div className="w-20 h-20 bg-purple-500/10 rounded-full flex items-center justify-center text-purple-400 mx-auto mb-8">
                    <Lock size={40} />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">
                    {isSettingPassword ? "Set Chat PIN" : "Chat Locked"}
                  </h3>
                  <p className="text-[#8696a0] text-base mb-8">
                    {isSettingPassword 
                      ? "This is your first time in this chat. Please set a 4-digit numeric PIN to keep it confidential." 
                      : "Enter the 4-digit PIN to access this conversation."}
                  </p>
                  
                  <div className="space-y-6">
                    <div className="relative">
                      <input 
                        type={showPassword ? "text" : "password"} 
                        placeholder="0000" 
                        value={passwordInput}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setPasswordInput(val);
                          if (passwordError) setPasswordError("");
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                        className="w-full bg-[#2a3942] border-none outline-none rounded-xl px-4 py-4 text-2xl tracking-[0.5em] text-center placeholder:text-[#8696a0] placeholder:tracking-normal font-mono"
                        autoFocus
                        maxLength={4}
                        inputMode="numeric"
                      />
                      <button 
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8696a0] hover:text-white transition-colors p-2"
                      >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                    {passwordError && (
                      <motion.p 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-red-400 text-sm text-center flex items-center justify-center gap-1"
                      >
                        <AlertCircle size={14} /> {passwordError}
                      </motion.p>
                    )}
                    <button 
                      onClick={handleUnlock}
                      className="w-full bg-[#00a884] hover:bg-[#008f6f] text-[#111b21] font-bold py-4 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 text-lg"
                    >
                      {isSettingPassword ? "Set PIN" : "Unlock Chat"}
                    </button>
                    <button 
                      onClick={() => setActiveChat(null)}
                      className="w-full bg-transparent hover:bg-white/5 text-[#8696a0] py-3 rounded-xl transition-colors text-sm font-medium"
                    >
                      Go Back
                    </button>
                    {(user?.role === 'admin' || user?.username === 'k1ros') && !isSettingPassword && (
                      <button
                        onClick={async () => {
                          const chatId = activeChat === 'global' ? 'global' : [user?.username, activeChat].sort().join('_');
                          await deleteDoc(doc(db, "chatMetadata", chatId));
                          setLockedChatIds(prev => {
                            const next = new Set(prev);
                            next.delete(chatId);
                            return next;
                          });
                          setIsChatLocked(false);
                          toast.success("Chat PIN reset by admin");
                        }}
                        className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 py-3 rounded-xl transition-colors text-sm font-bold mt-2"
                      >
                        Admin: Force Reset PIN
                      </button>
                    )}
                  </div>
                </motion.div>
              </div>
            ) : (
              <>
                <div className="h-16 bg-[#202c33] px-4 flex items-center justify-between z-10">
                  <AnimatePresence mode="wait">
                    <motion.div 
                      key={activeChat}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center gap-3"
                    >
                      <button onClick={() => setActiveChat(null)} className="md:hidden p-2 -ml-2 text-[#aebac1] hover:bg-white/5 rounded-full">
                        <ArrowLeft size={20} />
                      </button>
                      <div className={cn(
                        "w-10 h-10 rounded-full overflow-hidden flex items-center justify-center font-bold uppercase",
                        activeChat === 'global' ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"
                      )}>
                        {activeChat === 'global' ? <Globe size={20} /> : (
                          users.find(u => u.username === activeChat)?.profilePicUrl ? (
                            <img src={users.find(u => u.username === activeChat)?.profilePicUrl} alt={activeChat} className="w-full h-full object-cover" />
                          ) : activeChat[0]
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{activeChat === 'global' ? "Global Chat" : activeChat}</p>
                        <p className="text-[10px] text-[#8696a0] uppercase tracking-widest">{activeChat === 'global' ? "Community" : "Private Message"}</p>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                  <div className="hidden md:flex items-center gap-4 text-[#aebac1]">
                    <Video size={20} className="cursor-pointer hover:text-white transition-colors" onClick={() => handleCall('video')} />
                    <Phone size={20} className="cursor-pointer hover:text-white transition-colors" onClick={() => handleCall('audio')} />
                    <Search size={20} className="cursor-pointer hover:text-white transition-colors" onClick={() => toast.info("Search coming soon!")} />
                    <MoreVertical size={20} className="cursor-pointer hover:text-white transition-colors" onClick={() => toast.info("Menu coming soon!")} />
                  </div>
                </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 md:p-6 space-y-2 z-10 custom-scrollbar flex flex-col">
              {filteredMessages.map((msg, index, filteredArr) => {
            const isMe = msg.user === user?.username;
            const prevMsg = filteredArr[index - 1];
            const isNewDay = !prevMsg || new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString();
            
            return (
              <React.Fragment key={msg.id}>
                {isNewDay && (
                  <div className="flex justify-center my-4">
                    <span className="bg-[#182229] text-[#8696a0] px-3 py-1 rounded-lg text-[11px] uppercase font-medium shadow-sm">
                      {new Date(msg.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                )}
                <motion.div 
                  layout
                  initial={{ opacity: 0, x: isMe ? 20 : -20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className={cn("flex w-full group gap-2", isMe ? "justify-end" : "justify-start")}
                >
                  {!isMe && activeChat === 'global' && (
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex-shrink-0 mt-auto mb-1 flex items-center justify-center">
                      {msg.profilePicUrl ? (
                        <img src={msg.profilePicUrl} alt={msg.user} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-white/50">{msg.user.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[85%] md:max-w-[65%] p-2 px-3 rounded-lg relative shadow-sm",
                    isMe ? "bg-[#005c4b] rounded-tr-none" : "bg-[#202c33] rounded-tl-none"
                  )}>
                    {!isMe && activeChat === 'global' && (
                      <p className="text-[11px] font-bold text-orange-400 mb-1">{msg.user}</p>
                    )}
                    
                    {/* Admin Delete Button */}
                    {(user?.role === 'admin' || user?.role === 'moderator' || user?.username === 'k1ros') && (
                      <button 
                        onClick={() => handleDeleteMessage(msg.id)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg"
                        title="Delete Message"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                    
                    {/* Message Content */}
                    <div className="text-[14.2px] leading-relaxed">
                      {msg.type === 'text' && <p className="break-words">{renderTextWithLinks(msg.text || "")}</p>}
                      {msg.type === 'file' && (
                        <div className="space-y-2">
                          {msg.fileType?.startsWith('image/') ? (
                            <img src={msg.fileUrl} alt={msg.fileName} className="rounded-lg max-h-64 object-cover w-full cursor-pointer" onClick={() => window.open(msg.fileUrl, '_blank')} />
                          ) : (
                            <div className="flex items-center gap-3 p-2 bg-black/20 rounded-lg">
                              <File size={20} className="text-blue-400" />
                              <span className="text-xs truncate flex-1">{msg.fileName}</span>
                              <a href={msg.fileUrl} download className="p-1 hover:text-blue-400 transition-colors"><Download size={16} /></a>
                            </div>
                          )}
                        </div>
                      )}
                      {msg.type === 'audio' && <audio controls className="w-full h-8 filter invert opacity-80 mt-1"><source src={msg.fileUrl} /></audio>}
                      {msg.type === 'video_circle' && <video src={msg.fileUrl} controls className="w-48 h-48 rounded-full object-cover border-2 border-white/10 mt-1" />}
                      {msg.type === 'poll' && msg.poll && (
                        <div className="space-y-2 min-w-[200px]">
                          <h4 className="font-bold text-sm">{msg.poll.question}</h4>
                          {msg.poll.options.map(opt => (
                            <button key={opt.id} onClick={() => handleVote(msg.id, opt.id)} className="w-full text-left p-2 bg-black/20 rounded-lg text-xs hover:bg-black/30 transition-colors">
                              {opt.text} ({opt.votes.length})
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[10px] text-[#8696a0]">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isMe && (
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.1 }}
                        >
                          <CheckCheck size={14} className="text-[#53bdeb]" />
                        </motion.div>
                      )}
                    </div>

                    {/* Reaction Picker Trigger */}
                    <button 
                      onClick={() => setOpenReactionPickerId(openReactionPickerId === msg.id ? null : msg.id)}
                      className="absolute -right-8 top-0 p-1 text-white/0 group-hover:text-white/20 hover:text-white/60 transition-colors"
                    >
                      <Smile size={16} />
                    </button>
                    
                    {/* Reactions Display */}
                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                      <motion.div 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -bottom-3 left-2 flex gap-0.5"
                      >
                        {Object.entries(msg.reactions).map(([emoji, users]) => (
                          <span key={emoji} className="bg-[#202c33] border border-white/5 rounded-full px-1 text-[10px] shadow-sm">
                            {emoji} {(users as string[]).length > 1 ? (users as string[]).length : ''}
                          </span>
                        ))}
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Input Area */}
        <div className="bg-[#202c33] p-2 md:p-3 px-2 md:px-4 flex items-center gap-2 md:gap-3 z-10">
          <div className="hidden md:flex items-center gap-2 text-[#aebac1]">
            <button onClick={() => setIsPollModalOpen(true)} className="p-2 hover:bg-white/5 rounded-full transition-colors"><BarChart2 size={24} /></button>
            <label className="p-2 hover:bg-white/5 rounded-full transition-colors cursor-pointer">
              <Paperclip size={24} />
              <input type="file" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
          
          <form onSubmit={handleSendText} className="flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message"
              className="w-full bg-[#2a3942] border-none rounded-full md:rounded-lg py-2 md:py-2.5 px-4 outline-none text-[15px] text-[#e9edef] placeholder:text-[#8696a0]"
            />
          </form>

          <div className="flex items-center gap-2 text-[#aebac1] min-w-[40px] md:min-w-[48px] justify-center">
            <AnimatePresence mode="wait">
              {input.trim() || window.innerWidth < 768 ? (
                <motion.button 
                  key="send"
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0, rotate: 45 }}
                  onClick={handleSendText} 
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-[#00a884]"
                >
                  <Send size={20} className="md:w-6 md:h-6" />
                </motion.button>
              ) : (
                <motion.div 
                  key="recording"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="hidden md:flex items-center gap-2"
                >
                  <button onClick={() => startRecording('video')} className="p-2 hover:bg-white/5 rounded-full transition-colors"><Video size={24} /></button>
                  <button onClick={() => startRecording('audio')} className="p-2 hover:bg-white/5 rounded-full transition-colors"><Mic size={24} /></button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
              </>
            )}
          </div>
        )}
      </div>
      {/* New Chat Modal */}
      <AnimatePresence>
    {isNewChatModalOpen && (
      <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="w-full max-w-md bg-[#202c33] border border-white/10 p-8 rounded-3xl shadow-2xl"
        >
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold">New Chat</h3>
            <button onClick={() => setIsNewChatModalOpen(false)} className="text-[#8696a0] hover:text-white"><X size={24} /></button>
          </div>
          <p className="text-sm text-[#8696a0] mb-4">Enter the username of the person you want to chat with.</p>
          <input 
            type="text"
            placeholder="Username"
            value={newChatUsername}
            onChange={(e) => setNewChatUsername(e.target.value)}
            className="w-full bg-[#2a3942] border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-blue-500/50 text-white mb-4"
            onKeyDown={(e) => e.key === 'Enter' && startNewChat()}
            autoFocus
          />

          {/* Suggested Users */}
          {users.length > 0 && (
            <div className="mb-6 max-h-48 overflow-y-auto custom-scrollbar space-y-2">
              <p className="text-[10px] text-[#8696a0] uppercase tracking-widest font-bold mb-2">Suggested Users</p>
              {users.filter(u => u.username.toLowerCase().includes(newChatUsername.toLowerCase())).map(u => (
                <button
                  key={u.username}
                  onClick={() => {
                    setActiveChat(u.username);
                    setIsNewChatModalOpen(false);
                    setNewChatUsername("");
                  }}
                  className="w-full flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl transition-colors text-left"
                >
                  <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center text-purple-400 text-xs font-bold uppercase">
                    {u.username[0]}
                  </div>
                  <span className="text-sm">{u.username}</span>
                </button>
              ))}
            </div>
          )}

          <button 
            onClick={startNewChat}
            disabled={!newChatUsername.trim()}
            className="w-full bg-[#00a884] text-white py-3 rounded-xl font-bold hover:bg-[#008f6f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start Chat
          </button>
        </motion.div>
      </div>
    )}
  </AnimatePresence>

  {isCallModalOpen && callData && (
    <CallModal 
      isOpen={isCallModalOpen}
      onClose={() => setIsCallModalOpen(false)}
      callData={callData}
    />
  )}
</div>
);
};

const FilesPage = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmFile, setConfirmFile] = useState<FileItem | null>(null);

  useEffect(() => {
    const q = query(collection(db, "adminFiles"), orderBy("uploadedAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const filesList = snapshot.docs.map(doc => doc.data() as FileItem);
      setFiles(filesList);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "adminFiles");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="min-h-screen pt-24 pb-12 px-6 max-w-4xl mx-auto"
    >
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-3xl font-bold flex items-center gap-3">
          <FileText className="text-purple-400" /> Verified Files
        </h2>
        <Link to="/chat" className="p-2 bg-white/5 rounded-full hover:bg-white/10 transition-colors">
          <X size={24} />
        </Link>
      </div>
      <p className="text-white/40 mb-8 text-sm">Official files verified by Nexora administrators.</p>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
          <FileText size={48} className="mx-auto mb-4 text-white/10" />
          <p className="text-white/30">No files available for download.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {files.map((file, idx) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={`file-list-${file.name}-${idx}`}
              className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-center justify-between hover:bg-white/[0.08] transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center text-purple-400">
                  <FileText size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-white truncate max-w-[200px] sm:max-w-md">{file.name}</h3>
                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] font-bold rounded-full uppercase tracking-tighter border border-purple-500/30">Verified</span>
                  </div>
                  <p className="text-xs text-white/40">{formatSize(file.size)}</p>
                </div>
              </div>
              <button
                onClick={() => setConfirmFile(file)}
                className="p-3 bg-white/5 rounded-xl hover:bg-purple-500 hover:text-white transition-all active:scale-90"
                title="Download original file"
              >
                <Download size={20} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {confirmFile && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-3xl p-8 shadow-2xl"
            >
              <div className="text-center">
                <div className="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Download className="text-purple-400" size={32} />
                </div>
                <h3 className="text-2xl font-bold mb-2">Confirm Download</h3>
                <p className="text-white/60 mb-8">
                  Are you 100% sure you want to download <span className="text-white font-bold">"{confirmFile.name}"</span>?
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setConfirmFile(null)}
                    className="flex-1 py-4 bg-white/5 rounded-2xl font-bold hover:bg-white/10 transition-colors"
                  >
                    No, Cancel
                  </button>
                  <a
                    href={confirmFile.url}
                    onClick={() => setConfirmFile(null)}
                    className="flex-1 py-4 bg-purple-500 text-white rounded-2xl font-bold hover:bg-purple-600 transition-all text-center flex items-center justify-center gap-2"
                  >
                    Yes, Download
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const SettingsPage = () => {
  const { language, setLanguage } = useSettings();
  const { user, logout } = useAuth();
  const t = translations[language];
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleProfilePicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log("Upload started", file, user?.uid, storage);
    if (!file || !user?.uid) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size must be less than 5MB");
      return;
    }

    setUploading(true);
    try {
      const storageRef = ref(storage, `profiles/${user.uid}/${file.name}`);
      console.log("Storage ref created", storageRef);
      const uploadTask = uploadBytesResumable(storageRef, file);
      console.log("Upload task created");

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          console.log("Upload progress", (snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        },
        (error) => {
          console.error("Upload error:", error);
          toast.error("Failed to upload image");
          setUploading(false);
        },
        async () => {
          console.log("Upload complete");
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          console.log("Download URL", downloadURL);
          const userRef = doc(db, "users", user.uid!);
          await updateDoc(userRef, { profilePicUrl: downloadURL });
          toast.success("Profile picture updated! It may take a moment to reflect.");
          setUploading(false);
        }
      );
    } catch (error) {
      console.error("Error uploading profile picture:", error);
      toast.error("An error occurred");
      setUploading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="min-h-screen pt-20 sm:pt-24 pb-12 px-4 sm:px-6 max-w-2xl mx-auto"
    >
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={() => navigate('/chat')}
          className="md:hidden p-2 -ml-2 text-white/60 hover:text-white hover:bg-white/5 rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-3xl font-bold flex items-center gap-3">
          <Settings className="text-orange-400" /> {t.settings}
        </h2>
      </div>

      <div className="space-y-8">
        {/* Profile Section */}
        <div className="bg-white/5 border border-white/10 p-8 rounded-3xl flex flex-col items-center">
          <div className="relative mb-4">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-white/10 border-2 border-white/20 flex items-center justify-center">
              {user?.profilePicUrl ? (
                <img src={user.profilePicUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-white/50">{user?.username?.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute bottom-0 right-0 bg-blue-500 hover:bg-blue-600 text-white p-2 rounded-full transition-colors disabled:opacity-50"
            >
              <Upload size={16} />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleProfilePicUpload} 
              accept="image/*" 
              className="hidden" 
            />
          </div>
          <h3 className="text-2xl font-bold">{user?.username}</h3>
          <p className="text-white/40 text-sm mb-6 uppercase tracking-widest">{user?.role}</p>
          
          <button 
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="w-full sm:w-auto px-6 py-3 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={18} /> Logout
          </button>
        </div>

        {/* Admin Links (Mobile Only) */}
        {(user?.role === 'admin' || user?.role === 'moderator' || user?.username === 'k1ros') && (
          <div className="md:hidden bg-white/5 border border-white/10 p-8 rounded-3xl space-y-4">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <ShieldAlert className="text-orange-400" size={20} /> Admin Access
            </h3>
            <button 
              onClick={() => navigate('/admin')}
              className="w-full py-3 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
            >
              <Lock size={18} /> Admin Panel
            </button>
            <button 
              onClick={() => navigate('/files')}
              className="w-full py-3 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
            >
              <FileText size={18} /> Verified Files
            </button>
          </div>
        )}

        <div className="bg-white/5 border border-white/10 p-8 rounded-3xl">
          <h3 className="text-xl font-bold mb-6">{t.language}</h3>
          <div className="grid grid-cols-3 gap-4">
            {(['en', 'ru', 'he'] as Language[]).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={cn(
                  "py-3 rounded-xl font-bold uppercase transition-all",
                  language === lang 
                    ? "bg-orange-500 text-white" 
                    : "bg-white/5 text-foreground/40 hover:bg-white/10"
                )}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-8 rounded-3xl">
          <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
            <ShieldAlert className="text-purple-400" size={20} />
            {language === 'ru' ? 'Заявка на модератора' : 'Moderator Application'}
          </h3>
          <p className="text-white/40 text-sm mb-6">
            {language === 'ru' 
              ? 'Хотите помочь Nexora? Подайте заявку на роль модератора.' 
              : 'Want to help Nexora? Apply for the moderator role.'}
          </p>
          
          <form onSubmit={async (e) => {
            e.preventDefault();
            const reason = (e.target as any).reason.value;
            if (!reason) return;
            
            try {
              const appRef = doc(collection(db, "applications"));
              await setDoc(appRef, {
                username: user?.username,
                reason,
                status: 'pending',
                createdAt: new Date().toISOString()
              });
              toast.success(language === 'ru' ? 'Заявка отправлена!' : 'Application sent!');
              (e.target as any).reset();
            } catch (err) {
              console.error("Failed to send application", err);
              toast.error('Failed to send application');
            }
          }}>
            <textarea
              name="reason"
              placeholder={language === 'ru' ? 'Почему вы хотите стать модератором?' : 'Why do you want to become a moderator?'}
              className="w-full bg-black/20 border border-white/10 rounded-2xl p-4 text-white text-sm focus:border-purple-500/50 outline-none transition-all mb-4 min-h-[100px]"
              required
            />
            <button
              type="submit"
              className="w-full py-4 bg-purple-500 text-white rounded-2xl font-bold hover:bg-purple-600 transition-all flex items-center justify-center gap-2"
            >
              <Send size={18} />
              {language === 'ru' ? 'Отправить заявку' : 'Submit Application'}
            </button>
          </form>
        </div>
      </div>
    </motion.div>
  );
};

const AdminPage = () => {
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [adminMessages, setAdminMessages] = useState<Message[]>([]);
  const [announcementText, setAnnouncementText] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'files' | 'users' | 'messages' | 'settings' | 'applications'>('dashboard');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'file' | 'user' | 'message' | 'all_messages' | 'all_users', id: string } | null>(null);
  const [settings, setSettings] = useState({ welcomeMessage: "Welcome to the chat!", maintenanceMode: false, chatEnabled: true });
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.role === "admin" || authUser?.username === "k1ros";

  useEffect(() => {
    if (authUser?.role === "admin" || authUser?.role === "moderator" || authUser?.username === "k1ros") {
      setIsAdminLoggedIn(true);
      fetchAllData();
    }
  }, [authUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    // In SPA, we rely on the authenticated user's role from Firestore
    if (authUser?.role === "admin" || authUser?.role === "moderator" || authUser?.username === "k1ros") {
      setIsAdminLoggedIn(true);
      fetchAllData();
    } else {
      setError("You do not have permission to access this area.");
    }
  };

  const fetchAllData = () => {
    const unsubFiles = onSnapshot(query(collection(db, "adminFiles"), orderBy("uploadedAt", "desc")), (snapshot) => {
      setFiles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any);
    });
    const unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const unsubMessages = onSnapshot(query(collection(db, "messages"), orderBy("timestamp", "desc"), limit(100)), (snapshot) => {
      setAdminMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Message[]);
    });
    const unsubSettings = onSnapshot(doc(db, "system", "settings"), (snapshot) => {
      if (snapshot.exists()) {
        setSettings(snapshot.data() as any);
      }
    });
    const unsubApps = onSnapshot(query(collection(db, "applications"), orderBy("createdAt", "desc")), (snapshot) => {
      setApplications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Application[]);
    });

    return () => {
      unsubFiles();
      unsubUsers();
      unsubMessages();
      unsubSettings();
      unsubApps();
    };
  };

  useEffect(() => {
    if (isAdminLoggedIn) {
      const cleanup = fetchAllData();
      return () => cleanup();
    }
  }, [isAdminLoggedIn]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const storageRef = ref(storage, `admin_files/${Date.now()}_${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        setUploadProgress(progress);
      }, 
      (error) => {
        console.error("Admin upload failed", error);
        setError("Upload failed: " + error.message);
        setUploading(false);
        setUploadProgress(null);
      }, 
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        const fileRef = doc(collection(db, "adminFiles"));
        await setDoc(fileRef, {
          name: file.name,
          url: downloadURL,
          type: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString()
        });
        setUploading(false);
        setUploadProgress(null);
        toast.success("File uploaded successfully");
      }
    );
  };

  const handleRoleChange = async (targetUserId: string, newRole: string) => {
    try {
      await updateDoc(doc(db, "users", targetUserId), { role: newRole });
      toast.success(`Role updated to ${newRole}`);
    } catch (err) {
      console.error("Failed to update role", err);
      toast.error("Failed to update role");
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    
    try {
      if (deleteConfirm.type === 'file') {
        await deleteDoc(doc(db, "adminFiles", deleteConfirm.id));
        toast.success("File deleted");
      } else if (deleteConfirm.type === 'user') {
        await deleteDoc(doc(db, "users", deleteConfirm.id));
        toast.success("User deleted");
      } else if (deleteConfirm.type === 'message') {
        await deleteDoc(doc(db, "messages", deleteConfirm.id));
        toast.success("Message deleted");
      } else if (deleteConfirm.type === 'all_messages') {
        const snapshot = await getDocs(collection(db, "messages"));
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        toast.success("All messages deleted");
      } else if (deleteConfirm.type === 'all_users') {
        const snapshot = await getDocs(collection(db, "users"));
        const deletePromises = snapshot.docs.map(doc => {
          if (doc.data().username !== 'k1ros') {
            return deleteDoc(doc.ref);
          }
          return Promise.resolve();
        });
        await Promise.all(deletePromises);
        toast.success("All users deleted");
      }
    } catch (err) {
      console.error("Delete failed", err);
      toast.error("Delete failed");
    }
    
    setDeleteConfirm(null);
  };

  const handleBanUser = async (userId: string, currentBanStatus: boolean) => {
    try {
      await updateDoc(doc(db, "users", userId), { banned: !currentBanStatus });
      toast.success(`User ${!currentBanStatus ? 'banned' : 'unbanned'} successfully.`);
    } catch (err) {
      console.error("Failed to update ban status", err);
      toast.error("Failed to update ban status");
    }
  };

  const handleClearAllMessages = () => {
    setDeleteConfirm({ type: 'all_messages', id: 'all' });
  };

  const handleSaveSettings = async () => {
    try {
      await setDoc(doc(db, "system", "settings"), settings);
      toast.success("Settings saved successfully.");
    } catch (err) {
      console.error("Failed to save settings", err);
      toast.error("Failed to save settings");
    }
  };

  const handleSendAnnouncement = async () => {
    if (!announcementText.trim()) return;
    try {
      const msgRef = doc(collection(db, "messages"));
      await setDoc(msgRef, {
        username: "SYSTEM",
        text: announcementText,
        timestamp: new Date().toISOString(),
        isAnnouncement: true,
        type: 'text'
      });
      setAnnouncementText('');
      toast.success("Announcement sent successfully.");
    } catch (err) {
      console.error("Failed to send announcement", err);
      toast.error("Failed to send announcement");
    }
  };

  const handleApplicationStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      const appRef = doc(db, "applications", id);
      const appDoc = await getDoc(appRef);
      if (appDoc.exists()) {
        const appData = appDoc.data();
        await updateDoc(appRef, { status });
        
        if (status === 'approved') {
          // Find user by username and update role
          const usersRef = collection(db, "users");
          const q = query(usersRef, where("username", "==", appData.username));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const userDoc = querySnapshot.docs[0];
            await updateDoc(userDoc.ref, { role: 'moderator' });
          }
        }
        toast.success(`Application ${status} successfully`);
      }
    } catch (err) {
      console.error("Failed to update application status", err);
      toast.error("Failed to update application status");
    }
  };

  if (!isAdminLoggedIn) {
    return (
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        className="min-h-screen flex items-center justify-center md:px-6"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full h-screen md:h-auto max-w-md bg-background md:bg-white/5 border-none md:border-solid md:border-white/10 p-6 md:p-8 rounded-none md:rounded-3xl backdrop-blur-xl flex flex-col justify-center"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-400 mb-4">
              <Lock size={32} />
            </div>
            <h2 className="text-2xl font-bold">Admin Login</h2>
            <p className="text-white/40 text-sm">Access restricted area</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-white/40 uppercase mb-2 ml-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-orange-500/50 transition-colors text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-white/40 uppercase mb-2 ml-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-orange-500/50 transition-colors text-white"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 transition-colors active:scale-95"
            >
              Enter Dashboard
            </button>
          </form>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="min-h-screen pt-24 pb-12 px-6 max-w-6xl mx-auto"
    >
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <h2 className="text-3xl font-bold flex items-center gap-3">
          <Lock className="text-orange-400" /> Admin Panel
        </h2>
        <Link to="/chat" className="p-2 bg-white/5 rounded-full hover:bg-white/10 transition-colors">
          <X size={24} />
        </Link>
        
        <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10 overflow-x-auto">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
              activeTab === 'dashboard' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
            )}
          >
            <LayoutDashboard size={16} /> Dashboard
          </button>
          {isSuperAdmin && (
            <button 
              onClick={() => setActiveTab('files')}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
                activeTab === 'files' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
              )}
            >
              <FileText size={16} /> Files
            </button>
          )}
          <button 
            onClick={() => setActiveTab('users')}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
              activeTab === 'users' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
            )}
          >
            <Users size={16} /> Users
          </button>
          <button 
            onClick={() => setActiveTab('messages')}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
              activeTab === 'messages' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
            )}
          >
            <MessageSquare size={16} /> Messages
          </button>
          <button 
            onClick={() => setActiveTab('applications')}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
              activeTab === 'applications' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
            )}
          >
            <ClipboardList size={16} /> Applications
          </button>
          {isSuperAdmin && (
            <button 
              onClick={() => setActiveTab('settings')}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
                activeTab === 'settings' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
              )}
            >
              <Settings size={16} /> Settings
            </button>
          )}
        </div>

        <button
          onClick={() => setIsAdminLoggedIn(false)}
          className="flex items-center gap-2 text-white/40 hover:text-white transition-colors"
        >
          <LogOut size={16} /> Logout
        </button>
      </div>

      <AnimatePresence>
        {deleteConfirm && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-sm bg-[#111] border border-white/10 p-8 rounded-3xl text-center"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-400 mx-auto mb-4">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold mb-2">Confirm Delete</h3>
              <p className="text-white/40 text-sm mb-8">
                {deleteConfirm.type === 'all_messages' ? (
                  "Are you sure you want to delete ALL messages? This action cannot be undone."
                ) : deleteConfirm.type === 'all_users' ? (
                  "Are you sure you want to delete ALL users? This action cannot be undone."
                ) : (
                  <>
                    Are you sure you want to delete this {deleteConfirm.type}? 
                    <span className="block text-white font-medium mt-1">{deleteConfirm.id}</span>
                    This action cannot be undone.
                  </>
                )}
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 bg-white/5 text-white py-3 rounded-xl font-bold hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-8">
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white/5 border border-white/10 p-6 rounded-3xl flex flex-col items-center justify-center text-center">
              <Users size={32} className="text-blue-400 mb-4" />
              <div className="text-4xl font-bold mb-1">{users.length}</div>
              <div className="text-white/40 text-sm uppercase tracking-widest font-bold">Total Users</div>
            </div>
            <div className="bg-white/5 border border-white/10 p-6 rounded-3xl flex flex-col items-center justify-center text-center">
              <MessageSquare size={32} className="text-green-400 mb-4" />
              <div className="text-4xl font-bold mb-1">{adminMessages.length}</div>
              <div className="text-white/40 text-sm uppercase tracking-widest font-bold">Total Messages</div>
            </div>
            <div className="bg-white/5 border border-white/10 p-6 rounded-3xl flex flex-col items-center justify-center text-center">
              <FileText size={32} className="text-orange-400 mb-4" />
              <div className="text-4xl font-bold mb-1">{files.length}</div>
              <div className="text-white/40 text-sm uppercase tracking-widest font-bold">Total Files</div>
            </div>
            <div className="bg-white/5 border border-white/10 p-6 rounded-3xl flex flex-col items-center justify-center text-center">
              <ShieldAlert size={32} className="text-red-400 mb-4" />
              <div className="text-4xl font-bold mb-1">{users.filter(u => u.banned).length}</div>
              <div className="text-white/40 text-sm uppercase tracking-widest font-bold">Banned Users</div>
            </div>
          </div>
        )}

        {activeTab === 'files' && (
          <>
            <div className="bg-white/5 border border-white/10 p-8 rounded-3xl">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Upload size={20} className="text-orange-400" /> Upload New File
              </h3>
              <label className="relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/10 rounded-2xl cursor-pointer hover:bg-white/5 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {uploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"></div>
                      {uploadProgress !== null && <span className="text-xs font-mono text-orange-400">{uploadProgress}%</span>}
                    </div>
                  ) : (
                    <>
                      <Upload size={32} className="text-white/20 mb-2" />
                      <p className="text-sm text-white/40">Click to select a file</p>
                    </>
                  )}
                </div>
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
              {uploading && uploadProgress !== null && (
                <div className="mt-4 w-full h-1 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-orange-500 transition-all duration-300" 
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>

            <div className="bg-white/5 border border-white/10 p-8 rounded-3xl">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <FileText size={20} className="text-orange-400" /> Manage Files
              </h3>
              <div className="space-y-4">
                {files.map((file, idx) => (
                  <div key={`admin-file-${file.name}-${idx}`} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10">
                    <span className="text-white font-medium truncate max-w-[200px] sm:max-w-md">{file.name}</span>
                    <button
                      onClick={() => setDeleteConfirm({ type: 'file', id: file.name })}
                      className="p-2 text-white/40 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
                {files.length === 0 && <p className="text-center text-white/20 py-4">No files uploaded yet.</p>}
              </div>
            </div>
          </>
        )}

        {activeTab === 'users' && (
          <div className="bg-white/5 border border-white/10 p-8 rounded-3xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Users size={20} className="text-orange-400" /> Registered Users
              </h3>
              {isSuperAdmin && (
                <button
                  onClick={() => setDeleteConfirm({ type: 'all_users', id: 'all' })}
                  className="px-4 py-2 bg-red-500/10 text-red-400 rounded-xl font-bold hover:bg-red-500/20 transition-colors flex items-center gap-2 text-sm"
                >
                  <Trash2 size={16} /> Delete All Users
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40">Username</th>
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40">Role</th>
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40">Status</th>
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40">Created At</th>
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.map((u) => (
                    <tr key={`admin-user-${u.id}`} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 font-medium">{u.username || <span className="text-white/20 italic">No username</span>}</td>
                      <td className="py-4">
                        <select
                          value={u.role || 'user'}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          disabled={u.username === 'k1ros' || !isSuperAdmin}
                          className={cn(
                            "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border bg-transparent outline-none transition-all",
                            isSuperAdmin && u.username !== 'k1ros' ? "cursor-pointer" : "cursor-not-allowed opacity-70",
                            u.role === 'admin' ? "border-orange-500/30 text-orange-400 hover:bg-orange-500/10" : 
                            u.role === 'moderator' ? "border-purple-500/30 text-purple-400 hover:bg-purple-500/10" :
                            "border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                          )}
                        >
                          <option value="user" className="bg-[#111]">User</option>
                          <option value="moderator" className="bg-[#111]">Moderator</option>
                          <option value="admin" className="bg-[#111]">Admin</option>
                        </select>
                      </td>
                      <td className="py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border",
                          u.banned ? "border-red-500/30 text-red-400 bg-red-500/10" : "border-green-500/30 text-green-400 bg-green-500/10"
                        )}>
                          {u.banned ? 'Banned' : 'Active'}
                        </span>
                      </td>
                      <td className="py-4 text-sm text-white/40 font-mono">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="py-4 text-right flex items-center justify-end gap-2">
                        {u.username !== 'k1ros' && (
                          <>
                            <button
                              onClick={() => handleBanUser(u.id, !!u.banned)}
                              className={cn(
                                "p-2 transition-colors",
                                u.banned ? "text-green-400 hover:text-green-300" : "text-white/20 hover:text-red-400"
                              )}
                              title={u.banned ? "Unban User" : "Ban User"}
                            >
                              <ShieldAlert size={16} />
                            </button>
                            {isSuperAdmin && (
                              <button
                                onClick={() => setDeleteConfirm({ type: 'user', id: u.id })}
                                className="p-2 text-white/20 hover:text-red-400 transition-colors"
                                title="Delete User"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <p className="text-center text-white/20 py-8">No users found.</p>}
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="bg-white/5 border border-white/10 p-8 rounded-3xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <MessageSquare size={20} className="text-orange-400" /> All Messages
              </h3>
              <button
                onClick={handleClearAllMessages}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors text-sm font-bold uppercase tracking-widest"
              >
                <Trash2 size={16} /> Clear All
              </button>
            </div>

            <div className="mb-8 bg-black/20 p-4 rounded-2xl border border-white/5">
              <h4 className="text-sm font-bold text-white/60 mb-3 uppercase tracking-widest flex items-center gap-2">
                <Bell size={16} className="text-blue-400" /> System Announcement
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={announcementText}
                  onChange={(e) => setAnnouncementText(e.target.value)}
                  placeholder="Type announcement here..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-blue-500/50 transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && handleSendAnnouncement()}
                />
                <button
                  onClick={handleSendAnnouncement}
                  disabled={!announcementText.trim()}
                  className="px-6 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold uppercase tracking-widest text-sm flex items-center gap-2"
                >
                  <Send size={16} /> Send
                </button>
              </div>
            </div>

            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {adminMessages.map((msg) => (
                <div key={`admin-msg-${msg.id}`} className="p-4 bg-white/5 rounded-2xl border border-white/10 group hover:border-white/20 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-blue-400 uppercase tracking-tighter">{msg.user}</span>
                      {msg.recipient && (
                        <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest border border-purple-500/30">
                          DM to {msg.recipient}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-white/20 font-mono">
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                      <button
                        onClick={() => setDeleteConfirm({ type: 'message', id: msg.id })}
                        className="p-1.5 text-white/10 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-white/80 break-words">
                    {msg.type === 'text' && msg.text}
                    {msg.type === 'file' && <span className="flex items-center gap-2 text-orange-400"><File size={14} /> {msg.fileName}</span>}
                    {msg.type === 'audio' && <span className="flex items-center gap-2 text-blue-400"><Mic size={14} /> Audio Message</span>}
                    {msg.type === 'video_circle' && <span className="flex items-center gap-2 text-purple-400"><Video size={14} /> Video Message</span>}
                    {msg.type === 'poll' && <span className="flex items-center gap-2 text-green-400"><BarChart2 size={14} /> Poll: {msg.poll?.question}</span>}
                  </div>
                </div>
              ))}
              {adminMessages.length === 0 && <p className="text-center text-white/20 py-8">No messages found.</p>}
            </div>
          </div>
        )}

        {activeTab === 'applications' && (
          <div className="bg-white/5 border border-white/10 p-8 rounded-3xl">
            <h3 className="text-xl font-bold flex items-center gap-2 mb-6">
              <ClipboardList size={20} className="text-purple-400" /> Moderator Applications
            </h3>
            
            <div className="space-y-4">
              {applications.map((app) => (
                <div key={app.id} className="p-6 bg-white/5 rounded-2xl border border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-500/10 rounded-full flex items-center justify-center text-purple-400 font-bold uppercase">
                        {app.username[0]}
                      </div>
                      <div>
                        <p className="font-bold text-white">{app.username}</p>
                        <p className="text-[10px] text-white/40 uppercase tracking-widest">{new Date(app.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border",
                      app.status === 'pending' ? "border-orange-500/30 text-orange-400 bg-orange-500/10" :
                      app.status === 'approved' ? "border-green-500/30 text-green-400 bg-green-500/10" :
                      "border-red-500/30 text-red-400 bg-red-500/10"
                    )}>
                      {app.status}
                    </span>
                  </div>
                  
                  <div className="bg-black/20 p-4 rounded-xl border border-white/5 mb-4">
                    <p className="text-sm text-white/80 leading-relaxed italic">"{app.reason}"</p>
                  </div>
                  
                  {app.status === 'pending' && isSuperAdmin && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleApplicationStatus(app.id, 'approved')}
                        className="flex-1 py-3 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-xl transition-all font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 border border-green-500/20"
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button
                        onClick={() => handleApplicationStatus(app.id, 'rejected')}
                        className="flex-1 py-3 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl transition-all font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 border border-red-500/20"
                      >
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {applications.length === 0 && <p className="text-center text-white/20 py-8">No applications found.</p>}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
};

const AppContent = () => {
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  return (
    <>
      <Navbar />
      <AnimatePresence mode="wait">
        <motion.div key={location.pathname}>
          <Routes location={location}>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
            
            <Route path="/" element={<ProtectedRoute>{isMobile ? <Navigate to="/chat" replace /> : <HomePage />}</ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
            <Route path="/files" element={<ProtectedRoute><FilesPage /></ProtectedRoute>} />
            <Route path="/admin" element={
              <ProtectedRoute>
                {user?.role === "admin" || user?.role === "moderator" || user?.username === "k1ros" ? <AdminPage /> : <Navigate to="/" />}
              </ProtectedRoute>
            } />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          </Routes>
        </motion.div>
      </AnimatePresence>

      {/* Background Elements */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full" />
      </div>
    </>
  );
};

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-blue-500/30">
      <Toaster position="top-right" theme="dark" richColors closeButton />
      <SettingsProvider>
        <AuthProvider>
          <Router>
            <NotificationProvider>
              <AppContent />
            </NotificationProvider>
          </Router>
        </AuthProvider>
      </SettingsProvider>
    </div>
  );
}
