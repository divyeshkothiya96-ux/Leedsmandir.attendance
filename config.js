// Settings for the attendance counter.
// Paste the firebaseConfig values from Firebase (Project settings → Your apps → Web app).
// These values are not secret: Firebase identifies the project with them, and the database rules
// (firestore.rules) are what keep the data safe.
window.ATTENDANCE_CONFIG = {
  firebase: {
    apiKey: "PASTE_API_KEY",
    authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
    projectId: "PASTE_PROJECT_ID",
    storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "PASTE_SENDER_ID",
    appId: "PASTE_APP_ID"
  },

  // People type just "door" or "admin" on the sign-in screen; this is added after it.
  // The Firebase users must be created as door@mandir.local and admin@mandir.local.
  loginDomain: "mandir.local",

  // Logins that may delete events and change the temple name.
  // Keep this in step with the admin list in firestore.rules.
  adminEmails: ["admin@mandir.local"]
};
