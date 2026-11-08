# #379: the fingerprint check, in plain words

Layer 1 of "Was the forecast changed after the fact?" (`web/src/panels/verify/index.jsx`) now shows:

- **Answer:** "Did we change our forecast after seeing the result? No." It reads "Not yet checked" while busy.
- **Two fingerprints side by side:** the one we published (with its UTC time) on Solana, and the one for the forecast on this page, each as the first 8 and last 4 characters. A big green `=` or red `≠` sits between them, and one plain sentence under them says what that means.
- **Try cheating:** "Try cheating: change one number" adds 1 to the GB 18:00 best guess (falling back to the first row) and shows that line, e.g. `GB Mon 18:00 best guess 270.89 → 271.89`. The button then reads Undo.
- **Link:** "Check it on Solana yourself" opens the transaction in the explorer.

The hashing, the on-chain read and For experts are unchanged. The separate Verify button is gone: the check still runs on load and on every toggle.

Screenshots are from a `vite preview` of the branch against the live API: `1920x1080-real.png`, `1920x1080-cheat.png`, `390x844-real.png` and `390x844-cheat.png`.
