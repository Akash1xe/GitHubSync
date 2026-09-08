# GitHubSync

Import your **previously accepted LeetCode submissions** and organize them topic-wise in this repository.

The importer runs locally. Your `LEETCODE_SESSION` cookie is read from an environment variable and is **never written to the repository**.

## What it creates

```text
solutions/
├── Binary-Search/
├── Sliding-Window/
├── Two-Pointers/
├── Dynamic-Programming/
├── Graphs/
├── Trees/
├── Greedy/
├── Stack/
└── ...
```

Each problem is stored once under a deterministic primary topic, while all LeetCode tags are preserved in generated topic README files.

## Windows setup

Requirements: Node.js 18+ and Git.

```powershell
git clone https://github.com/Akash1xe/GitHubSync.git
cd GitHubSync
$env:LEETCODE_SESSION="PASTE_THE_COOKIE_VALUE_HERE"
npm run sync
```

After reviewing the generated files:

```powershell
npm run sync -- --push
```

### Get `LEETCODE_SESSION`

1. Sign in to LeetCode.
2. Press `F12`.
3. Open **Application → Cookies → https://leetcode.com**.
4. Copy the value of `LEETCODE_SESSION`.
5. Put it only in your local PowerShell session as shown above.

Do **not** paste the cookie into ChatGPT, GitHub, source code, issues, screenshots, or commits.

## Options

```text
--push              Commit and push generated solution files
--refresh           Re-fetch already imported problems
--language <lang>   Prefer an accepted language; default: cpp
--delay <ms>        Delay between LeetCode requests; default: 400
```

Example:

```powershell
npm run sync -- --language cpp --push
```

The importer prefers C++ but falls back to the latest accepted submission when C++ is unavailable, so solved problems are not omitted.
