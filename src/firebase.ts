import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { 
  getAuth, 
  GoogleAuthProvider,
  GithubAuthProvider
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);

export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();
