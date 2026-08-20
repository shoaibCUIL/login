# Computational Linguistics with Python — course tests

A single static site. No server, no database. Upload the five files to a GitHub
Pages repository and the address works on any phone or laptop.

## Files

| File | What it is | Do you edit it? |
|---|---|---|
| `index.html` | The page structure | Rarely |
| `styles.css` | Colours, type, layout | Only for looks |
| `editor.js` | The code editor, the indentation checker and the Python engine | No |
| `app.js` | Sign-in, test flow, marking, instructor panel | No |
| `data.js` | **Config, class list, schedule and all 60 questions** | **Yes — this one** |

## Putting it online

1. Make a repository, e.g. `python-tests`.
2. Upload all five files to the root of the `main` branch.
3. Settings → Pages → Source: `main`, folder `/ (root)`.
4. Share the address, e.g. `https://yourname.github.io/python-tests/`.

Open it over the https address, not by double-clicking the file — the instructor
password check needs https.

## Before the first test

Open `data.js` and change three things:

1. **`ROSTER`** — replace the 18 placeholder rows with your real names and numbers.
   Students sign in with the number, digits only, `03xxxxxxxxx`.
2. **`SCHEDULE.startDate`** — the first Monday. The attendance register builds 45
   session dates from it.
3. **The admin password** — default is `2C1P-admin-2026`. Change it inside the
   site: Ctrl+Shift+A → Settings → new password → **Build data.js**, then upload
   the downloaded file over the old one.

## How students use it

- Sign in with their phone number.
- Tests only open between 7 PM and midnight Pakistan time. The practice console
  stays open all day and is never marked.
- Six tests, ten questions each: eight multiple choice, two to write in Python.
- Every submission asks "are you sure?" first. There is no going back.
- A correct first attempt scores 10, a correct second attempt scores 5. A hint
  halves whatever the question is worth.
- 25 minutes per test. Unanswered questions score zero when the clock runs out.
- 70% overall across all six tests earns the certificate.

## The code editor

The editor enforces Python's indentation rules rather than working around them.

- Tab inserts four spaces. Shift+Tab removes four. Tabs are never inserted.
- Enter keeps the current indent, and adds a level after a line ending in `:`.
- It checks as they type: missing block after a colon, unexpected indent, an
  indent that is not a multiple of four, an unindent that matches no outer block,
  a missing colon, an unclosed bracket or quote, and tab characters.
- **Run code** compiles with real CPython (Pyodide). A syntax or indentation
  error comes back with the line, the offending line of code and a caret under
  the exact column, plus a plain-English note on how to fix it.
- **Submit** only marks code that compiles. If it will not compile, the attempt
  is not used up.
- A loop that never ends is stopped after 400,000 steps rather than freezing the
  phone.

To allow other indent widths, set `strictIndent: false` in `data.js`. To allow
tabs, set `banTabs: false`.

## Collecting results

The site is static, so each student's score lives in their own browser. At the
end of a test they get a short verification code.

1. Student presses **Send on WhatsApp** — it opens a message to your number with
   the score and the code.
2. You open the site, press Ctrl+Shift+A, Results tab, paste the codes (many at
   once, one per line) and press **Add results**.
3. The code carries a checksum. If a student edits their score, the paste is
   rejected.

From there: CSV export, per-test averages, pass rate, and flags for students who
ran out of time or left the tab more than twice.

## Instructor panel

Ctrl+Shift+A, or add `#admin` to the address.

- **Overview** — averages and pass rate per test.
- **Results** — paste codes, export CSV, clear.
- **Students** — who has sat what, and a WhatsApp nudge link per student.
- **Attendance** — 18 × 45 register, ticked by hand, CSV export.
- **Questions** — edit any of the 60 questions, then **Build data.js**.
- **Settings** — name, number, pass mark, time limit, opening hour, hints,
  paste-blocking, indent strictness, password.

Anything you change in Overview/Questions/Settings lives in that browser only
until you press **Build data.js** and upload the downloaded file. That is the
save button.

## Changing questions by hand

In `data.js` each test has `mcq` and `code` arrays.

```js
{ q: "Question text, HTML allowed",
  options: ["A", "B", "C", "D"],
  answer: 1,                 // 0 = A
  why: "Shown after they answer",
  hint: "Shown if they buy a hint" }
```

```js
{ q: "Short title",
  brief: "What to write, HTML allowed",
  starter: "def name(x):\n    ",
  fn: "name",                          // the function being marked
  tests: [ { call: 'name(2)', expect: "4" } ],   // expect = Python repr()
  solution: "def name(x):\n    return x * 2",    // your reference answer
  hint: "…" }
```

`expect` is compared against `repr()` of the returned value, so a string answer
is written with quotes inside the quotes: `expect: "'Hello!'"`.

## Known limits

- Pyodide is about 10 MB on first load and needs an internet connection. It is
  cached afterwards. Everything except running code works offline.
- Clearing browser data clears a student's scores. Tell them to send the result
  code before they clear anything.
- Blocking paste stops the clipboard, not a second device. The tab-switch counter
  is a hint, not proof.
