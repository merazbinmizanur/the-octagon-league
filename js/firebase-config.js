// THE OCTAGON LEAGUE — Firebase initialization
// Uses the Firebase CDN modular SDK so the site can run as plain static
// files on GitHub Pages with no build step.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDGC5mpt3tjJo0-nnjv6bwyUGgdcdTJ2Yw",
  authDomain: "the-octagon-league.firebaseapp.com",
  projectId: "the-octagon-league",
  storageBucket: "the-octagon-league.firebasestorage.app",
  messagingSenderId: "187770948986",
  appId: "1:187770948986:web:fbadc131da0c9a0e951ac3"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
