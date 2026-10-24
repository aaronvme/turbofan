# Handoffs

One file per branch: `docs/handoffs/<wave>-<name>.md` (e.g. `w0-contracts.md`). Written by the builder on DONE and on STOP-CLEAN, and rewritten (not appended) each time, so the next agent can start fresh from it.

Format:

```
<branch>: <one-line status> (from <base commit>; HEAD <commit>)

DONE
- <commit> what changed, with the test that proves it

NEXT
- the exact next steps, in order

GOTCHAS
- anything the next agent would otherwise rediscover the hard way

GATES @<commit>
- npm test: N passed / N skipped
- npm run lint: clean
- npm run typecheck: clean
- coverage: lines X% (core dirs Y%)
- gpu/browser suites if touched: result
```
