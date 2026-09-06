# Claude / LLM instructions for this repo

SHORT GOAL:
- One-line: What to achieve here (MVP). Replace this line.

CONTEXT (very short):
- Repo purpose: <one short sentence>
- Important files: e.g., `src/`, `notebooks/`, `package.json`, `README.md`
- How to run (commands): e.g., `npm install && npm start` or `poetry install && make run`

TASK STYLE:
- Answer with code only when asked for code (no long intro).
- When proposing changes, show only diffs or file patches.
- Use minimal explanations (1–2 lines max) unless asked for more.

PRIORITY AREAS:
1. Fix tests / make CI green
2. Minimal working UI/API
3. Deploy instructions

CONSTRAINTS:
- Limit responses to what fits in ~800 tokens (short replies).
- If more context is needed, ask for `ALLOW_CONTEXT` to request files by name (do not assume).
- Prefer incremental patches over full-file rewrites.

CHECKLIST (example MVP):
- [ ] README with run steps
- [ ] One sample dataset / seed
- [ ] Basic tests
- [ ] CI passes
- [ ] Deployable build

HOW TO ASK FOR CHANGES:
- If you need a concrete change, say: `Do task: <one small task>` and include the path(s) to edit.
- Example: `Do task: Fix failing tests in tests/test_api.py` or `Do task: Add Dockerfile at /Dockerfile`.

NOTES:
- Keep prompts focused: 1 task per prompt.
- Save session TL;DRs in `/.ai/last-summary.md` and reference them next time to reduce tokens.
