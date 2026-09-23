# Hearts Gang

Hearts with your friends at **[heartsgang.net](https://heartsgang.net)**. No accounts: open the site, create a table, share the 6-digit code, and deal.

- **Solo or teams.** A seat holds one player or a team. Teammates share one hand, highlight cards to suggest a pass or a play, talk in a private team chat, and either of them presses Pass or Play.
- **Any table from 3 to 6 seats.** Street Rules (2v2v1v1), Gang of Three (2v2v2), Six Solo, Classic Four, or custom.
- **Every house rule is a switch.** Jack of diamonds −10, Black Maria, moon scoring (+26 to others, −26 to the shooter, shooter's best, off), shoot the sun, points on the first trick, Q♠ breaks hearts, exact-target reset, pass count and rotation, timers.
- **Timers that keep the game moving.** When the pass clock runs out, the highlighted cards go and random ones fill the rest; when a turn clock runs out, a random legal card is played.
- **Bots** fill any empty seat. Emotes, table chat, scoreboard, last-trick peek, and it works on phones.

## How the pieces fit

| Folder | What it is |
| --- | --- |
| `packages/engine` | The rules of Hearts for 3–6 seats, every house rule, scoring, and the bot. Pure TypeScript, shared by the server and the browser. |
| `apps/server` | The game server: tables, seats, teams, highlights, timers, chat and emotes over WebSockets. It is the only place cards are dealt or judged, and each browser only ever receives its own seat's hand. Tables are saved to disk, so a restart or deploy doesn't end games. |
| `apps/web` | The React site: home, create, lobby and the table. |
| `infra` | AWS CDK: one small ARM EC2 server running the game behind Caddy (automatic HTTPS), a private S3 bucket for releases, the DNS records, and auto-recovery. |
| `e2e` | Browser tests that play real games in Chromium. |
| `.github/workflows/ci.yml` | Tests every push; deploys `main` to AWS once the deploy role is set. |

## Run it locally

```bash
npm install
npm run dev          # game server on :3000 and the site on http://localhost:5173
```

Open two browser windows to play against yourself, or add bots in the lobby.

## Tests

```bash
npm run typecheck
npm test             # rules engine (hundreds of simulated games) and server integration tests
npm run build
npm run e2e          # real games in Chromium against the production bundle
```

## Deploying to heartsgang.net

Deploys run from GitHub Actions into your AWS account, signing in through an IAM role. No AWS keys are stored anywhere. Full steps are in [deploy/README.md](deploy/README.md). In short:

1. Run `deploy/setup-aws.sh` in AWS CloudShell. It prints a role ARN.
2. If the domain was bought outside Route 53, set its nameservers to the four the script prints.
3. Put the ARN in `deploy/config.json` and push to `main`.

About $11 a month: a t4g.micro server, its public IP, a small disk, and the DNS zone.
