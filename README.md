# Leeds Mandir Attendance

A live headcount for mandir event days (Diwali, Annakut, Ravi Sabha, Utsav and Samaiyo days). Volunteers open the link on their phones, sign in with the door login, and tap the category button for each person who comes in: BM, KM, YM, SM in blue and mBM, mKM, mYM, mSM in pink. Every phone shows the same running totals, and the Report tab breaks them down by category, hour and door.

It runs as a plain web page on GitHub Pages, with Firebase (Google's free app platform) holding the counts and the logins.

## On the day

1. Open the link and sign in. Volunteers use the username `door`; the admin uses `admin`. Each phone stays signed in.
2. If today's event isn't running yet, pick it (Diwali, Annakut, Ravi Sabha, Utsav Day, Samaiyo Day, or type a name) and tap **Start counting**. Phones that open the link later join today's event automatically.
3. Type the door name under **Counting at**, then tap the right category button once per person. **Undo last tap** takes back this phone's most recent taps, one at a time.
4. The **Report** tab shows the total, the busiest hour, the counting window (first to last tap), every category with its share, arrivals by hour (blue and pink per hour, with an hour-by-category table) and each door's counts. It can download a CSV with all of it.

Tips: add the page to the phone's home screen so it opens like an app. The screen stays awake on the Count tab. If the Wi-Fi drops, taps are kept on the phone and sent when it reconnects.

## Who can do what

| | Door login | Admin login |
|---|---|---|
| See the live count and reports | ✓ | ✓ |
| Start an event and count | ✓ | ✓ |
| Delete events, set the temple name | | ✓ |

The database rules in `firestore.rules` enforce this, not just the page.

## One-time setup

### 1. Firebase project
At [console.firebase.google.com](https://console.firebase.google.com):

1. **Add project** → name it `mandir-attendance` (Analytics can be off).
2. **Authentication** → Get started → Sign-in method → enable **Email/Password**.
3. **Authentication → Users** → Add user: `door@mandir.local` and `admin@mandir.local`, each with its own password. These addresses don't receive email; they're only login names.
4. **Firestore Database** → Create database → location `europe-west2 (London)` → production mode.
5. **Firestore Database → Rules** → replace everything with the contents of `firestore.rules` → **Publish**.
6. **Project settings → Your apps → Web (</>)** → register an app → copy the `firebaseConfig` values into `config.js`.

### 2. GitHub Pages
Repository **Settings → Pages** → Source: *Deploy from a branch* → `main` / root. The site appears at `https://divyeshkothiya96-ux.github.io/Leedsmandir.attendance/` a minute or two later.

## Changing the categories or event names

Both live in `config.js`: `categories` sets the buttons (code, column and colours, dark to light) and `eventTypes` sets the quick event names. Don't rename a category code once counting has started, because the counts are stored under the code.

## Changing a password

In Firebase **Authentication → Users**, delete the user and add it again with the same address and the new password. Phones signed in with the old password will be asked to sign in again.

## Adding another admin

Add the new address to `adminEmails` in `config.js` **and** to the list in `isAdmin()` in `firestore.rules`, then publish the rules again.

## Free limits

Firebase's free Spark plan needs no card. Its daily allowance for saves and reads is far above what a busy festival uses, because each phone saves at most a few times a second while tapping. If a limit is ever reached, saving pauses until the next day.

## Files

- `index.html`, `styles.css`, `app.js`: the page
- `config.js`: Firebase project details and login settings
- `firestore.rules`: database rules to paste into Firebase
