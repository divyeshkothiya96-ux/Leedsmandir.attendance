// Settings for the attendance counter.
// Paste the firebaseConfig values from Firebase (Project settings → Your apps → Web app).
// These values are not secret: Firebase identifies the project with them, and the database rules
// (firestore.rules) are what keep the data safe.
window.ATTENDANCE_CONFIG = {
  firebase: {
    apiKey: "AIzaSyDylHnoP0gOsQtuYWCmx7_dUJ0q0_NtAmg",
    authDomain: "attendance-app-c2313.firebaseapp.com",
    projectId: "attendance-app-c2313",
    storageBucket: "attendance-app-c2313.firebasestorage.app",
    messagingSenderId: "602047101305",
    appId: "1:602047101305:web:bce0554801058d804fd7a8"
  },

  // People type just "door" or "admin" on the sign-in screen; this is added after it.
  // The Firebase users must be created as door@mandir.local and admin@mandir.local.
  loginDomain: "mandir.local",

  // Logins that may delete events and change the temple name.
  // Keep this in step with the admin list in firestore.rules.
  adminEmails: ["admin@mandir.local"],

  // The counting buttons, top to bottom in each column (dark to light).
  // `color` is the button colour, `text` the writing on it.
  // Codes are stored with the counts, so don't rename a code after counting has started.
  groups: [
    { id: "blue", name: "Blue", chart: "#2563EB", chartDark: "#3B82F6" },
    { id: "pink", name: "Pink", chart: "#E11D48", chartDark: "#F43F5E" }
  ],
  categories: [
    { code: "BM",  group: "blue", color: "#1E3A8A", text: "#FFFFFF" },
    { code: "KM",  group: "blue", color: "#2563EB", text: "#FFFFFF" },
    { code: "YM",  group: "blue", color: "#60A5FA", text: "#0B1B3F" },
    { code: "SM",  group: "blue", color: "#BFDBFE", text: "#0B1B3F" },
    { code: "mBM", group: "pink", color: "#9F1239", text: "#FFFFFF" },
    { code: "mKM", group: "pink", color: "#E11D48", text: "#FFFFFF" },
    { code: "mYM", group: "pink", color: "#FB7185", text: "#3B0712" },
    { code: "mSM", group: "pink", color: "#FECDD3", text: "#3B0712" }
  ],

  // Quick names offered when starting an event (any other name can be typed).
  eventTypes: ["Diwali", "Annakut", "Ravi Sabha", "Utsav Day", "Samaiyo Day"]
};
