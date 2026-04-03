const firebaseConfig = {
  apiKey: "AIzaSyAfODir4IgA_Q4oiw6bhkimgB9wD67gzHU",
  authDomain: "collabcode-90630.firebaseapp.com",
  databaseURL: "https://collabcode-90630-default-rtdb.firebaseio.com",
  projectId: "collabcode-90630",
  storageBucket: "collabcode-90630.firebasestorage.app",
  messagingSenderId: "479153479403",
  appId: "1:479153479403:web:f2db9ab63165c979e128ae"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ── State ──
let editor;
let roomId;
let myName;
let myColor;
let isSyncing = false;

const COLORS = [
  { bg: '#4f46e5', text: '#e0e7ff' },
  { bg: '#be185d', text: '#fce7f3' },
  { bg: '#0f766e', text: '#ccfbf1' },
  { bg: '#b45309', text: '#fef3c7' },
  { bg: '#6d28d9', text: '#ede9fe' },
];

// ── Join Room ──
function joinRoom() {
  const nameInput = document.getElementById('name-input').value.trim();
  if (!nameInput) {
    document.getElementById('join-hint').textContent = 'Please enter your name first.';
    return;
  }

  myName = nameInput;
  myColor = COLORS[Math.floor(Math.random() * COLORS.length)];

  // Get room ID from URL, or create a new one
  const params = new URLSearchParams(window.location.search);
  roomId = params.get('room') || generateRoomId();

  // Update URL so this link can be shared
  window.history.replaceState({}, '', `?room=${roomId}`);
  document.getElementById('room-id').textContent = roomId;

  // Hide join screen, show editor
  document.getElementById('join-screen').style.display = 'none';
  document.getElementById('editor-layout').style.display = 'flex';

  // Set up CodeMirror editor
  editor = CodeMirror.fromTextArea(document.getElementById('editor'), {
    mode: 'javascript',
    theme: 'dracula',
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
    autofocus: true,
  });

  // Load existing code from Firebase
  const codeRef = db.ref(`rooms/${roomId}/code`);
  codeRef.once('value', snapshot => {
    const existing = snapshot.val();
    if (existing) {
      isSyncing = true;
      editor.setValue(existing);
      isSyncing = false;
    } else {
      // Set starter code for new rooms
      const starter = `// Welcome to CollabCode!
// Share the link and code together in real time.

function greet(name) {
  return "Hello, " + name + "!";
}

console.log(greet("World"));`;
      editor.setValue(starter);
    }
  });

  // Listen for code changes FROM Firebase (other person typing)
  codeRef.on('value', snapshot => {
    const incoming = snapshot.val();
    if (incoming !== null && incoming !== editor.getValue()) {
      isSyncing = true;
      const cursor = editor.getCursor();
      editor.setValue(incoming);
      editor.setCursor(cursor);
      isSyncing = false;
    }
  });

  // Send code changes TO Firebase (you typing)
  editor.on('change', () => {
    if (!isSyncing) {
      codeRef.set(editor.getValue());
    }
  });

  // Register presence (show who's in the room)
  const presenceRef = db.ref(`rooms/${roomId}/users/${myName}`);
  presenceRef.set({ name: myName, color: myColor.bg, textColor: myColor.text });
  presenceRef.onDisconnect().remove(); // auto-remove when browser closes

  // Listen for other users joining/leaving
  db.ref(`rooms/${roomId}/users`).on('value', snapshot => {
    const users = snapshot.val() || {};
    renderUsers(users);
  });

  // Listen for chat messages
  db.ref(`rooms/${roomId}/chat`).on('child_added', snapshot => {
    const msg = snapshot.val();
    appendChatMessage(msg.name, msg.text, msg.color);
  });

  document.getElementById('join-hint').textContent = '';
}

// ── Render user badges ──
function renderUsers(users) {
  const container = document.getElementById('user-list');
  container.innerHTML = '';
  Object.values(users).forEach(user => {
    const badge = document.createElement('div');
    badge.className = 'user-badge';
    badge.style.background = user.color + '22';
    badge.style.color = user.color;
    badge.style.border = `1px solid ${user.color}44`;
    badge.textContent = user.name;
    container.appendChild(badge);
  });
}

// ── Chat ──
function chatKeydown(e) {
  if (e.key === 'Enter') sendChat();
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !roomId) return;
  input.value = '';
  db.ref(`rooms/${roomId}/chat`).push({
    name: myName,
    text: text,
    color: myColor.bg,
    time: Date.now()
  });
}

function appendChatMessage(name, text, color) {
  const box = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `<div class="chat-who" style="color:${color}">${name}</div><div class="chat-text">${text}</div>`;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}

// ── Run code ──
function runCode() {
  const output = document.getElementById('output');
  const code = editor.getValue();
  const logs = [];

  // Capture console.log output
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(a => JSON.stringify(a)).join(' '));
    originalLog(...args);
  };

  try {
    eval(code);
    output.style.color = '#6ee7b7';
    output.textContent = logs.length ? logs.join('\n') : '✓ Ran successfully (no output)';
  } catch (err) {
    output.style.color = '#f87171';
    output.textContent = '✗ ' + err.message;
  } finally {
    console.log = originalLog;
  }
}

// ── Copy invite link ──
function copyLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.btn-share');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy invite link', 2000);
  });
}

// ── Utilities ──
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8);
}

// Auto-join if name is in URL (e.g. for quick testing)
window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) {
    document.getElementById('join-hint').textContent =
      'Room found! Enter your name to join.';
  }
});
// Language starter templates
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

function changeLanguage() {
  const lang = document.getElementById('lang-select').value;

  // Update CodeMirror mode
  const modeMap = {
    javascript: 'javascript',
    python: 'python',
    java: 'text/x-java',
    cpp: 'text/x-c++src',
    c: 'text/x-csrc',
    htmlmixed: 'htmlmixed',
    css: 'css'
  };
  editor.setOption('mode', modeMap[lang]);

  // Load starter template and sync to Firebase
  const starter = STARTERS[lang] || '';
  editor.setValue(starter);

  // Save language choice to Firebase so the other person's editor switches too
  db.ref(`rooms/${roomId}/language`).set(lang);
}
// test commit 