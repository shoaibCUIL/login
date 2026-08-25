/* ============================================================
   app.js — screens, test flow, marking, admin.
   ============================================================ */
const KEY = "twoc1p_v5_email";
const $ = (id) => document.getElementById(id);
const el = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^92/, "0").replace(/^0?3/, "03");
const normalizeEmail = (s) => String(s || "").trim().toLowerCase();
const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(s));
const studentName = (s) => {
  if (s && s.name) return s.name;
  const local = normalizeEmail(s && s.email).split("@")[0] || "Student";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

let S = load();
let editor = null, practice = null, run = null, timer = null;

/* ---------- state ------------------------------------------ */
function blank() {
  return { student: null, tests: {}, current: null, badges: [], prefs: { theme: "light", sound: CONFIG.sound }, drafts: {}, attendance: {} };
}
function load() {
  try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return blank(); }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }

/* ---------- helpers ---------------------------------------- */
function pktNow() {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + 300) * 60000);
}
function windowOpen() {
  if (!CONFIG.enforceWindow) return true;
  const h = pktNow().getHours();
  return h >= CONFIG.windowOpenHour && h < CONFIG.windowCloseHour;
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2600);
}
function ask(title, body, yes) {
  $("modalTitle").textContent = title; $("modalBody").textContent = body;
  $("modal").hidden = false;
  $("modalYes").onclick = () => { $("modal").hidden = true; yes(); };
  $("modalNo").onclick = () => ($("modal").hidden = true);
}
function beep(kind) {
  if (!S.prefs.sound) return;
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.frequency.value = kind === "ok" ? 660 : 220;
    g.gain.setValueAtTime(.06, a.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + .25);
    o.start(); o.stop(a.currentTime + .25);
  } catch {}
}
function band(text) { $("bandText").textContent = text; }
function show(name) {
  ["scSignin", "scHome", "scTest", "scResult", "scAdmin"].forEach((s) => ($(s).hidden = true));
  $(name).hidden = false;
  window.scrollTo(0, 0);
}
async function sha256(text) {
  if (!window.crypto || !crypto.subtle) throw new Error("nosubtle");
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function testById(id) { return BANK.find((t) => t.id === id); }
function questions(t) {
  return [...t.mcq.map((q, i) => ({ ...q, type: "mcq", qid: `${t.id}-m${i}` })),
          ...t.code.map((q, i) => ({ ...q, type: "code", qid: `${t.id}-c${i}` }))];
}
function maxScore(t) { return questions(t).length * CONFIG.pointsFirstAttempt; }

/* ---------- boot -------------------------------------------- */
function boot() {
  document.documentElement.dataset.theme = S.prefs.theme;
  $("footInstructor").textContent = `${CONFIG.instructor} · ${CONFIG.instructorPhone}`;
  $("footWindow").textContent = CONFIG.enforceWindow
    ? `Tests open ${CONFIG.windowOpenHour}:00–midnight PKT`
    : "Time window off";
  $("waHelp").href = `https://wa.me/${CONFIG.whatsapp}`;
  el(".course").textContent = `${CONFIG.courseName} · ${CONFIG.courseLength}`;

  $("themeBtn").onclick = () => {
    S.prefs.theme = S.prefs.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = S.prefs.theme; save();
  };
  $("soundBtn").onclick = () => { S.prefs.sound = !S.prefs.sound; save(); toast("Sound " + (S.prefs.sound ? "on" : "off")); };
  $("helpBtn").onclick = () => ask("Keyboard shortcuts",
    "Tab indents four spaces · Shift+Tab removes them · Enter keeps your indent and adds one level after a colon · Ctrl+/ comments a line · Ctrl+Enter runs your code.", () => {});
  $("signInBtn").onclick = signIn;
  $("email").addEventListener("keydown", (e) => e.key === "Enter" && signIn());
  $("signOut").onclick = () => ask("Sign out?", "Your scores stay in this browser.", () => { S.student = null; S.current = null; save(); render(); });
  $("backHome").onclick = render;
  $("adminHint").onclick = openAdmin;
  $("adminGo").onclick = adminCheck;
  $("adminPass").addEventListener("keydown", (e) => e.key === "Enter" && adminCheck());
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); openAdmin(); }
  });
  if (location.hash === "#admin") openAdmin();

  if (CONFIG.watchTabs) document.addEventListener("visibilitychange", () => {
    if (document.hidden && S.current) { S.current.tabSwitches = (S.current.tabSwitches || 0) + 1; save(); }
  });
  window.addEventListener("beforeunload", (e) => { if (S.current) { e.preventDefault(); e.returnValue = ""; } });
  history.pushState({ app: 1 }, "");
  window.addEventListener("popstate", () => {
    history.pushState({ app: 1 }, "");
    if (S.current) toast("Use the buttons on the page — the back button is disabled during a test.");
  });

  typeDemo();
  render();
  band(windowOpen() ? "tests open" : "outside test hours");
}

/* typing demo on the sign-in screen */
function typeDemo() {
  const lines = [
    "words = open('corpus.txt').read().split()",
    "freq = {}",
    "for w in words:",
    "    freq[w] = freq.get(w, 0) + 1",
    "",
    "top = sorted(freq, key=freq.get, reverse=True)[:3]",
    "print(top)",
    "# ['the', 'of', 'and']",
  ];
  const host = $("demoCode");
  let li = 0, ci = 0, out = "";
  (function tick() {
    if (li >= lines.length) return;
    out += lines[li][ci] || "";
    ci++;
    if (ci > lines[li].length) { out += "\n"; li++; ci = 0; }
    host.textContent = out + "▌";
    setTimeout(tick, lines[li] ? 22 : 260);
  })();
}

/* ---------- sign in ----------------------------------------- */
function signIn() {
  const email = normalizeEmail($("email").value);
  const err = $("signinErr");

  if (!email) {
    err.hidden = false;
    err.textContent = "Type your email address to sign in.";
    return;
  }
  if (!isValidEmail(email)) {
    err.hidden = false;
    err.textContent = "Enter a valid email address.";
    return;
  }

  const hit = ROSTER.find((r) => normalizeEmail(r.email) === email);
  if (!hit) {
    err.hidden = false;
    err.textContent = "This email is not on the class list. Check the address, or message the instructor.";
    return;
  }

  err.hidden = true;
  S.student = { name: studentName(hit), email };
  save(); beep("ok"); render();
}

/* ---------- render ------------------------------------------ */
function render() {
  $("who").hidden = !S.student;
  if (!S.student) return show("scSignin");
  $("whoName").textContent = studentName(S.student);
  if (S.current) return renderQuestion();
  renderHome();
}

function renderHome() {
  show("scHome");
  $("homeGreeting").textContent = `Hello, ${studentName(S.student).split(" ")[0]}`;
  const done = BANK.filter((t) => S.tests[t.id]);
  const earned = done.reduce((a, t) => a + S.tests[t.id].score, 0);
  const possible = done.reduce((a, t) => a + maxScore(t), 0);
  const pct = possible ? Math.round((earned / possible) * 100) : 0;
  $("dialPct").textContent = pct + "%";
  $("dialFg").style.strokeDashoffset = String(327 - (327 * pct) / 100);

  const passed = done.filter((t) => (S.tests[t.id].score / maxScore(t)) * 100 >= CONFIG.passPercent).length;
  $("homeStats").innerHTML = [
    [`${done.length}/${BANK.length}`, "tests taken"],
    [`${passed}`, "tests passed"],
    [`${earned}`, "points earned"],
    [`${CONFIG.passPercent}%`, "needed to pass"],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join("");

  $("testList").innerHTML = BANK.map((t, i) => {
    const r = S.tests[t.id];
    const pc = r ? Math.round((r.score / maxScore(t)) * 100) : 0;
    const state = !r ? "open" : pc >= CONFIG.passPercent ? "done" : "fail";
    const label = !r ? "Not taken" : `${r.score}/${maxScore(t)} · ${pc}%`;
    const pill = !r ? "" : `<span class="pill ${pc >= CONFIG.passPercent ? "pass" : "fail"}">${pc >= CONFIG.passPercent ? "passed" : "below " + CONFIG.passPercent + "%"}</span>`;
    return `<div class="trow ${state}">
      <div class="grow"><h4>${i + 1}. ${esc(t.title)}</h4><p>${esc(t.blurb)}</p></div>
      ${pill}<span class="pill">${label}</span>
      <button class="${r ? "ghost" : "primary"} sm" data-start="${t.id}">${r ? "Review" : "Start test"}</button>
    </div>`;
  }).join("");
  $("testList").querySelectorAll("[data-start]").forEach((b) => {
    b.onclick = () => (S.tests[b.dataset.start] ? showResult(b.dataset.start) : startTest(b.dataset.start));
  });

  const BADGES = [
    ["✏️", "First test", () => done.length >= 1],
    ["🎯", "Full marks", () => done.some((t) => S.tests[t.id].score === maxScore(t))],
    ["🐍", "Code clean", () => done.some((t) => S.tests[t.id].answers.some((a) => a.type === "code" && a.awarded === CONFIG.pointsFirstAttempt))],
    ["📚", "Half way", () => done.length >= 3],
    ["🧠", "No hints", () => done.some((t) => S.tests[t.id].answers.every((a) => !a.hintUsed))],
    ["⚡", "Beat the clock", () => done.some((t) => !S.tests[t.id].timedOut)],
    ["🏅", "All passed", () => passed === BANK.length],
    ["🎓", "Certificate", () => pct >= CONFIG.passPercent && done.length === BANK.length],
  ];
  $("badgeGrid").innerHTML = BADGES.map(([i, n, f]) =>
    `<div class="badge ${f() ? "on" : ""}"><i>${i}</i>${n}</div>`).join("");

  if (CONFIG.allowPractice) setupPractice(); else $("practiceCard").hidden = true;
}

/* ---------- practice console -------------------------------- */
function setupPractice() {
  if (practice) return;
  practice = new PyEditor($("practiceHost"), {
    indentSize: CONFIG.indentSize, strictIndent: CONFIG.strictIndent, banTabs: CONFIG.banTabs,
    liveLint: CONFIG.liveLint, blockPaste: false,
    value: 'words = "the cat sat on the mat".split()\nfor w in words:\n    print(w.upper())\n',
    onChange: (p, ed) => paintProblems($("practiceProblems"), p, ed),
    onRun: practiceRun,
  });
  $("practiceRun").onclick = practiceRun;
  $("practiceFix").onclick = () => { practice.fixIndentation(); toast("Indentation cleaned up"); };
  $("practiceClear").onclick = () => { practice.setValue(""); $("practiceOut").textContent = ""; };
}
async function practiceRun() {
  const out = $("practiceOut");
  out.textContent = "Running…";
  try {
    const r = await PyEngine.execute(practice.value, null, [], band);
    out.textContent = r.error ? "" : (r.stdout || "(no output)");
    paintProblems($("practiceProblems"), practice.problems, practice, r);
  } catch (e) { out.textContent = e.message; }
}

/* ---------- problems panel ---------------------------------- */
function paintProblems(host, problems, ed, result) {
  let html = "";
  if (result && result.error) {
    const e = result.error;
    const line = e.line ? `line ${e.line}` : "";
    const help = explainError(e.msg);
    html += `<button class="prob" data-line="${e.line || 1}">
      <span class="ln">${esc(e.kind)}${line ? " · " + line : ""}</span>
      <span>${esc(e.msg)}${help ? `<span class="help">${esc(help)}</span>` : ""}</span></button>`;
    if (e.text) {
      const caret = " ".repeat(Math.max(0, (e.col || 1) - 1)) + "^";
      html += `<pre class="trace">${esc(e.text.replace(/\n$/, ""))}\n<span class="caret">${caret}</span></pre>`;
    }
  } else if (problems && problems.length) {
    html += problems.slice(0, 6).map((p) => {
      const help = explainError(p.msg);
      return `<button class="prob" data-line="${p.line}">
        <span class="ln">line ${p.line}</span>
        <span>${esc(p.msg)}${help ? `<span class="help">${esc(help)}</span>` : ""}</span></button>`;
    }).join("");
  } else if (result) {
    html = `<div class="prob ok"><span class="ln">no errors</span><span>Your code compiled and ran.</span></div>`;
  }
  host.innerHTML = html;
  host.querySelectorAll("[data-line]").forEach((b) => (b.onclick = () => ed.gotoLine(+b.dataset.line)));
}

/* ---------- test flow --------------------------------------- */
function startTest(id) {
  if (!windowOpen()) {
    return ask("Tests are closed right now",
      `Tests can only be taken between ${CONFIG.windowOpenHour}:00 and midnight Pakistan time. The practice console stays open all day.`, () => {});
  }
  if (S.tests[id]) return showResult(id);
  const t = testById(id);
  ask("Start this test?",
    `${t.title} — ${questions(t).length} questions, ${CONFIG.timeLimitMin || "no"} minute limit. Once you submit an answer you cannot go back to it.`,
    () => {
      S.current = {
        testId: id, index: 0, answers: [], startedAt: Date.now(),
        deadline: CONFIG.timeLimitMin ? Date.now() + CONFIG.timeLimitMin * 60000 : 0,
        tabSwitches: 0, attempt: 1, hintUsed: false, timedOut: false,
      };
      save(); renderQuestion();
    });
}

function currentQ() {
  const t = testById(S.current.testId);
  return questions(t)[S.current.index];
}

function renderQuestion() {
  show("scTest");
  const c = S.current, t = testById(c.testId), qs = questions(t), q = qs[c.index];
  $("ribTest").textContent = t.title;
  $("ribNow").textContent = c.index + 1;
  $("ribTotal").textContent = qs.length;
  $("ribScore").textContent = c.answers.reduce((a, x) => a + x.awarded, 0);
  $("qKind").textContent = q.type === "mcq" ? `Multiple choice · question ${c.index + 1}` : `Write code · question ${c.index + 1}`;
  $("qText").innerHTML = q.q;
  $("verdict").hidden = true;
  $("nextBtn").hidden = true;
  $("submitBtn").hidden = false;
  $("submitBtn").disabled = q.type === "mcq";
  $("hintBtn").hidden = !CONFIG.allowHints;
  $("hintBtn").disabled = false;
  $("attempts").textContent = `Attempt ${c.attempt} of ${CONFIG.maxAttempts} · worth ${c.attempt === 1 ? CONFIG.pointsFirstAttempt : CONFIG.pointsSecondAttempt} points`;
  startTimer();

  if (q.type === "mcq") {
    $("mcqBox").hidden = false; $("codeBox").hidden = true;
    c.picked = null;
    $("options").innerHTML = q.options.map((o, i) =>
      `<button class="opt" data-i="${i}"><span class="key">${"ABCD"[i]}</span><span>${o}</span></button>`).join("");
    $("options").querySelectorAll(".opt").forEach((b) => {
      b.onclick = () => {
        $("options").querySelectorAll(".opt").forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel"); c.picked = +b.dataset.i; $("submitBtn").disabled = false;
      };
    });
  } else {
    $("mcqBox").hidden = true; $("codeBox").hidden = false;
    $("codeBrief").innerHTML = q.brief;
    $("codeOut").textContent = ""; $("cases").innerHTML = "";
    const draft = S.drafts[q.qid];
    editor = new PyEditor($("editorHost"), {
      indentSize: CONFIG.indentSize, strictIndent: CONFIG.strictIndent, banTabs: CONFIG.banTabs,
      liveLint: CONFIG.liveLint, blockPaste: CONFIG.blockPaste,
      value: draft || q.starter,
      onChange: (p, ed) => { paintProblems($("problems"), p, ed); S.drafts[q.qid] = ed.value; save(); },
      onRun: runCode,
      onPasteBlocked: () => toast("Pasting is off for code answers — type it out."),
    });
    $("runBtn").onclick = runCode;
    $("fixBtn").onclick = () => { editor.fixIndentation(); toast("Indentation cleaned up"); };
    $("resetBtn").onclick = () => ask("Reset the editor?", "Your code goes back to the starter lines.", () => editor.setValue(q.starter));
    PyEngine.ensure(band).catch(() => band("python offline"));
  }

  $("hintBtn").onclick = () => {
    if (c.hintUsed) return;
    ask("Use a hint?", `A hint costs ${CONFIG.hintPenalty * 100}% of this question's points.`, () => {
      c.hintUsed = true; $("hintBtn").disabled = true;
      $("verdict").hidden = false; $("verdict").className = "verdict";
      $("verdict").innerHTML = `<b>Hint</b>${esc(q.hint || "Re-read the question carefully.")}`;
      save();
    });
  };
  $("submitBtn").onclick = () => {
    const label = q.type === "mcq" ? "Submit this answer?" : "Submit this code for marking?";
    ask(label, "You cannot come back to this question afterwards.", () => (q.type === "mcq" ? markMcq() : markCode()));
  };
  $("nextBtn").onclick = nextQuestion;
}

function startTimer() {
  clearInterval(timer);
  if (!S.current.deadline) { $("ribTime").textContent = "no limit"; return; }
  const tick = () => {
    const left = Math.max(0, S.current.deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    $("ribTime").textContent = `${m}:${String(s).padStart(2, "0")}`;
    $("ribTime").classList.toggle("low", left < 120000);
    if (left <= 0) { clearInterval(timer); S.current.timedOut = true; finishTest(); }
  };
  tick(); timer = setInterval(tick, 1000);
}

function points() { return S.current.attempt === 1 ? CONFIG.pointsFirstAttempt : CONFIG.pointsSecondAttempt; }
function award(correct) {
  const c = S.current;
  let pts = correct ? points() : 0;
  if (correct && c.hintUsed) pts = Math.round(pts * (1 - CONFIG.hintPenalty));
  return pts;
}

function markMcq() {
  const c = S.current, q = currentQ();
  const right = c.picked === q.answer;
  const btns = $("options").querySelectorAll(".opt");
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === q.answer && (right || c.attempt === CONFIG.maxAttempts)) b.classList.add("right");
    if (i === c.picked && !right) b.classList.add("wrong");
  });
  finishQuestion(right, right ? "Correct" : "Not correct", q.why);
}

async function runCode() {
  const out = $("codeOut");
  const problems = lintPython(editor.value, CONFIG);
  if (problems.length) {
    paintProblems($("problems"), problems, editor);
    out.textContent = "Fix the indentation problems above, then run again.";
    return null;
  }
  out.textContent = "Running…";
  const q = currentQ();
  try {
    const r = await PyEngine.execute(editor.value, q.fn, q.tests, band);
    out.textContent = r.error ? "" : (r.stdout || "(no output)");
    paintProblems($("problems"), [], editor, r);
    if (r.results && r.results.length) {
      $("cases").innerHTML = r.results.map((c, i) =>
        `<div class="case ${c.pass ? "pass" : "fail"}">
          <span class="mark">${c.pass ? "PASS" : "FAIL"}</span>
          <span><b>${esc(c.call)}</b> → got ${esc(c.got)}${c.pass ? "" : ` · expected ${esc(c.expect)}`}</span>
        </div>`).join("");
    }
    return r;
  } catch (e) {
    out.textContent = e.message; return null;
  }
}

async function markCode() {
  $("submitBtn").disabled = true;
  const r = await runCode();
  $("submitBtn").disabled = false;
  if (!r) {
    toast("Nothing was marked — fix the errors first. This attempt was not used.");
    return;
  }
  const right = !!r.ok;
  let why;
  if (right) why = "Every test case passed.";
  else if (r.error) why = `${r.error.kind}: ${r.error.msg}`;
  else why = `${r.passed || 0} of ${r.total} test cases passed. Look at the FAIL rows above.`;
  finishQuestion(right, right ? "Correct" : "Not correct", why);
}

function finishQuestion(right, headline, why) {
  const c = S.current, q = currentQ();
  const last = c.attempt >= CONFIG.maxAttempts;
  const v = $("verdict");
  v.hidden = false;
  v.className = "verdict " + (right ? "right" : "wrong");
  beep(right ? "ok" : "no");

  if (right || last) {
    const pts = award(right);
    c.answers.push({
      qid: q.qid, type: q.type, title: q.q.replace(/<[^>]+>/g, " ").slice(0, 80),
      correct: right, attempts: c.attempt, awarded: pts, hintUsed: c.hintUsed,
    });
    v.innerHTML = `<b>${headline} · ${pts} point${pts === 1 ? "" : "s"}</b>${esc(why)}`;
    $("submitBtn").hidden = true;
    $("nextBtn").hidden = false;
    $("nextBtn").textContent = c.index + 1 >= questions(testById(c.testId)).length ? "See my result" : "Next question";
    $("hintBtn").disabled = true;
    c.attempt = 1; c.hintUsed = false;
  } else {
    c.attempt++;
    v.innerHTML = `<b>${headline} — one more try</b>${esc("Your second attempt is worth " + CONFIG.pointsSecondAttempt + " points.")}`;
    $("attempts").textContent = `Attempt ${c.attempt} of ${CONFIG.maxAttempts} · worth ${CONFIG.pointsSecondAttempt} points`;
    if (q.type === "mcq") {
      $("options").querySelectorAll(".opt").forEach((b) => {
        if (!b.classList.contains("wrong")) { b.disabled = false; b.classList.remove("sel"); }
      });
      c.picked = null; $("submitBtn").disabled = true;
    }
  }
  $("ribScore").textContent = c.answers.reduce((a, x) => a + x.awarded, 0);
  save();
}

function nextQuestion() {
  const c = S.current, qs = questions(testById(c.testId));
  if (c.index + 1 >= qs.length) return finishTest();
  c.index++; c.attempt = 1; c.hintUsed = false; save();
  renderQuestion();
}

function finishTest() {
  clearInterval(timer);
  const c = S.current, t = testById(c.testId), qs = questions(t);
  while (c.answers.length < qs.length) {
    const q = qs[c.answers.length];
    c.answers.push({ qid: q.qid, type: q.type, title: q.q.replace(/<[^>]+>/g, " ").slice(0, 80), correct: false, attempts: 0, awarded: 0, hintUsed: false, skipped: true });
  }
  S.tests[t.id] = {
    testId: t.id, title: t.title, score: c.answers.reduce((a, x) => a + x.awarded, 0),
    max: maxScore(t), answers: c.answers, startedAt: c.startedAt, finishedAt: Date.now(),
    tabSwitches: c.tabSwitches || 0, timedOut: !!c.timedOut,
  };
  S.current = null; save();
  showResult(t.id);
}

/* ---------- result ------------------------------------------ */
function showResult(id) {
  show("scResult");
  const r = S.tests[id], pct = Math.round((r.score / r.max) * 100), pass = pct >= CONFIG.passPercent;
  $("resultHead").innerHTML = `
    <p class="eyebrow">${esc(r.title)}</p>
    <div class="big ${pass ? "pass" : "fail"}">${pct}%</div>
    <p>${r.score} of ${r.max} points · ${pass ? "passed" : "below the " + CONFIG.passPercent + "% pass mark"}</p>
    ${r.timedOut ? '<p class="fine">Time ran out before the last questions.</p>' : ""}`;
  $("ledger").innerHTML = r.answers.map((a, i) =>
    `<div class="lrow ${a.correct ? "ok" : "no"}">
      <span class="n">${i + 1}</span>
      <span class="grow">${esc(a.title)}</span>
      ${a.hintUsed ? '<span class="pill">hint</span>' : ""}
      <span class="pts">${a.awarded}/${CONFIG.pointsFirstAttempt}</span>
    </div>`).join("");

  const code = resultCode(r);
  $("resultCode").value = code;
  $("copyCode").onclick = () => { navigator.clipboard.writeText(code); toast("Result code copied"); };
  $("waSend").onclick = () => {
    const msg = `2C1P result — ${studentName(S.student)} — ${r.title} — ${r.score}/${r.max} (${pct}%)\n\nCode:\n${code}`;
    window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank");
  };
  $("dlReport").onclick = () => download(`${studentName(S.student)} - ${r.title}.txt`, reportText(r, pct));

  const all = BANK.every((t) => S.tests[t.id]);
  const overall = all ? Math.round((BANK.reduce((a, t) => a + S.tests[t.id].score, 0) / BANK.reduce((a, t) => a + maxScore(t), 0)) * 100) : 0;
  $("certBox").hidden = !(all && overall >= CONFIG.passPercent);
  if (!$("certBox").hidden) { drawCert(overall); $("dlCert").onclick = () => downloadCanvas(); }
  if (pass && CONFIG.confetti) confetti();
}

function resultCode(r) {
  const payload = { n: studentName(S.student), p: S.student.email, t: r.testId, s: r.score, m: r.max, f: r.finishedAt, x: r.tabSwitches, o: r.timedOut ? 1 : 0 };
  const json = JSON.stringify(payload);
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (h * 31 + json.charCodeAt(i)) >>> 0;
  return btoa(unescape(encodeURIComponent(json))) + "." + h.toString(36);
}
function readCode(code) {
  const [b, sig] = String(code).trim().split(".");
  const json = decodeURIComponent(escape(atob(b)));
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (h * 31 + json.charCodeAt(i)) >>> 0;
  if (h.toString(36) !== sig) throw new Error("This code has been altered.");
  return JSON.parse(json);
}
function reportText(r, pct) {
  return [
    CONFIG.courseName, "Test report", "",
    `Student : ${studentName(S.student)} (${S.student.email})`,
    `Test    : ${r.title}`,
    `Score   : ${r.score}/${r.max} (${pct}%)`,
    `Finished: ${new Date(r.finishedAt).toLocaleString()}`, "",
    ...r.answers.map((a, i) => `${String(i + 1).padStart(2)}. ${a.correct ? "correct  " : "incorrect"} ${a.awarded}/${CONFIG.pointsFirstAttempt}${a.hintUsed ? " (hint)" : ""}  ${a.title}`),
    "", `Verification code: ${resultCode(r)}`,
  ].join("\n");
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name; a.click();
}
function downloadCanvas() {
  const a = document.createElement("a");
  a.href = $("cert").toDataURL("image/png");
  a.download = `${studentName(S.student)} - certificate.png`; a.click();
}

function drawCert(pct) {
  const c = $("cert"), x = c.getContext("2d");
  x.fillStyle = "#f6f3ec"; x.fillRect(0, 0, 1200, 850);
  x.strokeStyle = "#111c33"; x.lineWidth = 6; x.strokeRect(28, 28, 1144, 794);
  x.fillStyle = "#e8a317"; x.fillRect(28, 28, 1144, 14);
  x.fillStyle = "#111c33"; x.textAlign = "center";
  x.font = "400 26px Archivo, sans-serif"; x.fillText("2C1P", 600, 130);
  x.font = "400 58px Anton, Impact, sans-serif"; x.fillText("CERTIFICATE OF COMPLETION", 600, 210);
  x.font = "400 20px Archivo, sans-serif"; x.fillText("This certifies that", 600, 290);
  x.font = "400 62px Anton, Impact, sans-serif"; x.fillText(studentName(S.student), 600, 372);
  x.font = "400 20px Archivo, sans-serif";
  x.fillText("has completed all six assessments of", 600, 430);
  x.font = "600 30px Archivo, sans-serif"; x.fillText(CONFIG.courseName, 600, 478);
  x.font = "400 20px Archivo, sans-serif"; x.fillText(CONFIG.courseLength, 600, 514);
  x.font = "400 46px Anton, Impact, sans-serif"; x.fillStyle = "#2f6f4f";
  x.fillText(`with an overall score of ${pct}%`, 600, 590);
  x.fillStyle = "#111c33"; x.font = "400 18px Archivo, sans-serif";
  x.fillText(CONFIG.instructor, 600, 700);
  x.font = "400 15px IBM Plex Mono, monospace"; x.fillStyle = "#5d6880";
  x.fillText("Instructor", 600, 726);
  const serial = "2C1P-" + btoa(S.student.email).replace(/=/g, "").slice(0, 8).toUpperCase();
  x.fillText(`${serial} · ${new Date().toLocaleDateString()}`, 600, 782);
}

function confetti() {
  const c = $("confetti"); c.hidden = false;
  c.width = innerWidth; c.height = innerHeight;
  const x = c.getContext("2d");
  const bits = Array.from({ length: 90 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * 200,
    v: 2 + Math.random() * 4, s: 4 + Math.random() * 6,
    col: ["#e8a317", "#111c33", "#2f6f4f"][(Math.random() * 3) | 0], r: Math.random() * 6,
  }));
  let f = 0;
  (function tick() {
    x.clearRect(0, 0, c.width, c.height);
    bits.forEach((b) => { b.y += b.v; b.r += .1; x.save(); x.translate(b.x, b.y); x.rotate(b.r); x.fillStyle = b.col; x.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * .6); x.restore(); });
    if (++f < 170) requestAnimationFrame(tick); else c.hidden = true;
  })();
}

/* ---------- admin -------------------------------------------- */
function openAdmin() { show("scAdmin"); $("adminGate").hidden = false; $("adminPanel").hidden = true; $("adminPass").focus(); }
async function adminCheck() {
  let h;
  try { h = await sha256($("adminPass").value); }
  catch {
    $("adminErr").hidden = false;
    $("adminErr").textContent = "The instructor area needs the site to be served over https. Open the GitHub Pages address rather than the file on disk.";
    return;
  }
  if (h !== CONFIG.adminPassHash) { $("adminErr").hidden = false; $("adminErr").textContent = "Wrong password."; return; }
  $("adminErr").hidden = true; $("adminGate").hidden = true; $("adminPanel").hidden = false;
  $("adminTabs").querySelectorAll(".tab").forEach((b) => {
    b.onclick = () => {
      $("adminTabs").querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
      b.classList.add("on"); adminTab(b.dataset.tab);
    };
  });
  adminTab("overview");
}

function results() { try { return JSON.parse(localStorage.getItem(KEY + "_results") || "[]"); } catch { return []; } }
function saveResults(r) { localStorage.setItem(KEY + "_results", JSON.stringify(r)); }

function adminTab(name) {
  const b = $("adminBody");
  if (name === "overview") return adminOverview(b);
  if (name === "results") return adminResults(b);
  if (name === "students") return adminStudents(b);
  if (name === "attendance") return adminAttendance(b);
  if (name === "questions") return adminQuestions(b);
  if (name === "settings") return adminSettings(b);
}

function adminOverview(b) {
  const rs = results();
  const byTest = BANK.map((t) => {
    const rows = rs.filter((r) => r.t === t.id);
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + (r.s / r.m) * 100, 0) / rows.length) : 0;
    const passed = rows.filter((r) => (r.s / r.m) * 100 >= CONFIG.passPercent).length;
    return { t, n: rows.length, avg, passed };
  });
  const done = rs.length;
  const passRate = done ? Math.round((rs.filter((r) => (r.s / r.m) * 100 >= CONFIG.passPercent).length / done) * 100) : 0;
  b.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${ROSTER.length}</b><span>students on the list</span></div>
      <div class="stat"><b>${new Set(rs.map((r) => r.p)).size}</b><span>students with results</span></div>
      <div class="stat"><b>${done}</b><span>results received</span></div>
      <div class="stat"><b>${passRate}%</b><span>pass rate</span></div>
    </div>
    <table><thead><tr><th>Test</th><th class="num">Sat</th><th class="num">Average</th><th class="num">Passed</th><th>Spread</th></tr></thead><tbody>
    ${byTest.map((r) => `<tr><td>${esc(r.t.title)}</td><td class="num">${r.n}</td><td class="num">${r.avg}%</td>
      <td class="num">${r.passed}</td><td><div class="bar"><i style="width:${r.avg}%"></i></div></td></tr>`).join("")}
    </tbody></table>
    <p class="fine">Results arrive as codes the students send you. Paste them in the Results tab.</p>`;
}

function adminResults(b) {
  const rs = results();
  b.innerHTML = `
    <div class="adminform">
      <label for="pasteCodes">Paste result codes — one per line</label>
      <textarea id="pasteCodes" rows="4" placeholder="eyJuIjoi…"></textarea>
      <div class="row"><button class="primary sm" id="importBtn">Add results</button>
        <button class="ghost sm" id="csvBtn">Download CSV</button>
        <button class="ghost sm" id="clearRes">Clear all results</button></div>
      <p class="err" id="importErr" hidden></p>
    </div>
    <table><thead><tr><th>Student</th><th>Test</th><th class="num">Score</th><th class="num">%</th><th>When</th><th>Flags</th></tr></thead><tbody>
    ${rs.length ? rs.slice().sort((a, x) => x.f - a.f).map((r) => {
      const pct = Math.round((r.s / r.m) * 100);
      const flags = [r.o ? "timed out" : "", r.x > 2 ? `left tab ${r.x}×` : ""].filter(Boolean)
        .map((f) => `<span class="flagtag">${f}</span>`).join("");
      return `<tr><td>${esc(r.n)}<br><span class="fine">${esc(r.p)}</span></td>
        <td>${esc((testById(r.t) || {}).title || r.t)}</td>
        <td class="num">${r.s}/${r.m}</td><td class="num">${pct}%</td>
        <td>${new Date(r.f).toLocaleDateString()}</td><td>${flags || "—"}</td></tr>`;
    }).join("") : `<tr><td colspan="6" class="fine">No results yet. Paste the codes students send you.</td></tr>`}
    </tbody></table>`;
  $("importBtn").onclick = () => {
    const lines = $("pasteCodes").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const rsNow = results(); let added = 0, bad = 0;
    lines.forEach((line) => {
      try {
        const r = readCode(line);
        if (!rsNow.some((x) => x.p === r.p && x.t === r.t && x.f === r.f)) { rsNow.push(r); added++; }
      } catch { bad++; }
    });
    saveResults(rsNow);
    toast(`${added} result${added === 1 ? "" : "s"} added`);
    adminResults(b);
    if (bad) {
      $("importErr").hidden = false;
      $("importErr").textContent = `${bad} code${bad === 1 ? "" : "s"} could not be read — they may have been edited by hand.`;
    }
  };
  $("csvBtn").onclick = () => {
    const rows = [["Name", "Email", "Test", "Score", "Max", "Percent", "Finished", "TabSwitches", "TimedOut"]]
      .concat(results().map((r) => [r.n, r.p, (testById(r.t) || {}).title || r.t, r.s, r.m,
        Math.round((r.s / r.m) * 100), new Date(r.f).toISOString(), r.x || 0, r.o ? "yes" : "no"]));
    download("results.csv", rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"));
  };
  $("clearRes").onclick = () => ask("Clear every result?", "This cannot be undone. Download the CSV first if you need it.", () => { saveResults([]); adminResults(b); });
}

function adminStudents(b) {
  const rs = results();
  b.innerHTML = `
    <table><thead><tr><th>#</th><th>Student</th><th>Email</th><th class="num">Tests done</th><th class="num">Average</th></tr></thead><tbody>
    ${ROSTER.map((s, i) => {
      const email = normalizeEmail(s.email);
      const mine = rs.filter((r) => normalizeEmail(r.p) === email);
      const avg = mine.length ? Math.round(mine.reduce((a, r) => a + (r.s / r.m) * 100, 0) / mine.length) : 0;
      return `<tr><td class="num">${i + 1}</td><td>${esc(studentName(s))}</td><td>${esc(email)}</td>
        <td class="num">${mine.length}/${BANK.length}</td><td class="num">${mine.length ? avg + "%" : "—"}</td></tr>`;
    }).join("")}
    </tbody></table>
    <div class="adminform" style="margin-top:18px">
      <label for="rosterPaste">Replace the class list — one email per line</label>
      <textarea id="rosterPaste" rows="5" placeholder="student@example.com"></textarea>
      <button class="primary sm" id="rosterBtn">Build the new list</button>
      <p class="fine">Invalid or duplicate emails are skipped. This gives you the lines to paste into data.js — the file itself is not written by the browser.</p>
      <textarea id="rosterOut" rows="6" class="codebox" hidden></textarea>
    </div>`;
  $("rosterBtn").onclick = () => {
    const emails = [...new Set($("rosterPaste").value.split("\\n").map(normalizeEmail).filter(isValidEmail))];
    const out = "const ROSTER = [\\n" + emails.map((email) =>
      `  { email: ${JSON.stringify(email)} },`).join("\\n") + "\\n];";
    const t = $("rosterOut"); t.hidden = false; t.value = out; t.select();
    toast(`${emails.length} valid email${emails.length === 1 ? "" : "s"} prepared`);
  };
}

function adminAttendance(b) {
  const dates = sessionDates();
  const att = S.attendance || (S.attendance = {});
  b.innerHTML = `
    <div class="row"><button class="ghost sm" id="attCsv">Download CSV</button>
      <span class="fine">${dates.length} sessions from ${dates[0]} — tick a box to mark present.</span></div>
    <div class="att"><table><thead><tr><th>Student</th>
      ${dates.map((d, i) => `<th title="${d}">${i + 1}</th>`).join("")}<th class="num">%</th></tr></thead><tbody>
    ${ROSTER.map((s) => {
      const key = normalizeEmail(s.email);
      const row = att[key] || (att[key] = {});
      const n = Object.values(row).filter(Boolean).length;
      return `<tr><td>${esc(studentName(s))}</td>${dates.map((d, i) =>
        `<td><input type="checkbox" data-s="${key}" data-d="${i}" ${row[i] ? "checked" : ""}></td>`).join("")}
        <td class="num">${Math.round((n / dates.length) * 100)}%</td></tr>`;
    }).join("")}
    </tbody></table></div>`;
  b.querySelectorAll("input[type=checkbox]").forEach((c) => {
    c.onchange = () => { S.attendance[c.dataset.s][c.dataset.d] = c.checked; save(); };
  });
  $("attCsv").onclick = () => {
    const rows = [["Name", "Email", ...dates, "Present", "Percent"]].concat(ROSTER.map((s) => {
      const row = S.attendance[normalizeEmail(s.email)] || {};
      const marks = dates.map((_, i) => (row[i] ? "P" : "A"));
      const n = marks.filter((m) => m === "P").length;
      return [studentName(s), s.email, ...marks, n, Math.round((n / dates.length) * 100) + "%"];
    }));
    download("attendance.csv", rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n"));
  };
}
function sessionDates() {
  const out = [], d = new Date(SCHEDULE.startDate + "T00:00:00");
  let guard = 0;
  while (out.length < SCHEDULE.sessions && guard++ < 2000) {
    if (SCHEDULE.days.includes(d.getDay())) out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function adminQuestions(b) {
  b.innerHTML = `
    <p class="fine">Edit a question, then press <b>Build data.js</b> and replace the file on GitHub.</p>
    <div class="adminform">
      <label for="qPick">Question</label>
      <select id="qPick">${BANK.map((t) =>
        `<optgroup label="${esc(t.title)}">
          ${t.mcq.map((q, i) => `<option value="${t.id}:m:${i}">MCQ ${i + 1} — ${esc(q.q.replace(/<[^>]+>/g, " ").slice(0, 50))}</option>`).join("")}
          ${t.code.map((q, i) => `<option value="${t.id}:c:${i}">CODE ${i + 1} — ${esc(q.q)}</option>`).join("")}
        </optgroup>`).join("")}</select>
      <div id="qEdit"></div>
      <div class="row"><button class="primary sm" id="qSave">Apply change</button>
        <button class="ghost sm" id="buildData">Build data.js</button></div>
    </div>`;
  const pick = $("qPick");
  const draw = () => {
    const [tid, kind, idx] = pick.value.split(":");
    const t = testById(tid), q = kind === "m" ? t.mcq[+idx] : t.code[+idx];
    $("qEdit").innerHTML = kind === "m" ? `
      <label>Question (HTML allowed)</label><textarea id="fQ" rows="3">${esc(q.q)}</textarea>
      ${q.options.map((o, i) => `<label>Option ${"ABCD"[i]}</label><input id="fO${i}" value="${esc(o)}">`).join("")}
      <label>Correct option</label><select id="fA">${q.options.map((_, i) => `<option value="${i}" ${i === q.answer ? "selected" : ""}>${"ABCD"[i]}</option>`).join("")}</select>
      <label>Explanation</label><textarea id="fW" rows="2">${esc(q.why)}</textarea>
      <label>Hint</label><input id="fH" value="${esc(q.hint || "")}">`
      : `<label>Title</label><input id="fQ" value="${esc(q.q)}">
      <label>Brief (HTML allowed)</label><textarea id="fB" rows="3">${esc(q.brief)}</textarea>
      <label>Function name</label><input id="fF" value="${esc(q.fn)}">
      <label>Starter code</label><textarea id="fS" rows="3">${esc(q.starter)}</textarea>
      <label>Tests — one per line, as <code>call || expected repr</code></label>
      <textarea id="fT" rows="4">${q.tests.map((x) => `${x.call} || ${x.expect}`).join("\n")}</textarea>
      <label>Hint</label><input id="fH" value="${esc(q.hint || "")}">`;
  };
  pick.onchange = draw; draw();
  $("qSave").onclick = () => {
    const [tid, kind, idx] = pick.value.split(":");
    const t = testById(tid);
    if (kind === "m") {
      const q = t.mcq[+idx];
      q.q = $("fQ").value; q.options = [0, 1, 2, 3].map((i) => $("fO" + i).value);
      q.answer = +$("fA").value; q.why = $("fW").value; q.hint = $("fH").value;
    } else {
      const q = t.code[+idx];
      q.q = $("fQ").value; q.brief = $("fB").value; q.fn = $("fF").value;
      q.starter = $("fS").value; q.hint = $("fH").value;
      q.tests = $("fT").value.split("\n").filter(Boolean).map((l) => {
        const [call, expect] = l.split("||");
        return { call: (call || "").trim(), expect: (expect || "").trim() };
      });
    }
    toast("Changed here — now press Build data.js");
  };
  $("buildData").onclick = () => download("data.js", buildDataFile());
}

function buildDataFile() {
  const j = (v) => JSON.stringify(v, null, 2);
  return `/* data.js — rebuilt by the instructor panel on ${new Date().toLocaleString()} */\n\n` +
    `const CONFIG = ${j(CONFIG)};\n\nconst ROSTER = ${j(ROSTER)};\n\nconst SCHEDULE = ${j(SCHEDULE)};\n\nconst BANK = ${j(BANK)};\n`;
}

function adminSettings(b) {
  b.innerHTML = `
    <div class="adminform">
      <label>Instructor name</label><input id="sName" value="${esc(CONFIG.instructor)}">
      <label>Phone / WhatsApp</label><input id="sPhone" value="${esc(CONFIG.instructorPhone)}">
      <label>Pass mark (%)</label><input id="sPass" type="number" value="${CONFIG.passPercent}">
      <label>Time limit per test (minutes, 0 for none)</label><input id="sTime" type="number" value="${CONFIG.timeLimitMin}">
      <label>Opening hour (24h, Pakistan time)</label><input id="sOpen" type="number" value="${CONFIG.windowOpenHour}">
      <label><input type="checkbox" id="sWindow" ${CONFIG.enforceWindow ? "checked" : ""}> Enforce the time window</label>
      <label><input type="checkbox" id="sHints" ${CONFIG.allowHints ? "checked" : ""}> Allow hints</label>
      <label><input type="checkbox" id="sPaste" ${CONFIG.blockPaste ? "checked" : ""}> Block pasting into the code editor</label>
      <label><input type="checkbox" id="sStrict" ${CONFIG.strictIndent ? "checked" : ""}> Require indents to be exact multiples of ${CONFIG.indentSize}</label>
      <label>New admin password (leave blank to keep)</label><input id="sPass2" type="text" placeholder="new password">
      <div class="row"><button class="primary sm" id="setSave">Apply</button>
        <button class="ghost sm" id="setBuild">Build data.js</button></div>
      <p class="fine" id="hashOut"></p>
    </div>`;
  $("setSave").onclick = async () => {
    CONFIG.instructor = $("sName").value; CONFIG.instructorPhone = $("sPhone").value;
    CONFIG.whatsapp = digits($("sPhone").value).replace(/^0/, "92");
    CONFIG.passPercent = +$("sPass").value; CONFIG.timeLimitMin = +$("sTime").value;
    CONFIG.windowOpenHour = +$("sOpen").value;
    CONFIG.enforceWindow = $("sWindow").checked; CONFIG.allowHints = $("sHints").checked;
    CONFIG.blockPaste = $("sPaste").checked; CONFIG.strictIndent = $("sStrict").checked;
    if ($("sPass2").value.trim()) {
      CONFIG.adminPassHash = await sha256($("sPass2").value.trim());
      $("hashOut").textContent = "New password set in this browser. Press Build data.js and upload it, or it will reset on refresh.";
    }
    toast("Applied — press Build data.js to keep it");
  };
  $("setBuild").onclick = () => download("data.js", buildDataFile());
}

document.addEventListener("DOMContentLoaded", boot);
