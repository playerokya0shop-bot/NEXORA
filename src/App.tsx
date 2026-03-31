import React, { useState, useEffect, useRef, createContext, useContext } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation, Navigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MessageSquare, FileText, Lock, Home, Send, Trash2, Upload, LogOut, 
  ChevronRight, Download, UserPlus, LogIn, Paperclip, Mic, Video, 
  BarChart2, X, Play, Pause, Check, AlertCircle, Smile, Eye, File, 
  FileAudio, FileVideo, Globe, Users, Bell, Info, CheckCircle2, Github, Settings
} from "lucide-react";
import { Toaster, toast } from 'sonner';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  where, 
  limit, 
  Timestamp 
} from 'firebase/firestore';
import { db } from './firebase';
import { cn } from "./lib/utils";

// --- Types ---
interface User {
  username: string;
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

  const fetchUser = async () => {
    try {
      const res = await fetch("/api/user");
      const data = await res.json();
      if (data.success) setUser(data.user);
    } catch (e) {
      console.error("Failed to fetch user", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchUser();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const login = (userData: User) => {
    setUser(userData);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/login";
  };

  if (loading) return null;

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
  
  if (!user) return null;

  const links = [
    { path: "/", label: t.home || "Home", icon: Home },
    { path: "/chat", label: t.chat || "Chat", icon: MessageSquare },
    { path: "/files", label: t.files || "Files", icon: FileText },
    ...(user?.role === "admin" || user?.username === "k1ros" ? [{ path: "/admin", label: t.admin || "Admin", icon: Lock }] : []),
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/50 backdrop-blur-md border-b border-foreground/10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
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

const RegisterPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Registration failed");
      }
      const data = await res.json();
      if (data.success) {
        navigate("/login");
      } else {
        setError(data.message);
      }
    } catch (err: any) {
      console.error("Register error:", err);
      setError(err.message || "Network error. Please try again.");
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -20 }}
      className="min-h-screen flex items-center justify-center px-6"
    >
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl backdrop-blur-xl">
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
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button type="submit" className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold hover:bg-blue-600 transition-colors">
            Register
          </button>
          <div className="text-center text-white/40 text-sm py-1">or</div>
          <button 
            type="button"
            onClick={() => {
              const width = 600;
              const height = 700;
              const left = window.screen.width / 2 - width / 2;
              const top = window.screen.height / 2 - height / 2;
              window.open("/auth/github", "GitHub Auth", `width=${width},height=${height},top=${top},left=${left}`);
            }}
            className="w-full bg-white text-black py-3 rounded-xl font-bold hover:bg-white/90 transition-colors flex items-center justify-center gap-2"
          >
            <Github size={20} />
            Sign in with GitHub
          </button>
        </form>
        <p className="text-center mt-6 text-white/40 text-sm">
          Already have an account? <Link to="/login" className="text-blue-400 hover:underline">Login</Link>
        </p>
      </motion.div>
    </motion.div>
  );
};

const LoginPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Login failed");
      }
      const data = await res.json();
      if (data.success) {
        login(data.user);
        navigate("/");
      } else {
        setError(data.message);
      }
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message || "Network error. Please try again.");
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -20 }}
      className="min-h-screen flex items-center justify-center px-6"
    >
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl backdrop-blur-xl">
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
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button type="submit" className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold hover:bg-blue-600 transition-colors">
            Login
          </button>
          <div className="text-center text-white/40 text-sm py-1">or</div>
          <button 
            type="button"
            onClick={() => {
              const width = 600;
              const height = 700;
              const left = window.screen.width / 2 - width / 2;
              const top = window.screen.height / 2 - height / 2;
              window.open("/auth/github", "GitHub Auth", `width=${width},height=${height},top=${top},left=${left}`);
            }}
            className="w-full bg-white text-black py-3 rounded-xl font-bold hover:bg-white/90 transition-colors flex items-center justify-center gap-2"
          >
            <Github size={20} />
            Sign in with GitHub
          </button>
        </form>
        <p className="text-center mt-6 text-white/40 text-sm">
          Don't have an account? <Link to="/register" className="text-blue-400 hover:underline">Register</Link>
        </p>
      </motion.div>
    </motion.div>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {[
            { to: "/chat", label: "Open Chat", icon: MessageSquare, color: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
            { to: "/files", label: "Browse Files", icon: FileText, color: "bg-purple-500/10 border-purple-500/20 text-purple-400" },
            { to: "/admin", label: "Admin Panel", icon: Lock, color: "bg-orange-500/10 border-orange-500/20 text-orange-400" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "group p-6 rounded-2xl border transition-all hover:scale-105 active:scale-95 flex flex-col items-center gap-4",
                item.color
              )}
            >
              <item.icon size={32} />
              <span className="font-semibold">{item.label}</span>
              <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

// --- Enhanced Chat Components ---

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
  const [recipient, setRecipient] = useState<string | null>(null);
  const [isUserListOpen, setIsUserListOpen] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    fetchUsers();
    
    // Use onSnapshot for real-time messages
    const q = query(collection(db, "messages"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Message[];
      // Sort on client to handle mixed timestamp types (ISO string vs number)
      msgs.sort((a, b) => {
        const tA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp;
        const tB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp;
        return (tA || 0) - (tB || 0);
      });
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setUsers(data.filter((u: User) => u.username !== user?.username));
    } catch (err) {
      console.error("Failed to fetch users", err);
    }
  };

  // fetchMessages is no longer needed as we use onSnapshot

  const sendMessage = async (msgData: Partial<Message>) => {
    const res = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...msgData,
        user: user?.username,
        recipient: recipient,
        timestamp: Date.now(),
      }),
    });
    const newMessage = await res.json();
    // Message will be added to state via onSnapshot
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

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/chat/upload", true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        sendMessage({ 
          type: 'file', 
          fileUrl: data.url, 
          fileName: data.name, 
          fileType: data.type 
        });
      } else {
        setError("Upload failed: " + xhr.statusText);
        setTimeout(() => setError(null), 5000);
      }
      setUploadProgress(null);
    };

    xhr.onerror = () => {
      setError("Upload failed: Network error");
      setTimeout(() => setError(null), 5000);
      setUploadProgress(null);
    };

    xhr.send(formData);
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
        const formData = new FormData();
        formData.append("file", blob, `recording.${extension}`);

        const res = await fetch("/api/chat/upload", { method: "POST", body: formData });
        const data = await res.json();

        sendMessage({ 
          type: type === 'audio' ? 'audio' : 'video_circle', 
          fileUrl: data.url 
        });

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
    await fetch("/api/chat/poll/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, optionId, username: user?.username }),
    });
  };

  const handleDeleteMessage = async (id: string) => {
    await fetch(`/api/chat/messages/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user?.username }),
    });
  };

  const handleReact = async (messageId: string, emoji: string) => {
    setOpenReactionPickerId(null);
    await fetch(`/api/chat/messages/${messageId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji, username: user?.username }),
    });
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
    if (!recipient) {
      // Global Chat: show only messages without a recipient
      return !msg.recipient;
    } else {
      // Private Chat: show only messages between me and the recipient
      return (
        (msg.user === user?.username && msg.recipient === recipient) ||
        (msg.user === recipient && msg.recipient === user?.username)
      );
    }
  });

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="min-h-screen pt-24 pb-12 px-6 max-w-4xl mx-auto flex flex-col"
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-bold flex items-center gap-3">
          <MessageSquare className="text-blue-400" /> Chat
        </h2>
        <div className="flex items-center gap-3">
          {recipient && (
            <button 
              onClick={() => setRecipient(null)}
              className="bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full text-xs font-bold border border-blue-500/30 flex items-center gap-2 hover:bg-blue-500/30 transition-colors"
            >
              DM: {recipient} <X size={12} />
            </button>
          )}
          <div className="flex items-center gap-3 bg-white/5 p-2 px-4 rounded-full border border-white/10">
            <span className="text-white/40 text-xs uppercase tracking-widest font-bold">USER:</span>
            <span className="text-white font-bold">{user?.username}</span>
          </div>
        </div>
      </div>

      {/* PM Button & Chat Modes */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setRecipient(null)}
          className={cn(
            "px-6 py-2.5 rounded-full text-sm font-bold border transition-all flex items-center gap-2",
            !recipient ? "bg-blue-500 text-white border-blue-600 shadow-lg shadow-blue-500/20" : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
          )}
        >
          <Globe size={16} /> Global Chat
        </button>
        <button
          onClick={() => setIsUserListOpen(true)}
          className={cn(
            "px-6 py-2.5 rounded-full text-sm font-bold border transition-all flex items-center gap-2",
            recipient ? "bg-purple-500 text-white border-purple-600 shadow-lg shadow-purple-500/20" : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
          )}
        >
          <Users size={16} /> {recipient ? `Chat with ${recipient}` : "Direct Messages (ЛС)"}
        </button>
      </div>

      <AnimatePresence>
        {uploadProgress !== null && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl"
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-blue-400 uppercase">Uploading File...</span>
              <span className="text-xs font-mono text-blue-400">{uploadProgress}%</span>
            </div>
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300" 
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </motion.div>
        )}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex items-center gap-3"
          >
            <AlertCircle size={18} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={scrollRef}
        className="flex-1 bg-white/5 rounded-3xl border border-white/10 p-6 overflow-y-auto space-y-6 mb-6 min-h-[400px] flex flex-col"
      >
        {filteredMessages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/20 space-y-4">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center">
              {recipient ? <Lock size={40} /> : <Globe size={40} />}
            </div>
            <div className="text-center">
              <p className="font-bold text-xl text-white/40">
                {recipient ? `Chat with ${recipient}` : "Global Chat"}
              </p>
              <p className="text-sm max-w-[250px] mx-auto">
                {recipient 
                  ? "This is the start of your private conversation. Messages are encrypted and secure." 
                  : "Welcome to the global community chat! Say hello to everyone."}
              </p>
            </div>
          </div>
        )}
        {filteredMessages.map((msg, index, filteredArr) => {
          const prevMsg = filteredArr[index - 1];
          const isNewDay = !prevMsg || new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString();
          
          return (
            <React.Fragment key={`${msg.id}-${index}`}>
              {isNewDay && (
                <div className="flex justify-center my-8 sticky top-20 z-10">
                  <span className="bg-black/40 backdrop-blur-md border border-white/10 px-4 py-1.5 rounded-full text-[10px] text-white/60 uppercase tracking-widest font-bold shadow-lg">
                    {(() => {
                      const date = new Date(msg.timestamp);
                      const today = new Date();
                      const yesterday = new Date();
                      yesterday.setDate(today.getDate() - 1);
                      
                      if (date.toDateString() === today.toDateString()) return "Today";
                      if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
                      return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
                    })()}
                  </span>
                </div>
              )}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "max-w-[85%] p-4 rounded-2xl relative group",
                  msg.user === user?.username ? "ml-auto bg-blue-500/10 border border-blue-500/20" : "bg-white/5 border border-white/10",
                  msg.recipient && "border-purple-500/30 bg-purple-500/5"
                )}
              >
            <div className="flex items-center justify-between mb-2 gap-4">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => msg.user !== user?.username && setRecipient(msg.user)}
                  className="text-xs font-bold text-blue-400 uppercase tracking-tighter hover:underline"
                >
                  {msg.user}
                </button>
                {msg.recipient && (
                  <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest border border-purple-500/30">
                    DM to {msg.recipient === user?.username ? "you" : msg.recipient}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {/* Reaction Picker */}
                <div className="relative group/picker opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => setOpenReactionPickerId(openReactionPickerId === msg.id ? null : msg.id)}
                    className={cn(
                      "p-1.5 hover:bg-white/10 rounded-lg transition-colors",
                      openReactionPickerId === msg.id ? "text-blue-400 bg-white/10" : "text-white/40 hover:text-white/90"
                    )}
                  >
                    <Smile size={16} />
                  </button>
                  {openReactionPickerId === msg.id && (
                    <>
                      {/* Overlay to close when clicking outside */}
                      <div 
                        className="fixed inset-0 z-10" 
                        onClick={() => setOpenReactionPickerId(null)}
                      />
                      <div className="absolute bottom-full right-0 mb-2 flex bg-[#1a1a1a] border border-white/10 p-1.5 rounded-xl shadow-2xl gap-1 z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
                        {["👍", "❤️", "😂", "😮", "😢", "🔥"].map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => handleReact(msg.id, emoji)}
                            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-lg hover:scale-125 active:scale-95 transition-transform"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {user?.username === "k1ros" && (
                  <button 
                    onClick={() => handleDeleteMessage(msg.id)}
                    className="text-white/20 hover:text-red-400 transition-colors"
                    title="Delete Message (Admin Only)"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>

            {msg.type === 'text' && <p className="text-white/90 break-words">{renderTextWithLinks(msg.text || "")}</p>}

            {msg.type === 'file' && (
              <div className="space-y-2">
                {msg.fileType?.startsWith('image/') ? (
                  <img src={msg.fileUrl} alt={msg.fileName} className="rounded-xl max-h-64 object-cover w-full cursor-pointer hover:opacity-90 transition-opacity" onClick={() => window.open(msg.fileUrl, '_blank')} />
                ) : msg.fileType?.startsWith('video/') ? (
                  <video src={msg.fileUrl} controls className="rounded-xl max-h-64 w-full bg-black/20" />
                ) : msg.fileType?.startsWith('audio/') ? (
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
                    <div className="flex items-center gap-3">
                      <FileAudio className="text-blue-400" size={18} />
                      <span className="text-sm truncate flex-1 font-medium">{msg.fileName}</span>
                    </div>
                    <audio controls className="w-full h-8 filter invert opacity-80">
                      <source src={msg.fileUrl} type={msg.fileType} />
                    </audio>
                  </div>
                ) : msg.fileType === 'application/pdf' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                      <FileText className="text-red-400" size={18} />
                      <span className="text-sm truncate flex-1 font-medium">{msg.fileName}</span>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => window.open(msg.fileUrl, '_blank')}
                          className="p-2 hover:text-blue-400 transition-colors"
                          title="Open in new tab"
                        >
                          <Eye size={16} />
                        </button>
                        <a href={msg.fileUrl} download className="p-2 hover:text-blue-400 transition-colors" title="Download">
                          <Download size={16} />
                        </a>
                      </div>
                    </div>
                    <iframe 
                      src={`${msg.fileUrl}#toolbar=0`} 
                      className="w-full h-64 rounded-xl border border-white/10 bg-white/5"
                      title={msg.fileName}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10 group/file">
                    <File className="text-blue-400" size={18} />
                    <span className="text-sm truncate flex-1 font-medium">{msg.fileName}</span>
                    <a href={msg.fileUrl} download className="p-2 hover:text-blue-400 transition-colors opacity-0 group-hover/file:opacity-100 transition-opacity">
                      <Download size={16} />
                    </a>
                  </div>
                )}
              </div>
            )}

            {msg.type === 'audio' && (
              <audio controls className="w-full h-10 filter invert opacity-80">
                <source src={msg.fileUrl} />
              </audio>
            )}

            {msg.type === 'video_circle' && (
              <div className="flex justify-center">
                <video 
                  src={msg.fileUrl} 
                  controls 
                  playsInline
                  className="w-48 h-48 rounded-full object-cover border-4 border-blue-500/30 shadow-lg shadow-blue-500/20" 
                />
              </div>
            )}

            {msg.type === 'poll' && msg.poll && (
              <div className="space-y-3">
                <h4 className="font-bold text-lg">{msg.poll.question}</h4>
                <div className="space-y-2">
                  {msg.poll.options.map((opt, optIndex) => {
                    const totalVotes = msg.poll?.options.reduce((acc, o) => acc + o.votes.length, 0) || 1;
                    const percentage = Math.round((opt.votes.length / totalVotes) * 100);
                    const hasVoted = opt.votes.includes(user?.username || "");
                    
                    return (
                      <button
                        key={`${msg.id}-opt-${optIndex}`}
                        onClick={() => handleVote(msg.id, opt.id)}
                        className="w-full relative p-3 rounded-xl bg-white/5 border border-white/10 overflow-hidden group hover:border-blue-500/30 transition-colors"
                      >
                        <div 
                          className="absolute inset-y-0 left-0 bg-blue-500/20 transition-all duration-500" 
                          style={{ width: `${percentage}%` }} 
                        />
                        <div className="relative flex justify-between items-center text-sm">
                          <span className="flex items-center gap-2">
                            {opt.text}
                            {hasVoted && <Check size={14} className="text-blue-400" />}
                          </span>
                          <span className="text-white/40 font-mono">{percentage}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-white/30 text-center">
                  {msg.poll.options.reduce((acc, o) => acc + o.votes.length, 0)} votes
                </p>
              </div>
            )}

            {/* Message Footer with Timestamp */}
            <div className="flex justify-end mt-1.5">
              <span 
                className="text-[9px] text-white/40 font-mono transition-opacity group-hover:text-white/80"
                title={new Date(msg.timestamp).toLocaleString()}
              >
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            </div>

            {/* Reactions Display */}
            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {Object.entries(msg.reactions).map(([emoji, users]) => {
                  const reactionUsers = users as string[];
                  return (
                    <button
                      key={`${msg.id}-reaction-${emoji}`}
                      onClick={() => handleReact(msg.id, emoji)}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold border transition-all",
                        reactionUsers.includes(user?.username || "") 
                          ? "bg-blue-500/20 border-blue-500/40 text-blue-400" 
                          : "bg-white/5 border-white/10 text-white/60 hover:border-white/20"
                      )}
                    >
                      <span>{emoji}</span>
                      <span>{reactionUsers.length}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </React.Fragment>
            );
          })}
      </div>

      {/* Recording Overlay */}
      {isRecording && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6">
          <div className="relative w-64 h-64 mb-8">
            {isRecording === 'video' ? (
              <video ref={videoPreviewRef} autoPlay muted className="w-full h-full rounded-full object-cover border-4 border-blue-500" />
            ) : (
              <div className="w-full h-full rounded-full bg-blue-500/10 border-4 border-blue-500 flex items-center justify-center animate-pulse">
                <Mic size={64} className="text-blue-500" />
              </div>
            )}
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-4 py-1 rounded-full text-xs font-bold animate-bounce">
              REC
            </div>
          </div>
          <button 
            onClick={stopRecording}
            className="bg-white text-black px-8 py-3 rounded-2xl font-bold hover:bg-white/90 transition-colors"
          >
            Stop & Send
          </button>
        </div>
      )}

      {/* Poll Modal */}
      <AnimatePresence>
        {isPollModalOpen && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md bg-[#111] border border-white/10 p-8 rounded-3xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Create Poll</h3>
                <button onClick={() => setIsPollModalOpen(false)} className="text-white/40 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                <input 
                  placeholder="Question" 
                  value={pollQuestion}
                  onChange={e => setPollQuestion(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-blue-500/50"
                />
                <div className="space-y-2">
                  {pollOptions.map((opt, i) => (
                    <input 
                      key={i}
                      placeholder={`Option ${i + 1}`}
                      value={opt}
                      onChange={e => {
                        const newOpts = [...pollOptions];
                        newOpts[i] = e.target.value;
                        setPollOptions(newOpts);
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-blue-500/50"
                    />
                  ))}
                  <button 
                    onClick={() => setPollOptions([...pollOptions, ""])}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    + Add option
                  </button>
                </div>
                <button 
                  onClick={handleCreatePoll}
                  className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold hover:bg-blue-600 transition-colors"
                >
                  Create Poll
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isUserListOpen && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold flex items-center gap-3">
                  <Users className="text-purple-400" /> All Users
                </h3>
                <button onClick={() => setIsUserListOpen(false)} className="text-white/40 hover:text-white"><X size={24} /></button>
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 no-scrollbar">
                {users.length === 0 ? (
                  <p className="text-center text-white/20 py-8">No other users found.</p>
                ) : (
                  users.map(u => (
                    <button
                      key={u.username}
                      onClick={() => {
                        setRecipient(u.username);
                        setIsUserListOpen(false);
                      }}
                      className="w-full flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-500/10 rounded-full flex items-center justify-center text-purple-400 font-bold uppercase">
                          {u.username[0]}
                        </div>
                        <div className="text-left">
                          <p className="font-bold text-white">{u.username}</p>
                          <p className="text-[10px] text-white/40 uppercase tracking-widest">Active User</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-white/20 group-hover:text-purple-400 transition-colors" />
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="relative flex items-end gap-2">
        {recipient && (
          <div className="absolute -top-10 left-0 right-0 flex justify-center">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-purple-500 text-white px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg"
            >
              <Lock size={10} /> Private Message to {recipient}
              <button onClick={() => setRecipient(null)} className="hover:text-white/60 transition-colors"><X size={10} /></button>
            </motion.div>
          </div>
        )}
        <form onSubmit={handleSendText} className="flex-1 relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 pr-12 outline-none focus:border-blue-500/50 transition-colors text-white"
          />
          <label className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-white/40 hover:text-white transition-colors">
            <Paperclip size={20} />
            <input type="file" className="hidden" onChange={handleFileUpload} />
          </label>
        </form>
        
        <div className="flex gap-2">
          <button 
            onClick={() => setIsPollModalOpen(true)}
            className="p-4 bg-white/5 border border-white/10 rounded-2xl text-white/40 hover:text-purple-400 transition-colors"
            title="Create Poll"
          >
            <BarChart2 size={20} />
          </button>
          <button 
            onClick={() => startRecording('video')}
            className="p-4 bg-white/5 border border-white/10 rounded-2xl text-white/40 hover:text-orange-400 transition-colors"
            title="Video Circle"
          >
            <Video size={20} />
          </button>
          <button 
            onClick={() => startRecording('audio')}
            className="p-4 bg-white/5 border border-white/10 rounded-2xl text-white/40 hover:text-blue-400 transition-colors"
            title="Voice Message"
          >
            <Mic size={20} />
          </button>
          <button
            type="submit"
            onClick={() => handleSendText()}
            className="p-4 bg-blue-500 text-white rounded-2xl flex items-center justify-center hover:bg-blue-600 transition-colors active:scale-90"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

const FilesPage = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmFile, setConfirmFile] = useState<FileItem | null>(null);

  useEffect(() => {
    fetch("/api/files")
      .then((res) => res.json())
      .then((data) => {
        setFiles(data);
        setLoading(false);
      });
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
      <h2 className="text-3xl font-bold flex items-center gap-3 mb-2">
        <FileText className="text-purple-400" /> Verified Files
      </h2>
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
  const t = translations[language];

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="min-h-screen pt-20 sm:pt-24 pb-12 px-4 sm:px-6 max-w-2xl mx-auto"
    >
      <h2 className="text-3xl font-bold mb-8 flex items-center gap-3">
        <Settings className="text-orange-400" /> {t.settings}
      </h2>

      <div className="space-y-8">
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
  const [adminMessages, setAdminMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<'files' | 'users' | 'messages'>('files');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'file' | 'user' | 'message', id: string } | null>(null);
  const [passwordResetTarget, setPasswordResetTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const { user: authUser } = useAuth();

  useEffect(() => {
    if (authUser?.role === "admin" || authUser?.username === "k1ros") {
      setIsAdminLoggedIn(true);
      fetchAllData();
    }
  }, [authUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success) {
      setIsAdminLoggedIn(true);
      fetchAllData();
    } else {
      setError("Invalid username or password");
    }
  };

  const fetchAllData = () => {
    fetchFiles();
    fetchUsers();
    fetchAdminMessages();
  };

  const fetchFiles = () => {
    fetch("/api/files")
      .then((res) => res.json())
      .then(setFiles);
  };

  const fetchUsers = () => {
    const adminUser = authUser?.username || "k1ros";
    fetch(`/api/admin/users?adminUsername=${adminUser}`)
      .then((res) => res.json())
      .then(setUsers);
  };

  const fetchAdminMessages = () => {
    const adminUser = authUser?.username || "k1ros";
    fetch(`/api/admin/messages?adminUsername=${adminUser}`)
      .then((res) => res.json())
      .then(setAdminMessages);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files/upload", true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setUploading(false);
      setUploadProgress(null);
      if (xhr.status === 200) {
        fetchFiles();
      } else {
        setError("Upload failed: " + xhr.statusText);
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setUploadProgress(null);
      setError("Upload failed: Network error");
    };

    xhr.send(formData);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    
    if (deleteConfirm.type === 'file') {
      await fetch(`/api/files/${deleteConfirm.id}`, { method: "DELETE" });
      fetchFiles();
    } else if (deleteConfirm.type === 'user') {
      await fetch(`/api/admin/users/${deleteConfirm.id}`, { 
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminUsername: authUser?.username || "k1ros" })
      });
      fetchUsers();
    } else if (deleteConfirm.type === 'message') {
      await fetch(`/api/chat/messages/${deleteConfirm.id}`, { 
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authUser?.username || "k1ros" })
      });
      fetchAdminMessages();
    }
    
    setDeleteConfirm(null);
  };

  const handlePasswordReset = (targetUsername: string) => {
    setPasswordResetTarget(targetUsername);
    setNewPassword("");
  };

  const confirmPasswordReset = async () => {
    if (!passwordResetTarget || !newPassword) return;

    try {
      const res = await fetch(`/api/admin/users/${passwordResetTarget}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminUsername: authUser?.username || "k1ros", newPassword }),
      });
      if (res.ok) {
        alert("Password reset successfully");
        setPasswordResetTarget(null);
        setNewPassword("");
      } else {
        const data = await res.json();
        setError(data.message || "Failed to reset password");
      }
    } catch (err) {
      setError("Network error resetting password");
    }
  };

  if (!isAdminLoggedIn) {
    return (
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        className="min-h-screen flex items-center justify-center px-6"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl backdrop-blur-xl"
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
        
        <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
          <button 
            onClick={() => setActiveTab('files')}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
              activeTab === 'files' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
            )}
          >
            <FileText size={16} /> Files
          </button>
          <button 
            onClick={() => setActiveTab('users')}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
              activeTab === 'users' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
            )}
          >
            <Users size={16} /> Users
          </button>
          <button 
            onClick={() => setActiveTab('messages')}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
              activeTab === 'messages' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-white/40 hover:text-white"
            )}
          >
            <MessageSquare size={16} /> Messages
          </button>
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
                Are you sure you want to delete this {deleteConfirm.type}? 
                <span className="block text-white font-medium mt-1">{deleteConfirm.id}</span>
                This action cannot be undone.
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
        {passwordResetTarget && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-sm bg-[#111] border border-white/10 p-8 rounded-3xl"
            >
              <h3 className="text-xl font-bold mb-6">Reset Password for <span className="text-orange-400">{passwordResetTarget}</span></h3>
              <input 
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New Password"
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-orange-500/50 transition-colors text-white mb-8"
              />
              <div className="flex gap-3">
                <button 
                  onClick={() => setPasswordResetTarget(null)}
                  className="flex-1 bg-white/5 text-white py-3 rounded-xl font-bold hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmPasswordReset}
                  className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 transition-colors"
                >
                  Reset
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-8">
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
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Users size={20} className="text-orange-400" /> Registered Users
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40">Username</th>
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40">Role</th>
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40">Created At</th>
                    <th className="pb-4 font-bold text-xs uppercase tracking-widest text-white/40 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.map((u) => (
                    <tr key={`admin-user-${u.username}`} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 font-medium">{u.username}</td>
                      <td className="py-4">
                        <select
                          value={u.role || 'user'}
                          onChange={(e) => handleRoleChange(u.username, e.target.value)}
                          disabled={u.username === 'k1ros'}
                          className={cn(
                            "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border bg-transparent outline-none cursor-pointer transition-all",
                            u.role === 'admin' ? "border-orange-500/30 text-orange-400 hover:bg-orange-500/10" : "border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                          )}
                        >
                          <option value="user" className="bg-[#111]">User</option>
                          <option value="admin" className="bg-[#111]">Admin</option>
                        </select>
                      </td>
                      <td className="py-4 text-sm text-white/40 font-mono">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="py-4 text-right flex items-center justify-end gap-2">
                        <button
                          onClick={() => handlePasswordReset(u.username)}
                          className="p-2 text-white/20 hover:text-orange-400 transition-colors"
                          title="Reset Password"
                        >
                          <Lock size={16} />
                        </button>
                        {u.username !== 'k1ros' && (
                          <button
                            onClick={() => setDeleteConfirm({ type: 'user', id: u.username })}
                            className="p-2 text-white/20 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
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
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <MessageSquare size={20} className="text-orange-400" /> All Messages
            </h3>
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
      </div>
    </motion.div>
  );
};

const AppContent = () => {
  const location = useLocation();
  const { user } = useAuth();
  return (
    <>
      <Navbar />
      <AnimatePresence mode="wait">
        <motion.div key={location.pathname}>
          <Routes location={location}>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
            
            <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
            <Route path="/files" element={<ProtectedRoute><FilesPage /></ProtectedRoute>} />
            <Route path="/admin" element={
              <ProtectedRoute>
                {user?.role === "admin" || user?.username === "k1ros" ? <AdminPage /> : <Navigate to="/" />}
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
