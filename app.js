const firebaseConfig = {
  apiKey: "AIzaSyAfODir4IgA_Q4oiw6bhkimgB9wD67gzHU",
  authDomain: "collabcode-90630.firebaseapp.com",
  databaseURL: "https://collabcode-90630-default-rtdb.firebaseio.com",
  projectId: "collabcode-90630",
  storageBucket: "collabcode-90630.firebasestorage.app",
  messagingSenderId: "479153479403",
  appId: "1:479153479403:web:f2db9ab63165c979e128ae"
};


// ── Initialize Firebase ───────────────────────────────────
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ── Global State ──────────────────────────────────────────
let editor;           // CodeMirror instance
let roomId;           // current room ID
let myName;           // this user's name
let myColor;          // this user's color object { bg, text }
let isSyncing = false; // prevents echo loops when setting editor value

// ── User colors (cycles through these for each person) ───
const COLORS = [
  { bg: '#4f46e5', text: '#e0e7ff' },
  { bg: '#be185d', text: '#fce7f3' },
  { bg: '#0f766e', text: '#ccfbf1' },
  { bg: '#b45309', text: '#fef3c7' },
  { bg: '#6d28d9', text: '#ede9fe' },
];

// ── Starter code templates for each language ─────────────
const STARTERS = {
  javascript: `// JavaScript
function greet(name) {
  return "Hello, " + name + "!";
}
console.log(greet("World"));`,

  python: `# Python
def greet(name):
    return f"Hello, {name}!"

print(greet("World"))`,

  java: `// Java
public class Main {
    public static void main(String[] args) {
        System.out.println(greet("World"));
    }

    static String greet(String name) {
        return "Hello, " + name + "!";
    }
}`,

  cpp: `// C++
#include <iostream>
using namespace std;

string greet(string name) {
    return "Hello, " + name + "!";
}

int main() {
    cout << greet("World") << endl;
    return 0;
}`,

  c: `// C
#include <stdio.h>

void greet(char* name) {
    printf("Hello, %s!\\n", name);
}

int main() {
    greet("World");
    return 0;
}`,

  htmlmixed: `<!DOCTYPE html>
<html>
<head>
  <title>My Page</title>
</head>
<body>
  <h1>Hello, World!</h1>
</body>
</html>`,

  css: `/* CSS */
body {
  font-family: sans-serif;
  background: #f0f0f0;
  color: #333;
}`
};

// ── Language → CodeMirror mode map ───────────────────────
const MODE_MAP = {
  javascript: 'javascript',
  python:     'python',
  java:       'text/x-java',
  cpp:        'text/x-c++src',
  c:          'text/x-csrc',
  htmlmixed:  'htmlmixed',
  css:        'css'
};

// ── Language → Piston API config ─────────────────────────
const PISTON_LANGS = {
  python: { language: 'python', version: '3.10.0' },
  java:   { language: 'java',   version: '15.0.2' },
  cpp:    { language: 'c++',    version: '10.2.0' },
  c:      { language: 'c',      version: '10.2.0' },
};


// ══════════════════════════════════════════════════════════
//  JOIN ROOM
// ══════════════════════════════════════════════════════════

async function joinRoom() {
  const nameInput     = document.getElementById('name-input').value.trim();
  const roomInput     = document.getElementById('room-input').value.trim();
  const passwordInput = document.getElementById('password-input').value.trim();
  const hint          = document.getElementById('join-hint');

  // Validate name
  if (!nameInput) {
    hint.style.color = '#f87171';
    hint.textContent = 'Please enter your name first.';
    return;
  }

  myName  = nameInput;
  myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  roomId  = roomInput || generateRoomId();

  // ── Password check ──────────────────────────────────────
  const roomMeta = await db.ref(`rooms/${roomId}/meta`).once('value');
  const meta = roomMeta.val();

  if (meta && meta.password) {
    // Existing room with a password → verify
    if (meta.password !== passwordInput) {
      hint.style.color = '#f87171';
      hint.textContent = 'Wrong password. Try again.';
      return;
    }
  } else if (!meta && passwordInput) {
    // New room with a password → save it
    await db.ref(`rooms/${roomId}/meta`).set({
      password:  passwordInput,
      createdBy: myName,
      createdAt: Date.now()
    });
  } else if (!meta) {
    // New room, no password
    await db.ref(`rooms/${roomId}/meta`).set({
      password:  null,
      createdBy: myName,
      createdAt: Date.now()
    });
  }

  // ── Update URL so the link is shareable ────────────────
  window.history.replaceState({}, '', `?room=${roomId}`);

  // ── Update header ──────────────────────────────────────
  const isLocked = meta?.password || passwordInput;
  document.getElementById('room-id').textContent = roomId + (isLocked ? ' 🔒' : '');

  // ── Switch to editor view ──────────────────────────────
  document.getElementById('join-screen').style.display   = 'none';
  document.getElementById('editor-layout').style.display = 'flex';

  // ── Start everything ───────────────────────────────────
  setupEditor();
  // Start presence tracking
  setupPresence()
  // at the bottom of setupEditor(), before the closing }
  // at the bottom of setupEditor(), before the closing }
  setupThemeSync();
}
 // ← closing brace of setupEditor()



// ══════════════════════════════════════════════════════════
//  EDITOR SETUP  (called once after joining)
// ══════════════════════════════════════════════════════════

function setupEditor() {

  // ── Init CodeMirror ────────────────────────────────────
  editor = CodeMirror.fromTextArea(document.getElementById('editor'), {
    mode:        'javascript',
    theme:       'dracula',
    lineNumbers: true,
    indentUnit:  2,
    tabSize:     2,
    lineWrapping: true,
    autofocus:   true,
  });

  // ── Load existing code or set starter ─────────────────
  const codeRef = db.ref(`rooms/${roomId}/code`);

  codeRef.once('value', snapshot => {
    const existing = snapshot.val();
    isSyncing = true;
    editor.setValue(existing || STARTERS.javascript);
    isSyncing = false;
  });

  // ── Listen for code changes FROM Firebase ─────────────
  // (the other person typing)
  codeRef.on('value', snapshot => {
    const incoming = snapshot.val();
    if (incoming !== null && incoming !== editor.getValue()) {
      isSyncing = true;
      const cursor = editor.getCursor(); // preserve my cursor position
      editor.setValue(incoming);
      editor.setCursor(cursor);
      isSyncing = false;
    }
  });

  // ── Send MY code changes TO Firebase ──────────────────
  editor.on('change', () => {
    if (!isSyncing) {
      codeRef.set(editor.getValue());
    }
  });

  // ── Presence: register myself ─────────────────────────
  const presenceRef = db.ref(`rooms/${roomId}/users/${myName}`);
  presenceRef.set({
    name:      myName,
    color:     myColor.bg,
    textColor: myColor.text
  });
  presenceRef.onDisconnect().remove(); // auto-remove when tab closes

  // ── Listen for users joining / leaving ────────────────
  db.ref(`rooms/${roomId}/users`).on('value', snapshot => {
    renderUsers(snapshot.val() || {});
  });

  // ── Listen for chat messages ───────────────────────────
  db.ref(`rooms/${roomId}/chat`).on('child_added', snapshot => {
    const msg = snapshot.val();
    appendChatMessage(msg.name, msg.text, msg.color);
  });

  // ── Sync language when the other person changes it ────
  db.ref(`rooms/${roomId}/language`).on('value', snapshot => {
    const lang = snapshot.val();
    if (!lang) return;
    const select = document.getElementById('lang-select');
    if (select && select.value !== lang) {
      select.value = lang;
      editor.setOption('mode', MODE_MAP[lang]);
    }
  });

  // ── Live cursors: send MY cursor position ─────────────
  editor.on('cursorActivity', () => {
    const cursor = editor.getCursor();
    db.ref(`rooms/${roomId}/cursors/${myName}`).set({
      line:  cursor.line,
      ch:    cursor.ch,
      color: myColor.bg,
      name:  myName
    });
  });

  // ── Live cursors: draw OTHER people's cursors ─────────
  const cursorMarkers = {};

  db.ref(`rooms/${roomId}/cursors`).on('value', snapshot => {
    const cursors = snapshot.val() || {};

    // Remove stale markers for people who left
    Object.keys(cursorMarkers).forEach(name => {
      if (!cursors[name] || name === myName) {
        if (cursorMarkers[name]) {
          cursorMarkers[name].clear();
          delete cursorMarkers[name];
        }
      }
    });

    // Draw / update each remote cursor
    Object.entries(cursors).forEach(([name, data]) => {
      if (name === myName) return; // never draw your own cursor

      // Clear the old marker for this person
      if (cursorMarkers[name]) {
        cursorMarkers[name].clear();
      }

      // Build cursor element
      const cursorEl = document.createElement('div');
      cursorEl.className = 'remote-cursor';
      cursorEl.style.background = data.color;
      cursorEl.style.height     = '1.2em';

      // Name label above the cursor
      const labelEl = document.createElement('div');
      labelEl.className        = 'remote-cursor-label';
      labelEl.style.background = data.color;
      labelEl.style.color      = '#fff';
      labelEl.textContent      = data.name;
      cursorEl.appendChild(labelEl);

      // Place bookmark in CodeMirror at the remote cursor position
      const pos = { line: data.line, ch: data.ch };
      cursorMarkers[name] = editor.setBookmark(pos, {
        widget:     cursorEl,
        insertLeft: true
      });
    });
  });

  // Clean up my cursor from Firebase when I close the tab
  window.addEventListener('beforeunload', () => {
    db.ref(`rooms/${roomId}/cursors/${myName}`).remove();
  });
}


// ══════════════════════════════════════════════════════════
//  LANGUAGE SWITCHER
// ══════════════════════════════════════════════════════════

function changeLanguage() {
  const lang = document.getElementById('lang-select').value;

  // Update the editor's syntax highlighting mode
  editor.setOption('mode', MODE_MAP[lang]);

  // Load the starter template for this language
  editor.setValue(STARTERS[lang] || '');

  // Save language choice to Firebase so the other person's editor switches too
  db.ref(`rooms/${roomId}/language`).set(lang);
}


// ══════════════════════════════════════════════════════════
//  CODE EXECUTION
// ══════════════════════════════════════════════════════════

async function runCode() {
  const output = document.getElementById('output');
  const btn    = document.getElementById('run-btn');
  const code   = editor.getValue();
  const lang   = document.getElementById('lang-select').value;

  // HTML and CSS can't really be "run"
  if (lang === 'htmlmixed') {
    output.style.color = '#6b7280';
    output.textContent = 'HTML preview: copy the code and open in a browser tab.';
    return;
  }
  if (lang === 'css') {
    output.style.color = '#6b7280';
    output.textContent = 'CSS cannot be executed directly.';
    return;
  }

  // JavaScript runs directly in the browser (instant)
  if (lang === 'javascript') {
    runJavaScript(code);
    return;
  }

  // Python, Java, C, C++ → send to Piston API (free, no signup)
  btn.textContent = 'Running...';
  btn.disabled    = true;
  output.style.color = '#6b7280';
  output.textContent = 'Running on server...';

  const pistonLang = PISTON_LANGS[lang];
  if (!pistonLang) {
    output.textContent = 'This language is not supported for execution yet.';
    btn.textContent = 'Run ▶';
    btn.disabled    = false;
    return;
  }

  try {
    const response = await fetch('https://emkc.org/api/v2/piston/execute', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: pistonLang.language,
        version:  pistonLang.version,
        files:    [{ content: code }]
      })
    });

    const result    = await response.json();
    const runResult = result.run;

    if (runResult.stderr) {
      output.style.color = '#f87171';
      output.textContent = runResult.stderr;
    } else if (runResult.stdout) {
      output.style.color = '#6ee7b7';
      output.textContent = runResult.stdout;
    } else {
      output.style.color = '#6b7280';
      output.textContent = '(no output)';
    }

    // Show non-zero exit code
    if (runResult.code !== 0 && !runResult.stderr) {
      output.style.color = '#f87171';
      output.textContent += `\nProcess exited with code ${runResult.code}`;
    }

  } catch (err) {
    output.style.color = '#f87171';
    output.textContent = 'Network error — check your connection.\n' + err.message;
  } finally {
    btn.textContent = 'Run ▶';
    btn.disabled    = false;
  }
}

// JavaScript execution (browser-side, captures console.log)
function runJavaScript(code) {
  const output = document.getElementById('output');
  const logs   = [];

  const originalLog   = console.log;
  const originalError = console.error;
  const originalWarn  = console.warn;

  console.log = (...args) => {
    logs.push(args.map(a =>
      typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
    ).join(' '));
    originalLog(...args);
  };
  console.error = (...args) => {
    logs.push('ERROR: ' + args.join(' '));
    originalError(...args);
  };
  console.warn = (...args) => {
    logs.push('WARN: ' + args.join(' '));
    originalWarn(...args);
  };

  try {
    eval(code);
    output.style.color = '#6ee7b7';
    output.textContent = logs.length ? logs.join('\n') : '✓ Ran successfully (no output)';
  } catch (err) {
    output.style.color = '#f87171';
    output.textContent = '✗ ' + err.message;
  } finally {
    console.log   = originalLog;
    console.error = originalError;
    console.warn  = originalWarn;
  }
}


// ══════════════════════════════════════════════════════════
//  CHAT
// ══════════════════════════════════════════════════════════

function chatKeydown(e) {
  if (e.key === 'Enter') sendChat();
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || !roomId) return;
  input.value = '';

  db.ref(`rooms/${roomId}/chat`).push({
    name:  myName,
    text:  text,
    color: myColor.bg,
    time:  Date.now()
  });
}

function appendChatMessage(name, text, color) {
  const box = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `
    <div class="chat-who" style="color:${color}">${name}</div>
    <div class="chat-text">${text}</div>`;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}


// ══════════════════════════════════════════════════════════
//  USER PRESENCE (badges in top bar)
// ══════════════════════════════════════════════════════════

function renderUsers(users) {
  const container = document.getElementById('user-list');
  container.innerHTML = '';
  Object.values(users).forEach(user => {
    const badge = document.createElement('div');
    badge.className  = 'user-badge';
    badge.style.background  = user.color + '22';  // 13% opacity fill
    badge.style.color       = user.color;
    badge.style.border      = `1px solid ${user.color}44`;
    badge.style.padding     = '3px 10px';
    badge.style.borderRadius = '99px';
    badge.style.fontSize    = '11px';
    badge.style.fontWeight  = '600';
    badge.textContent = user.name;
    container.appendChild(badge);
  });
}


// ══════════════════════════════════════════════════════════
//  WHITEBOARD
// ══════════════════════════════════════════════════════════

let wbActive  = false;
let wbDrawing = false;
let wbCtx     = null;
let wbCanvas  = null;
let lastX = 0, lastY = 0;

function toggleWhiteboard() {
  const panel = document.getElementById('whiteboard-panel');
  wbActive    = !wbActive;
  panel.style.display = wbActive ? 'flex' : 'none';
  document.getElementById('wb-btn').style.color = wbActive ? '#818cf8' : '';

  // First time opening → set up the canvas
  if (wbActive && !wbCtx) {
    setupWhiteboard();
  }
}

function setupWhiteboard() {
  wbCanvas = document.getElementById('wb-canvas');
  wbCtx    = wbCanvas.getContext('2d');

  // Make canvas fill the panel
  function resizeCanvas() {
    const rect    = wbCanvas.getBoundingClientRect();
    wbCanvas.width  = rect.width;
    wbCanvas.height = rect.height;
    loadWhiteboardSnapshot(); // redraw after resize
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ── Mouse events ──────────────────────────────────────
  wbCanvas.addEventListener('mousedown', e => {
    wbDrawing = true;
    const r = wbCanvas.getBoundingClientRect();
    lastX = e.clientX - r.left;
    lastY = e.clientY - r.top;
  });

  wbCanvas.addEventListener('mousemove', e => {
    if (!wbDrawing) return;
    const r     = wbCanvas.getBoundingClientRect();
    const x     = e.clientX - r.left;
    const y     = e.clientY - r.top;
    const color = document.getElementById('wb-color').value;
    const size  = document.getElementById('wb-size').value;

    drawLine(lastX, lastY, x, y, color, size);
    sendStroke(lastX, lastY, x, y, color, size);

    lastX = x;
    lastY = y;
  });

  wbCanvas.addEventListener('mouseup',    () => { wbDrawing = false; });
  wbCanvas.addEventListener('mouseleave', () => { wbDrawing = false; });

  // ── Touch events (for mobile / tablet) ────────────────
  wbCanvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.touches[0];
    const r = wbCanvas.getBoundingClientRect();
    lastX = t.clientX - r.left;
    lastY = t.clientY - r.top;
    wbDrawing = true;
  }, { passive: false });

  wbCanvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!wbDrawing) return;
    const t     = e.touches[0];
    const r     = wbCanvas.getBoundingClientRect();
    const x     = t.clientX - r.left;
    const y     = t.clientY - r.top;
    const color = document.getElementById('wb-color').value;
    const size  = document.getElementById('wb-size').value;

    drawLine(lastX, lastY, x, y, color, size);
    sendStroke(lastX, lastY, x, y, color, size);

    lastX = x;
    lastY = y;
  }, { passive: false });

  wbCanvas.addEventListener('touchend', () => { wbDrawing = false; });

  // ── Listen for OTHER person's strokes from Firebase ───
  db.ref(`rooms/${roomId}/whiteboard/strokes`).on('child_added', snapshot => {
    const s = snapshot.val();
    drawLine(
      s.x1 * wbCanvas.width,  s.y1 * wbCanvas.height,
      s.x2 * wbCanvas.width,  s.y2 * wbCanvas.height,
      s.color, s.size
    );
  });

  // ── Listen for clear events ────────────────────────────
  db.ref(`rooms/${roomId}/whiteboard/cleared`).on('value', snapshot => {
    if (snapshot.val() && wbCtx) {
      wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    }
  });
}

// Send a stroke to Firebase (stored as ratios so it works on any screen size)
function sendStroke(x1, y1, x2, y2, color, size) {
  db.ref(`rooms/${roomId}/whiteboard/strokes`).push({
    x1: x1 / wbCanvas.width,
    y1: y1 / wbCanvas.height,
    x2: x2 / wbCanvas.width,
    y2: y2 / wbCanvas.height,
    color,
    size,
    t: Date.now()
  });
}

// Draw a single line segment on the canvas
function drawLine(x1, y1, x2, y2, color, size) {
  wbCtx.beginPath();
  wbCtx.moveTo(x1, y1);
  wbCtx.lineTo(x2, y2);
  wbCtx.strokeStyle = color;
  wbCtx.lineWidth   = size;
  wbCtx.lineCap     = 'round';
  wbCtx.lineJoin    = 'round';
  wbCtx.stroke();
}

// Clear the whiteboard for everyone in the room
function clearWhiteboard() {
  if (!wbCtx) return;
  wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
  db.ref(`rooms/${roomId}/whiteboard`).remove().then(() => {
    db.ref(`rooms/${roomId}/whiteboard/cleared`).set(Date.now());
  });
}

// Replay all saved strokes (called after resize or on first open)
function loadWhiteboardSnapshot() {
  if (!wbCtx) return;
  db.ref(`rooms/${roomId}/whiteboard/strokes`).once('value', snapshot => {
    const strokes = snapshot.val();
    if (!strokes) return;
    Object.values(strokes).forEach(s => {
      drawLine(
        s.x1 * wbCanvas.width,  s.y1 * wbCanvas.height,
        s.x2 * wbCanvas.width,  s.y2 * wbCanvas.height,
        s.color, s.size
      );
    });
  });
}


// ══════════════════════════════════════════════════════════
//  SHARE LINK
// ══════════════════════════════════════════════════════════

function copyLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.btn-share');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 2000);
  }).catch(() => {
    // Fallback for browsers that block clipboard
    prompt('Copy this link:', url);
  });
}


// ══════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════

// Generate a random 6-character room ID like "xk92mf"
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8);
}


// ══════════════════════════════════════════════════════════
//  ON PAGE LOAD
// ══════════════════════════════════════════════════════════

window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) {
    // Someone opened a shared link — pre-fill the room ID
    const roomInput = document.getElementById('room-input');
    if (roomInput) roomInput.value = params.get('room');

    const hint = document.getElementById('join-hint');
    if (hint) {
      hint.style.color = '#50fa7b';
      hint.textContent = 'Room found! Enter your name to join.';
    }
  }
});
// ══════════════════════════════════════════════════════════
//  VIDEO / AUDIO  —  WebRTC peer-to-peer
// ══════════════════════════════════════════════════════════

let localStream    = null;   // my camera + mic
let peerConnection = null;   // WebRTC connection to the other person
let isMuted        = false;
let isVideoOff     = false;

// Free STUN servers — help browsers find each other
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function startCall() {
  try {
    // 1. Get camera + mic
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    // Show my own video (muted so I don't hear myself)
    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;

    // Hide "click call" message
    document.getElementById('no-call-msg').style.display = 'none';

    // Show End button, hide Call button
    document.getElementById('btn-call').style.display   = 'none';
    document.getElementById('btn-hangup').style.display = '';

    // 2. Create peer connection
    peerConnection = new RTCPeerConnection(RTC_CONFIG);

    // Add my stream tracks to the connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // When I receive the other person's stream → show it
    peerConnection.ontrack = event => {
      const remoteVideo = document.getElementById('remote-video');
      remoteVideo.srcObject = event.streams[0];
    };

    // When ICE candidates are found → send to Firebase
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        db.ref(`rooms/${roomId}/webrtc/candidates/${myName}`).push(
          event.candidate.toJSON()
        );
      }
    };

    // 3. Listen for the other person's offer or answer
    const sigRef = db.ref(`rooms/${roomId}/webrtc/signal`);

    sigRef.on('value', async snapshot => {
      const data = snapshot.val();
      if (!data || data.from === myName) return; // ignore my own signals

      if (data.type === 'offer') {
        // Someone called me → send answer
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(data)
        );
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sigRef.set({ ...answer.toJSON(), from: myName });

      } else if (data.type === 'answer') {
        // They answered my call
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(data)
        );
      }
    });

    // 4. Listen for their ICE candidates
    db.ref(`rooms/${roomId}/webrtc/candidates`).on('child_added',
      snapshot => {
        const senderName = snapshot.key;
        if (senderName === myName) return; // skip my own

        snapshot.forEach(candSnap => {
          const candidate = new RTCIceCandidate(candSnap.val());
          peerConnection.addIceCandidate(candidate).catch(() => {});
        });
      }
    );

    // 5. Create and send an offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sigRef.set({ ...offer.toJSON(), from: myName });

  } catch (err) {
    console.error('Call error:', err);
    // Common errors:
    // NotAllowedError  → user denied camera/mic permission
    // NotFoundError    → no camera/mic found
    const output = document.getElementById('output');
    output.style.color = '#f87171';
    output.textContent = 'Camera/mic error: ' + err.message
      + '\n\nMake sure you allowed camera and microphone access.';
  }
}

function hangUp() {
  // Stop all tracks
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  // Close peer connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  // Clear videos
  document.getElementById('local-video').srcObject  = null;
  document.getElementById('remote-video').srcObject = null;

  // Clear Firebase signaling data for this room
  db.ref(`rooms/${roomId}/webrtc`).remove();

  // Reset UI
  document.getElementById('no-call-msg').style.display = '';
  document.getElementById('btn-call').style.display    = '';
  document.getElementById('btn-hangup').style.display  = 'none';

  // Reset mute/video button states
  isMuted    = false;
  isVideoOff = false;
  document.getElementById('btn-mute').classList.remove('muted');
  document.getElementById('btn-video').classList.remove('off');
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  const btn = document.getElementById('btn-mute');
  btn.textContent = isMuted ? '🔇' : '🎤';
  btn.classList.toggle('muted', isMuted);
}

function toggleVideo() {
  if (!localStream) return;
  isVideoOff = !isVideoOff;
  localStream.getVideoTracks().forEach(t => { t.enabled = !isVideoOff; });
  const btn = document.getElementById('btn-video');
  btn.textContent = isVideoOff ? '🚫' : '📷';
  btn.classList.toggle('off', isVideoOff);
}

// Clean up call when tab closes
window.addEventListener('beforeunload', () => {
  hangUp();
});


// ══════════════════════════════════════════════════════════
//  PRESENCE INDICATORS
//  Shows: who's online, typing status, last active
// ══════════════════════════════════════════════════════════

let typingTimer = null;

// Called every keystroke in the chat input
function sendTyping() {
  if (!roomId || !myName) return;
  db.ref(`rooms/${roomId}/presence/${myName}/typing`).set(true);

  // Clear typing status after 2 seconds of no typing
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    db.ref(`rooms/${roomId}/presence/${myName}/typing`).set(false);
  }, 2000);
}

// Set up full presence tracking — call this inside setupEditor()
function setupPresence() {
  const myPresenceRef = db.ref(`rooms/${roomId}/presence/${myName}`);

  // Write my presence
  myPresenceRef.set({
    name:       myName,
    color:      myColor.bg,
    online:     true,
    typing:     false,
    lastSeen:   Date.now()
  });

  // Auto-remove when I disconnect
  myPresenceRef.onDisconnect().remove();

  // Update lastSeen every 30 seconds so others know I'm still here
  setInterval(() => {
    myPresenceRef.update({ lastSeen: Date.now() });
  }, 30000);

  // Listen for all presence changes and render the list
  db.ref(`rooms/${roomId}/presence`).on('value', snapshot => {
    const all = snapshot.val() || {};
    renderPresenceList(all);
  });
}

function renderPresenceList(all) {
  const list = document.getElementById('presence-list');
  if (!list) return;
  list.innerHTML = '';

  Object.values(all).forEach(user => {
    const row = document.createElement('div');
    row.className = 'presence-row';

    const isMe = user.name === myName;

    // Colored dot
    const dot = document.createElement('div');
    dot.className        = 'presence-dot';
    dot.style.background = user.color || '#818cf8';

    // Name
    const name = document.createElement('div');
    name.className   = 'presence-name';
    name.textContent = user.name + (isMe ? ' (you)' : '');
    name.style.color = user.color || '#e2e8f0';

    // Status — typing or online
    const status = document.createElement('div');
    if (user.typing && !isMe) {
      status.className   = 'typing-indicator';
      status.textContent = 'typing...';
    } else {
      status.className   = 'presence-status';
      status.textContent = 'online';
    }

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(status);
    list.appendChild(row);
  });
}
const CM_THEMES = {
  'dracula':     'dracula',
  'github-dark': 'dracula',   // closest available CM theme
  'monokai':     'monokai',
  'night-owl':   'dracula',
  'light':       'default'
};

function changeTheme(themeName) {
  // 1. Update CSS variables by switching data-theme on <body>
  document.body.setAttribute('data-theme', themeName);

  // 2. Update CodeMirror editor theme
  if (editor) {
    editor.setOption('theme', CM_THEMES[themeName] || 'dracula');
  }

  // 3. Save preference to localStorage so it persists on refresh
  localStorage.setItem('collabcode-theme', themeName);

  // 4. Sync theme to Firebase so the other person's editor changes too
  if (roomId) {
    db.ref(`rooms/${roomId}/theme`).set(themeName);
  }
}

// Listen for theme changes from the other person
// Call this inside setupEditor() — add at the bottom before closing }
function setupThemeSync() {
  // Load saved theme on page open
  const saved = localStorage.getItem('collabcode-theme');
  if (saved) {
    document.body.setAttribute('data-theme', saved);
    const select = document.getElementById('theme-select');
    if (select) select.value = saved;
    if (editor) editor.setOption('theme', CM_THEMES[saved] || 'dracula');
  }

  // Listen for theme changes from Firebase (other person changed it)
  db.ref(`rooms/${roomId}/theme`).on('value', snapshot => {
    const incoming = snapshot.val();
    if (!incoming) return;

    document.body.setAttribute('data-theme', incoming);
    if (editor) editor.setOption('theme', CM_THEMES[incoming] || 'dracula');

    const select = document.getElementById('theme-select');
    if (select && select.value !== incoming) select.value = incoming;
  });
}


// ══════════════════════════════════════════════════════════
//  AI CODE SUGGESTIONS  (Claude API)
// ══════════════════════════════════════════════════════════

// ── IMPORTANT: Add your Anthropic API key here ────────────
// Get one free at console.anthropic.com ($5 free credits)
const ANTHROPIC_KEY = 'PASTE_YOUR_ANTHROPIC_KEY_HERE';

let currentSuggestion = ''; // stores the suggestion text so we can insert it

async function getAISuggestion() {
  if (!editor) return;

  const btn        = document.getElementById('btn-ai');
  const box        = document.getElementById('ai-suggestion-box');
  const actions    = document.getElementById('ai-suggestion-actions');
  const lang       = document.getElementById('lang-select').value;

  // Show loading state
  btn.classList.add('loading');
  btn.disabled = true;
  box.classList.remove('visible');
  actions.classList.remove('visible');

  // Get the full code and cursor position
  const code        = editor.getValue();
  const cursor      = editor.getCursor();
  const cursorLine  = cursor.line;

  // Split code at cursor so Claude knows where we are
  const lines       = code.split('\n');
  const codeBefore  = lines.slice(0, cursorLine + 1).join('\n');
  const codeAfter   = lines.slice(cursorLine + 1).join('\n');

  const prompt = `You are an expert ${lang} programmer acting as an AI code completion assistant.

Here is the code BEFORE the cursor:
\`\`\`${lang}
${codeBefore}
\`\`\`

${codeAfter ? `Here is the code AFTER the cursor:\n\`\`\`${lang}\n${codeAfter}\n\`\`\`` : ''}

Suggest the next 3-8 lines of code that would logically continue from the cursor position.

Rules:
- Output ONLY the raw code to insert. No explanation, no markdown, no backticks.
- Match the existing indentation style exactly.
- Make it genuinely useful — complete a function, add error handling, etc.
- If the code is complete and nothing useful can be added, respond with: // Code looks complete!`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001', // fastest + cheapest model
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data       = await response.json();
    currentSuggestion = data.content[0].text.trim();

    // Show the suggestion strip
    box.textContent = currentSuggestion;
    box.classList.add('visible');
    actions.classList.add('visible');

  } catch (err) {
    box.textContent = '✗ Could not get suggestion: ' + err.message;
    box.classList.add('visible');
    actions.classList.remove('visible');
    console.error('AI suggestion error:', err);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// Insert the suggestion into the editor at the current cursor
function acceptSuggestion() {
  if (!currentSuggestion || !editor) return;

  const cursor = editor.getCursor();

  // Insert on a new line below the cursor
  const insertPos = { line: cursor.line, ch: editor.getLine(cursor.line).length };
  editor.replaceRange('\n' + currentSuggestion, insertPos);

  // Move cursor to end of inserted text
  const newLines    = currentSuggestion.split('\n').length;
  const lastLineLen = currentSuggestion.split('\n').pop().length;
  editor.setCursor({ line: cursor.line + newLines, ch: lastLineLen });
  editor.focus();

  dismissSuggestion();
}

function dismissSuggestion() {
  currentSuggestion = '';
  document.getElementById('ai-suggestion-box').classList.remove('visible');
  document.getElementById('ai-suggestion-actions').classList.remove('visible');
}

// Keyboard shortcut: Ctrl+Shift+Space to trigger AI suggestion
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
    e.preventDefault();
    getAISuggestion();
  }
  // Escape to dismiss suggestion
  if (e.key === 'Escape') {
    dismissSuggestion();
  }
});


// ══════════════════════════════════════════════════════════
//  HOW TO WIRE THESE UP
// ══════════════════════════════════════════════════════════
//
//  Inside setupEditor(), add this ONE line at the very end
//  before the closing } :
//
//    setupThemeSync();
//
//  That's it! Everything else is automatic.
//
//  KEYBOARD SHORTCUTS:
//    Ctrl + Shift + Space  →  Get AI suggestion
//    Escape                →  Dismiss suggestion
//    Click "Accept ↵"      →  Insert suggestion into editor
//    Click "Dismiss"       →  Hide suggestion
//
// ══════════════════════════════════════════════════════════
