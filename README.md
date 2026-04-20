# Kata

Learn to code through books and guided exercises. Mac + Windows (Tauri). Phone + Watch companions planned.

See [PLAN.md](PLAN.md) for the full product plan.

## Stack

- **Shell**: Tauri 2
- **Frontend**: React 19 + Vite + TypeScript
- **UI kit**: [`@mattmattmattmatt/base`](../../Libs/base) (local file link) — monochrome glass kit
- **Editor**: Monaco
- **Syntax highlighting (reading)**: Shiki (via base)
- **Languages V1**: JavaScript/TypeScript, Python, Rust, Swift
- **Code execution**: hybrid — in-browser sandboxes first, Tauri subprocess fallback

## Run

```bash
npm install
npm run tauri:dev     # full app
npm run dev           # frontend only (no Tauri shell)
npm run test          # vitest
```

## Layout

```
kata/
├── src/                    # React frontend
│   ├── components/         # Sidebar, TabBar, Lesson, Editor, Output
│   ├── data/               # types + seed courses
│   └── App.tsx
├── src-tauri/              # Rust Tauri backend
└── PLAN.md                 # product plan
```
