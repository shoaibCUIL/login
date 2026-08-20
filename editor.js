/* ============================================================
   editor.js — the code editor and the Python engine.
   Three parts:
     1. scanPython()  — splits code into logical lines
     2. lintPython()  — indentation and syntax checks, instantly
     3. PyEditor      — the editor widget (indent, highlight, gutter)
     4. PyEngine      — real CPython via Pyodide: compile, run, grade
   ============================================================ */

const KEYWORDS = ["False","None","True","and","as","assert","async","await","break","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","nonlocal","not","or","pass","raise","return","try","while","with","yield"];
const BUILTINS = ["abs","all","any","bool","dict","dir","divmod","enumerate","filter","float","frozenset","input","int","isinstance","len","list","map","max","min","open","print","range","repr","reversed","round","set","sorted","str","sum","tuple","type","zip"];
const BLOCK_HEADS = ["if","elif","else","for","while","def","class","try","except","finally","with","async"];
const DEDENT_AFTER = ["return","pass","break","continue","raise"];

/* ---------- 1. scanner ------------------------------------- */
/* Walks the source once, tracking strings, brackets and line
   continuations, so the linter never trips over a multi-line
   string or a call split across lines.                        */
function scanPython(src) {
  const raw = src.split("\n");
  const lines = [];
  let depth = 0, str = null, contFromBackslash = false, strStartLine = 0, openStack = [];

  for (let i = 0; i < raw.length; i++) {
    const text = raw[i];
    const info = {
      n: i + 1, text,
      continued: str !== null || depth > 0 || contFromBackslash,
      blank: text.trim() === "",
      indent: text.length - text.replace(/^[ \t]*/, "").length,
      spaces: (text.match(/^ */) || [""])[0].length,
      hasTabIndent: /^[ ]*\t/.test(text) || /^\t/.test(text),
      comment: false, endsColon: false, inlineSuite: false, head: null,
    };
    const startedContinued = info.continued;
    let j = 0, code = "";
    contFromBackslash = false;

    while (j < text.length) {
      const c = text[j], three = text.substr(j, 3);
      if (str) {
        if (str.triple && three === str.q.repeat(3)) { str = null; j += 3; continue; }
        if (!str.triple && c === str.q) { str = null; j++; continue; }
        if (c === "\\") { j += 2; continue; }
        j++; continue;
      }
      if (c === "#") { if (code.trim() === "") info.comment = true; break; }
      if (c === '"' || c === "'") {
        if (three === c.repeat(3)) { str = { q: c, triple: true }; strStartLine = i + 1; j += 3; continue; }
        str = { q: c, triple: false }; strStartLine = i + 1; j++; continue;
      }
      if ("([{".includes(c)) { depth++; openStack.push({ c, n: i + 1 }); code += c; j++; continue; }
      if (")]}".includes(c)) { depth = Math.max(0, depth - 1); openStack.pop(); code += c; j++; continue; }
      if (c === "\\" && j === text.length - 1) { contFromBackslash = true; j++; continue; }
      code += c; j++;
    }
    if (str && !str.triple) { str = null; info.unterminated = true; }

    const trimmed = code.trim();
    info.code = trimmed;
    if (!startedContinued && trimmed) {
      const first = (trimmed.match(/^[A-Za-z_]+/) || [""])[0];
      if (BLOCK_HEADS.includes(first)) info.head = first;
      if (depth === 0 && !contFromBackslash) {
        if (trimmed.endsWith(":")) info.endsColon = true;
        else if (info.head && /:/.test(trimmed)) info.inlineSuite = true;
      }
    }
    info.lastWord = (trimmed.match(/^[A-Za-z_]+/) || [""])[0];
    lines.push(info);
  }
  return { lines, openStack, unclosedString: str ? strStartLine : 0 };
}

/* ---------- 2. linter -------------------------------------- */
function lintPython(src, opt) {
  opt = Object.assign({ indentSize: 4, strictIndent: true, banTabs: true }, opt || {});
  const { lines, openStack, unclosedString } = scanPython(src);
  const problems = [];
  const add = (n, msg, kind, fix) => problems.push({ line: n, msg, kind: kind || "IndentationError", fix });

  const stack = [0];
  let expectAfter = null;   // { n, head }

  for (const L of lines) {
    if (opt.banTabs && L.hasTabIndent)
      add(L.n, "TabError: this editor uses spaces, not tabs. Press \u201cFix indentation\u201d to convert them.", "TabError", "tabs");
    if (L.blank || L.continued) continue;

    if (L.comment) {                       // comments do not open or close blocks
      continue;
    }

    const ind = L.spaces;
    if (opt.strictIndent && ind % opt.indentSize !== 0)
      add(L.n, `IndentationError: indent is ${ind} space${ind === 1 ? "" : "s"}, which is not a multiple of ${opt.indentSize}.`, "IndentationError", "reindent");

    if (expectAfter) {
      if (ind <= stack[stack.length - 1]) {
        add(L.n, `IndentationError: expected an indented block after '${expectAfter.head}' statement on line ${expectAfter.n}.`);
      } else {
        stack.push(ind);
      }
      expectAfter = null;
    } else if (ind > stack[stack.length - 1]) {
      add(L.n, "IndentationError: unexpected indent. Nothing on the line above opens a block, so this line should start at column " + (stack[stack.length - 1] + 1) + ".");
    } else {
      while (stack.length > 1 && ind < stack[stack.length - 1]) stack.pop();
      if (ind !== stack[stack.length - 1])
        add(L.n, "IndentationError: unindent does not match any outer indentation level.");
    }

    if (L.head && !L.endsColon && !L.inlineSuite && !L.code.endsWith("\\"))
      add(L.n, `SyntaxError: expected ':' at the end of this '${L.head}' line.`, "SyntaxError");

    if (L.endsColon) expectAfter = { n: L.n, head: L.head || "compound" };
    if (L.unterminated)
      add(L.n, "SyntaxError: unterminated string — a quote was opened and never closed.", "SyntaxError");
  }

  if (expectAfter)
    add(expectAfter.n, `IndentationError: '${expectAfter.head}' on line ${expectAfter.n} ends with a colon but no indented block follows.`);
  if (openStack.length) {
    const last = openStack[openStack.length - 1];
    add(last.n, `SyntaxError: '${last.c}' opened on line ${last.n} was never closed.`, "SyntaxError");
  }
  if (unclosedString)
    add(unclosedString, "SyntaxError: a triple-quoted string opened on line " + unclosedString + " was never closed.", "SyntaxError");

  problems.sort((a, b) => a.line - b.line);
  return problems;
}

/* Turn a raw CPython message into something a beginner can act on. */
const ERROR_HELP = [
  [/expected an indented block/i, "A line ending in a colon must be followed by an indented block. Add four spaces to the line below it."],
  [/unexpected indent/i, "This line is indented further than the line above allows. Remove the extra spaces."],
  [/unindent does not match/i, "This line was pulled back to a column no earlier block uses. Line it up with one of the blocks above."],
  [/inconsistent use of tabs/i, "Tabs and spaces are mixed. Use four spaces everywhere — press \u201cFix indentation\u201d."],
  [/expected ':'/i, "A compound statement such as if, for, while or def needs a colon at the end of its first line."],
  [/invalid syntax/i, "Python could not read this line. Check for a missing colon, comma, bracket or quote."],
  [/was never closed/i, "A bracket was opened and never closed. Count your ( ) [ ] { } pairs."],
  [/EOL while scanning|unterminated string/i, "A quote was opened and never closed on the same line."],
  [/name '(.+)' is not defined/i, "That name has not been created yet. Check the spelling, or define it before you use it."],
  [/unsupported operand type/i, "You are combining two types that will not mix, such as a string and a number. Convert one with int() or str()."],
  [/list indices must be integers/i, "A list index must be a whole number, not a string. Use a dictionary if you want to look things up by name."],
  [/object is not callable/i, "You put brackets after something that is not a function. Check whether you meant to index with [] instead."],
  [/takes .* positional argument/i, "The number of arguments you passed does not match the function definition."],
  [/division by zero/i, "Something divided by zero. Guard the divisor before dividing."],
];
function explainError(msg) {
  for (const [re, help] of ERROR_HELP) if (re.test(msg || "")) return help;
  return null;
}

/* ---------- 3. the editor widget --------------------------- */
class PyEditor {
  constructor(host, opts) {
    this.opt = Object.assign({ indentSize: 4, strictIndent: true, banTabs: true, liveLint: true, blockPaste: false, readOnly: false }, opts || {});
    this.onChange = this.opt.onChange || (() => {});
    this.onRun = this.opt.onRun || (() => {});
    this.problems = [];
    host.innerHTML = `
      <div class="ed">
        <div class="ed-gutter" aria-hidden="true"></div>
        <div class="ed-scroll">
          <pre class="ed-hl" aria-hidden="true"></pre>
          <textarea class="ed-area" spellcheck="false" autocapitalize="off" autocomplete="off"
            wrap="off" aria-label="Python code editor"></textarea>
        </div>
      </div>`;
    this.root = host.querySelector(".ed");
    this.gutter = host.querySelector(".ed-gutter");
    this.hl = host.querySelector(".ed-hl");
    this.ta = host.querySelector(".ed-area");
    this.scroll = host.querySelector(".ed-scroll");
    if (this.opt.readOnly) this.ta.readOnly = true;

    this.ta.addEventListener("input", () => this.refresh());
    this.ta.addEventListener("scroll", () => this.syncScroll());
    this.ta.addEventListener("keydown", (e) => this.keydown(e));
    this.ta.addEventListener("paste", (e) => {
      if (this.opt.blockPaste) { e.preventDefault(); this.opt.onPasteBlocked && this.opt.onPasteBlocked(); }
    });
    if (this.opt.value) this.setValue(this.opt.value);
    this.refresh();
  }

  get value() { return this.ta.value; }
  setValue(v) { this.ta.value = v; this.refresh(); }
  focus() { this.ta.focus(); }

  indentUnit() { return " ".repeat(this.opt.indentSize); }

  keydown(e) {
    const ta = this.ta, unit = this.indentUnit();
    const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value;

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); this.onRun(); return; }

    if (e.key === "Tab") {
      e.preventDefault();
      if (start !== end || e.shiftKey) return this.shiftBlock(e.shiftKey);
      const col = start - val.lastIndexOf("\n", start - 1) - 1;
      const pad = this.opt.indentSize - (col % this.opt.indentSize);
      this.insert(" ".repeat(pad || this.opt.indentSize));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      const before = val.slice(lineStart, start);
      let indent = (before.match(/^[ ]*/) || [""])[0];
      const codePart = before.replace(/#.*$/, "").trim();
      if (codePart.endsWith(":")) indent += unit;
      else if (DEDENT_AFTER.includes((codePart.match(/^[A-Za-z_]+/) || [""])[0]) && indent.length >= this.opt.indentSize)
        indent = indent.slice(this.opt.indentSize);
      this.insert("\n" + indent);
      return;
    }

    if (e.key === "Backspace" && start === end) {
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      const before = val.slice(lineStart, start);
      if (before.length && /^[ ]+$/.test(before) && before.length % this.opt.indentSize === 0) {
        e.preventDefault();
        ta.setSelectionRange(start - this.opt.indentSize, start);
        this.insert("");
        return;
      }
    }

    const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
    if (pairs[e.key] && start === end) {
      const next = val[start] || "";
      if (!/[\w"']/.test(next)) { e.preventDefault(); this.insert(e.key + pairs[e.key], 1); return; }
    }
    if ([")", "]", "}"].includes(e.key) && val[start] === e.key) {
      e.preventDefault(); ta.setSelectionRange(start + 1, start + 1); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); this.toggleComment(); }
  }

  insert(text, backBy) {
    const ta = this.ta, s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(text, s, e, "end");
    if (backBy) ta.setSelectionRange(ta.selectionStart - backBy, ta.selectionStart - backBy);
    this.refresh();
  }

  lineRange() {
    const val = this.ta.value;
    const s = val.lastIndexOf("\n", this.ta.selectionStart - 1) + 1;
    let e = val.indexOf("\n", this.ta.selectionEnd);
    if (e === -1) e = val.length;
    return [s, e];
  }

  shiftBlock(out) {
    const [s, e] = this.lineRange();
    const unit = this.indentUnit();
    const block = this.ta.value.slice(s, e).split("\n").map((l) =>
      out ? l.replace(new RegExp("^ {1," + this.opt.indentSize + "}"), "") : (l.trim() ? unit + l : l)
    ).join("\n");
    this.ta.setRangeText(block, s, e, "select");
    this.refresh();
  }

  toggleComment() {
    const [s, e] = this.lineRange();
    const rows = this.ta.value.slice(s, e).split("\n");
    const allCommented = rows.every((r) => !r.trim() || /^\s*#/.test(r));
    const out = rows.map((r) => {
      if (!r.trim()) return r;
      if (allCommented) return r.replace(/^(\s*)#\s?/, "$1");
      const pad = (r.match(/^\s*/) || [""])[0];
      return pad + "# " + r.slice(pad.length);
    }).join("\n");
    this.ta.setRangeText(out, s, e, "select");
    this.refresh();
  }

  fixIndentation() {
    const unit = this.indentUnit();
    const out = this.ta.value.split("\n").map((line) => {
      const m = line.match(/^[ \t]*/)[0];
      let width = 0;
      for (const c of m) width = c === "\t" ? width + this.opt.indentSize : width + 1;
      const levels = Math.round(width / this.opt.indentSize);
      return unit.repeat(levels) + line.slice(m.length).replace(/\t/g, " ");
    }).join("\n");
    this.ta.value = out;
    this.refresh();
  }

  highlight(code) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const re = new RegExp(
      "(#[^\\n]*)" +
      "|('''[\\s\\S]*?'''|\"\"\"[\\s\\S]*?\"\"\"|'(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\")" +
      "|\\b(" + KEYWORDS.join("|") + ")\\b" +
      "|\\b(" + BUILTINS.join("|") + ")(?=\\s*\\()" +
      "|\\b(\\d+\\.?\\d*)\\b", "g");
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const cls = m[1] ? "c-com" : m[2] ? "c-str" : m[3] ? "c-kw" : m[4] ? "c-bi" : "c-num";
      out += `<span class="${cls}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    out += esc(code.slice(last));
    // indentation guides on leading whitespace
    return out.split("\n").map((line) => {
      const lead = (line.match(/^ +/) || [""])[0];
      if (!lead) return line || " ";
      const groups = Math.floor(lead.length / this.opt.indentSize);
      const rest = lead.slice(groups * this.opt.indentSize);
      return `<span class="ind">${" ".repeat(this.opt.indentSize)}</span>`.repeat(groups) + rest + line.slice(lead.length);
    }).join("\n");
  }

  refresh() {
    const code = this.ta.value;
    this.hl.innerHTML = this.highlight(code);
    this.problems = this.opt.liveLint ? lintPython(code, this.opt) : [];
    const bad = new Set(this.problems.map((p) => p.line));
    const count = code.split("\n").length;
    let g = "";
    for (let i = 1; i <= count; i++) g += `<div class="gl${bad.has(i) ? " bad" : ""}" data-line="${i}">${i}</div>`;
    this.gutter.innerHTML = g;
    this.syncScroll();
    this.onChange(this.problems, this);
  }

  syncScroll() {
    this.hl.style.transform = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`;
    this.gutter.scrollTop = this.ta.scrollTop;
  }

  gotoLine(n) {
    const lines = this.ta.value.split("\n");
    let pos = 0;
    for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    this.ta.focus();
    this.ta.setSelectionRange(pos, pos + (lines[n - 1] || "").length);
  }
}

/* ---------- 4. the Python engine --------------------------- */
const HARNESS = `
import json, sys, io, traceback

def _last_line(exc):
    tb = exc.__traceback__
    n = None
    while tb:
        if tb.tb_frame.f_code.co_filename == "<answer>":
            n = tb.tb_lineno
        tb = tb.tb_next
    return n

def _syntax(e):
    return {"kind": type(e).__name__, "msg": e.msg, "line": e.lineno, "col": e.offset, "text": e.text}

def _guard(limit):
    state = {"n": 0}
    def tracer(frame, event, arg):
        if event == "line":
            state["n"] += 1
            if state["n"] > limit:
                raise RuntimeError("This code ran for too long — check for a loop that never ends.")
        return tracer
    return tracer

def _2c1p(payload):
    d = json.loads(payload)
    code = d["code"]; fn = d.get("fn"); tests = d.get("tests") or []
    limit = d.get("steps", 400000)
    out = {"ok": False, "stage": "compile", "stdout": "", "results": []}
    try:
        obj = compile(code, "<answer>", "exec")
    except (IndentationError, TabError, SyntaxError) as e:
        out["error"] = _syntax(e); return json.dumps(out)

    ns = {"__name__": "__main__"}
    buf = io.StringIO(); real = sys.stdout; sys.stdout = buf
    sys.settrace(_guard(limit))
    try:
        exec(obj, ns)
    except BaseException as e:
        sys.settrace(None); sys.stdout = real
        out["stage"] = "run"; out["stdout"] = buf.getvalue()
        out["error"] = {"kind": type(e).__name__, "msg": str(e), "line": _last_line(e)}
        return json.dumps(out)
    sys.settrace(None); sys.stdout = real
    out["stdout"] = buf.getvalue()

    if not fn:
        out["ok"] = True; out["stage"] = "done"; return json.dumps(out)

    if fn not in ns:
        out["stage"] = "check"
        out["error"] = {"kind": "MissingFunction", "msg": "No function named '%s' was defined." % fn}
        return json.dumps(out)
    if not callable(ns[fn]):
        out["stage"] = "check"
        out["error"] = {"kind": "NotAFunction", "msg": "'%s' exists but is not a function." % fn}
        return json.dumps(out)

    passed = 0
    sys.settrace(_guard(limit))
    for t in tests:
        row = {"call": t["call"], "expect": t["expect"]}
        b2 = io.StringIO(); real2 = sys.stdout; sys.stdout = b2
        try:
            got = repr(eval(t["call"], ns))
            row["got"] = got; row["pass"] = (got == t["expect"])
        except BaseException as e:
            row["got"] = "%s: %s" % (type(e).__name__, e); row["pass"] = False
            row["error"] = True
        sys.stdout = real2
        if row["pass"]: passed += 1
        out["results"].append(row)
    sys.settrace(None)
    out["passed"] = passed; out["total"] = len(tests)
    out["ok"] = passed == len(tests); out["stage"] = "done"
    return json.dumps(out)
`;

const PyEngine = {
  ready: false, loading: null, py: null,
  async ensure(onStatus) {
    if (this.ready) return true;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      onStatus && onStatus("Loading Python…");
      if (!window.loadPyodide) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = CONFIG.pyodideUrl; s.onload = res;
          s.onerror = () => rej(new Error("Python could not be downloaded. Check the internet connection and try again."));
          document.head.appendChild(s);
        });
      }
      this.py = await window.loadPyodide();
      this.py.runPython(HARNESS);
      this.ready = true;
      onStatus && onStatus("Python ready");
      return true;
    })();
    try { return await this.loading; }
    catch (e) { this.loading = null; throw e; }
  },
  async execute(code, fn, tests, onStatus) {
    await this.ensure(onStatus);
    const payload = JSON.stringify({ code, fn: fn || null, tests: tests || [], steps: 400000 });
    const raw = this.py.globals.get("_2c1p")(payload);
    return JSON.parse(raw);
  },
};

if (typeof module !== "undefined") module.exports = { scanPython, lintPython, explainError, PyEditor, PyEngine };
