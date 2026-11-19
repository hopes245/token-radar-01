# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hopes245/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hopes245/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: every pre-token protocol, ranked by what its token could be worth. The board covers all 40 watchlist protocols plus 147 early rows below the floor, each with an implied value computed from its own TVL, growth, age and reach, priced off a curve fitted on 119 live-token protocols and tested blind (leave-one-out error 27% smaller, time-split error 47% smaller than a flat category median), measured against its own category's growth, plus a concrete nine-step farm plan with costs and times, netted to a total cost, a break-even and a FARM / THIN / SKIP verdict from a 200-refit value band. The dashboard adds a watchlist, implied-value alerts, category charts and an implied-value histogram, a minimum-TVL filter, and a per-protocol detail view with a factor-by-factor breakdown. Built by an AI agent for make.fun's "Build the best token launch radar" bounty.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
