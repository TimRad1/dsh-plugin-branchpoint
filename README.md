# Branchpoint

**Fork the conversation at a clean point.**

Branchpoint is a [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) plugin that adds a fork button to the chat header. Click it and Branchpoint reads the current branch, distills what matters, and opens a fresh session with that digest already in the composer.

Long chats degrade. Compaction helps, but it also blurs the thread. Branchpoint gives you a clean branch that still knows where you were.

[![release](https://img.shields.io/github/v/release/TimRad1/dsh-plugin-branchpoint)](https://github.com/TimRad1/dsh-plugin-branchpoint/releases/latest)
[![license](https://img.shields.io/github/license/TimRad1/dsh-plugin-branchpoint)](LICENSE)

## What it does

- Adds a fork icon to `conversation.session.header.actions`, next to the branch title.
- Loads up to two older pages of session history when the prompt is outside the current window.
- Builds a compact digest:
  - the goal (last human prompt);
  - the latest assistant conclusion;
  - what was done in the last completed turn;
  - what is still open, including `in progress: <prompt>` when the latest turn has no answer yet;
  - errors from meaningful tools, changed files, versions, commands and key concepts.
- Opens a new session and puts the digest in the draft. It does **not** send automatically, so you can review it first.

## Example digest

```text
🌿 BRANCHPOINT — BRANCH SUMMARY
🎯 Goal: the handoff button does nothing

📌 LATEST CONCLUSION:
Fixed the silent no-op: the digest builder now keeps orphan assistant text and
pages older history before summarizing.

✅ DONE (1):
- silent no-op on empty digest → alert + fallback summary

⏳ OPEN (1):
- in progress: verify the button in a fresh session

📂 STATE:
· changed: lib/client.js
· files: lib/client.js, package.json
· run: npm test

(Summary, not a transcript: intermediate steps are omitted. Continue from this.)
```

## Install

Not on npm yet. Install the prebuilt tarball from the latest GitHub release:

```powershell
$tgz = "$env:TEMP\branchpoint.tgz"
Invoke-WebRequest "https://github.com/TimRad1/dsh-plugin-branchpoint/releases/latest/download/branchpoint.tgz" -OutFile $tgz
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add ("file:" + ($tgz -replace '\\', '/'))
```

Or open **Settings → Plugins** in DSH and install the downloaded `.tgz` archive.

Fully quit and relaunch DSH. The desktop profile applies plugin composition at startup (it has no HMR).

## Use

1. Open an existing chat with at least one exchange.
2. Click the fork icon in the header.
3. Review the digest in the new session's composer and send it when ready.

The button is hidden on a blank session: DSH hides the header actions until the session has history.

## How it works

- `lib/index.js` is a minimal host half (`name`, empty `apply`).
- `lib/client.js`:
  - `inject = ['slots', 'uiWorkspace', 'sessions']`;
  - registers in `conversation.session.header.actions`;
  - reads `ctx.sessions.binding(sessionId).eventSource`;
  - `entriesToTurns` and `entriesToTools` parse messages and tool calls;
  - `loadOlderHistory` pages older history (max 2 pages, 7 s);
  - `buildDigest` produces the summary;
  - `ctx.uiWorkspace.startSession(undefined, { prompt: digest, clearPreviousDraft: true })` opens the new session.

No build step: `lib/client.js` is a ready ESM bundle in the `window.__ModuleLoader__` envelope.

## Limitations

- The digest is built from the **DSH session event log**. Reasoning and raw tool output are not summarized; only visible assistant text, tool errors, changed files and commands are used.
- The digest framing is English. Quoted conclusions stay in the language of the chat, since they are extracted verbatim.
- History is paged at most twice per click, so extremely long sessions may need a second click to reach the original prompt.
- If a branch has no assistant text and no tool results, Branchpoint shows an alert and does not open an empty session.

## Development

```powershell
node --check lib/client.js
npm pack
```

To load local changes, install the new `.tgz` (or `link:<folder>`) and restart DSH.

## License

MIT © 2026 TimRad1
