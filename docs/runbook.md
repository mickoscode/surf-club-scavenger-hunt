# Running a scavenger hunt: runbook

For the person running the game (the admin). What the site does is in `requirements.md`; this is what **you** do, in order. A dress rehearsal checklist is in `rehearsal-checklist.md`.

**The addresses** (all on the site's own address, the `site_url` shown by the Terraform run or `https://d39sfolumy790h.cloudfront.net` today):

| Address | Who | What |
|---|---|---|
| `/` (goes to `/view/`) | everyone | the scoreboard, and joining. This is the address and QR code you give out |
| `/play/` | teams | the game (teams reach it from the scoreboard page) |
| `/results/` | teams | each team's final results (only once you have published them) |
| `/game-config/` | you | set up the game, remove teams, publish the final results, download and delete the data |
| `/game-score/` | you | score the photos |

The two admin pages have **no login**: do not share their addresses (they are only protected by not being known; the page names are in this public repo, which is a risk you have accepted).

---

## 1. Weeks before: write the game

The game is two files in this repo, changed by pull request like everything else.

1. **Questions and photo challenges: `docs/game-questions.json`.** The current content is **sample content**: replace it. Each zone has a name, a map image, a photo challenge with its points, and any number of questions (there is no fixed 5). Per question:
   - `type`: `"string"` (text), `"whole-number"` or `"decimal"`
   - `answer`: for text, one answer or a list of accepted answers (`["bike", "bicycle"]`), in **lower case**; for numbers, the value as text (`"42"`, `"2.5"`). Typos are accepted in text answers (none under 4 letters, one for 4 to 7, two for 8 or more); numbers must be exact.
   - `score`: points for a correct answer
   
   Run `npm run validate:data` to check it; the `Game data` check does the same on the pull request and tells you exactly what is wrong. The format is in `requirements.md` ("game-questions.json format").
2. **Maps: `docs/game-zones/`.** Replace or add PNG/JPEG images and point each zone's `zone-map` at its file. Keep each to a normal screenshot size: the build shrinks them for phones.
3. **Instructions: `docs/player-instructions.md`.** Plain Markdown (headings, bullets, bold). It appears on the play page under "Instructions (tap to show/hide)".
4. **Merge the pull request.** The deploy updates the live site, the questions and the instructions together. Check the **Deploy site** run is green (it ends with a smoke test of the live site).

> The questions and answers are in a public repository, so anyone who looks can read them. That is accepted for this game; do not put anything in the file you would not want read.

## 2. Dress rehearsal (a week or two before)

Do the checklist in `rehearsal-checklist.md` with a few real phones, using the real site. It uses the real pages and ends by deleting the rehearsal data, so the real game starts clean.

## 3. Setting up the real game (the day before or the morning of)

1. Open `/game-config/`. If there is rehearsal data (teams), **download it, type `delete`, and delete it** (section "Player data"). Only possible before the game starts or after it ends.
2. Set the **game name**, **time zone** (AWST for Perth), **game day**, **start** and **end** times, and press **Save**. The page confirms how many zones were loaded.
3. Check the status reads "before the game" and the zone count is what you expect.

Things to know:
- Saving **takes a copy of the questions as they are on the site at that moment**. If you change the questions or maps later (a new pull request), **press Save again** before the game starts, or the game keeps the old copy.
- The start and end are **in the time zone you chose**. The site's own clock decides everything (not anyone's phone), and the end is exact: an answer a second late is refused.
- Once the game has started you can **not** change the configuration or delete data (the page is locked). You can still remove a team.

## 4. Telling people

- Share the site address or its QR code in the WhatsApp group (managed outside this site). Teams can join **before** the game starts and see a countdown; zones only appear when it starts.
- The WhatsApp group is also how you contact everyone during the game. The site has no pause, extend or "end now" buttons: **WhatsApp is the emergency channel.**
- Photo rule (also in the instructions): the team number in the message, and a photo that makes it obvious which zone and challenge it is for.

## 5. During the game

- **Score as photos arrive** on `/game-score/` (it updates by itself). For each: check the photo in WhatsApp, choose **Full**, **Half** or **Zero**, press **Apply**. You can correct a decision by choosing another and applying again: it replaces, never adds. No photo in WhatsApp, no team number, or can't tell which zone: **Zero** (or leave it).
- **A team name you do not like:** `/game-config/`, Teams, **Remove** (and confirm). The team's data goes with it and the name is free again; they can join under another name.
- Watch the scoreboard on `/view/` if you like. Scores shown include only automatic answers and the photo decisions you have applied.

## 6. After the game

- The game ends by itself at the end time; teams' play pages say "The game is over. Final results will be published soon!", answers are refused, and the **Play** button on the scoreboard page becomes a **Results** button straight away (before you publish, it leads to a page saying the results are not ready). **You can keep scoring afterwards** and the scoreboard stays up.
- **Score the remaining photos** on `/game-score/`.
- **Publish the final results** (only possible once the game has ended): `/game-config/`, section **Final results**. It tells you how many photos have not been scored yet (they will count as 0%). Tick **I have applied all scores** and press **Publish final results**. Then:
  - the scoreboard heading changes from "provisional results:" to "final results:";
  - the play page's message changes from "Final results will be published soon!" to "The final results are in!", and it gets a Results link;
  - each team's results page shows how it finished ("You finished 3rd of 12", with a gold, silver or bronze medal for the top three; teams on the same score share a place), its total, and for every question what it answered, whether that was right, the points, and the **official answer**, plus the percentage it was awarded for each photo challenge.
- **A mistake after publishing?** Press **Return to provisional**, fix the score on `/game-score/`, and publish again. While results are published, scores are locked (the scoring page says so).
- Announce the result from the scoreboard.
- **Keep the results:** `/game-config/`, Player data, **Download the player data**. The file has every team, its answers and its score (keep it private: it also contains each team's secret session id).
- **Clean up** (before the next game or rehearsal): type `delete` and delete. The next game then starts with no teams, team numbers back at 1, and results provisional again (saving a new game configuration also returns the results to provisional).

---

## When something goes wrong

| What you see | Why, and what to do |
|---|---|
| The scoreboard says **Coming soon** | No game is configured. Set one up on `/game-config/` |
| Nobody can join | Joining is only open before the end time. Check the status on `/game-config/`: "game finished" means it has ended; "no game set up yet" means save a configuration |
| The countdown or times look wrong | Check the **time zone** and times on `/game-config/` (the page shows what is saved). The site's clock decides everything, and the countdown uses it too, so a phone with the wrong time makes no difference |
| **Save** refuses, "game in progress" | The game has started: the configuration is locked until it ends |
| **Save** lists problems in the game file | Nothing was saved. The list says what to fix in `docs/game-questions.json`; fix it by pull request, merge, then Save again |
| **Publish final results** is greyed out | The game has not ended yet (it is only possible after the end time), or the "I have applied all scores" box is not ticked |
| The scoring page says scores are locked | The final results are published. Press **Return to provisional** on `/game-config/` to change a score, then publish again |
| A team says its Results page only shows a link | Results are not published yet (the page says so), or that phone has no team: it was removed, or the browser data was cleared. A phone without a team never sees results |
| A team says its answer was refused as invalid | A number question was left empty or has a non-digit; it can try again (the question is not used up) |
| A team lost its place (cleared the browser, changed phone) | Sessions live in the phone's browser and cannot be recovered (a known, parked limit). They join again under a new name; remove the old team on `/game-config/` if you wish. Their earlier answers stay with the old team |
| A team pressed "Photo sent to WhatsApp" but nothing is in WhatsApp | Score it Zero. A team that sent a photo but never pressed the button does not appear on the scoring page and gets no points (the rule in the instructions) |
| "Could not refresh. Trying again..." on a page | The phone lost signal or the site was busy; it retries by itself every few seconds. An answer sent while offline is not counted until it shows Done: the team presses Submit again |
| Old content after you merged a change | The deploy refreshes the site's cache, which takes a minute or two. Reload; if it persists check the **Deploy site** run |
| The **Deploy site** run failed | Open the run in GitHub Actions. If only the final smoke test failed, the new version is already live: look at what it reports (it names the page or API call), fix forward, or revert the pull request and run **Deploy site** again from `main` |

## Limits and behaviour worth knowing

- **One phone per team.** Joining gives a team its number and a private session in that browser (kept 30 days). There is no login and no second device.
- **Answers are final.** Each question and photo can be submitted once. After submitting, the page shows only "Done": never what was typed, never whether it was right (only the score tells) until you publish the final results, when each team sees its own answers and the official ones.
- **Capacity.** Built for fewer than 50 teams plus spectators. The API allows 50 requests a second in total (burst 100); the scoreboard and game state are shared between viewers for a few seconds, and a visitor who has not joined does not poll for their team. If a big crowd ever shows "Could not refresh", raise `api_throttle_rate_limit` / `api_throttle_burst_limit` in `terraform/tfvars/prod.tfvars` (a Terraform apply).
- **Cost.** On-demand pricing everywhere: a game like this costs cents. There is no budget alarm in this repo.
- **Not built (parked):** restoring an old game from its download, recovering a lost session, an admin password.
