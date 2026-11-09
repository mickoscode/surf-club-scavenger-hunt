# Running a scavenger hunt: runbook

For the person running the game (the admin). What the site does is in `requirements.md`; this is what **you** do, in order. A dress rehearsal checklist is in `rehearsal-checklist.md`.

**The addresses** (all on the site's own address: the `site_url` shown by the Terraform run, for example `https://d123abc.cloudfront.net`):

| Address | Who | What |
|---|---|---|
| `/` (goes to `/view/`) | everyone | the scoreboard, and joining. This is the address and QR code you give out |
| `/play/` | teams | the game (teams reach it from the scoreboard page) |
| `/results/` | teams | each team's final results (only once you have published them) |
| `/game-config/` | you | set up the game, remove teams, publish the final results, download and delete the data |
| `/game-score/` | you | score the photos |

The two admin pages are protected by your **admin passcode**. Open either address and a login box appears; type the passcode (capitals, spaces and dashes don't matter) and you are in for **12 hours**, on that browser. **Log out** (top right) ends it sooner, and when 12 hours pass the box comes back by itself. After **10 wrong tries in 5 minutes** (counted across everybody) logging in is refused until those 5 minutes have passed, even for the right passcode, so if you are locked out just wait. Until the passcode has been set up the pages open without a login. Keep the passcode in your password manager; the page names are in this public repo, so the passcode is what protects the pages.

---

## 1. Weeks before: write the game

The game is two files in this repo, changed by pull request like everything else.

1. **Questions and photo challenges: `docs/game-questions.json`.** The file in the repo may be **sample content**: replace it with your real game. Each zone has a name, a map image and any number of questions (there is no fixed 5). Photo challenges are questions too: a zone can have none, one or several. Per question:
   - `type`: `"string"` (text), `"whole-number"`, `"decimal"` or `"photo"` (a photo challenge: the text says what to photograph, it has a `score` and no `answer`)
   - `answer` (not for photos): for text, one answer or a list of accepted answers (`["bike", "bicycle"]`), in **lower case**; for numbers, the value as text (`"42"`, `"2.5"`). Typos are accepted in text answers (none under 4 letters, one for 4 to 7, two for 8 or more); numbers must be exact.
   - `score`: points for a correct answer (for a photo challenge, its points when scored Full)
   
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
3. **WhatsApp group link (optional).** In WhatsApp open the group, Group info, **Invite to group via link**, **Copy link**, and paste it into **WhatsApp group link**. Press **Test link** to check it opens the right group, then **Save**. Teams that have joined then get links to the group: **Open WhatsApp group** under each photo challenge, and the word "WhatsApp" in the photo challenges and the instructions. Leave it empty and everything stays plain text. Spectators never see the link (it only goes to teams that have joined), and it is saved with the rest of the configuration, so set it **before** the game starts: it is locked while the game is in progress. Anyone you share the group link with can join the group, so a link you pasted by mistake can be reset in WhatsApp (Group info, Invite via link, Reset link) and replaced here after the game.
4. Check the status reads "before the game" and the zone count is what you expect.

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
| I cannot log in to an admin page | "That passcode is not right": check you are using the passcode for this site (case, spaces and dashes don't matter). "Too many wrong tries": wait the 5 minutes it says. Lost the passcode: on your computer run `node scripts/admin-passcode.js`, put the new hash in the HCP Terraform variable `admin_passcode_hash` (replacing the old one), approve the Terraform apply, and log in with the new passcode (this also ends every old session) |
| An admin page suddenly shows the login box again | Your 12-hour session ended (or you logged out on another tab). Log in again: the page carries on where it was |
| **Save** says the WhatsApp link is wrong | Only the group's invite link is accepted, which starts with `https://chat.whatsapp.com/`. Copy it again from WhatsApp (not a link to a person's chat) or leave the field empty |
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

## Load test

Shows how the site copes with a crowd, and where its limits are. Do it now and then (for example after changing the limits), never during a real game.
1. In the admin pages, set up a **demo game that has started** (full mode needs it in progress; **spectators-only** works any time). There must be **no real teams** on the site: the test refuses to run otherwise, and removes only its own teams (named `loadtest-001` and so on) afterwards.
2. GitHub > **Actions** > **Load test** > **Run workflow**, choosing **main**. Defaults (50 teams, 100 spectators, 5 minutes) are a sensible first run; the limits are 300 teams, 1,500 spectators and 15 minutes. Start small and work up.
3. When it finishes, the run page shows the summary, and the **load-test-report** artifact holds `report.html` (open it in a browser: charts, tables, a plain verdict), `report.json` and the raw `records.json`.
4. Read the verdict first: **Handled it**, **A limit was reached** (it says when, and at what rate), **Problems found**, or **Inconclusive** (the GitHub machine itself was overloaded: run again smaller).

Cost: the report shows an estimate. A run of a few minutes costs a few cents; a maximum run is still well under a dollar. The account budget alert (in the sign-in repository) is the real safety net. If a run is cancelled part way, test teams may remain: run it again (it clears leftovers first) or remove teams named `loadtest-...` on the Config page.

## Limits and behaviour worth knowing

- **One phone per team.** Joining gives a team its number and a private session in that browser (kept 30 days). There is no login and no second device.
- **Answers are final.** Each question and photo can be submitted once. After submitting, the page shows only "Done": never what was typed, never whether it was right (only the score tells) until you publish the final results, when each team sees its own answers and the official ones.
- **Capacity.** Built for fewer than 50 teams plus spectators. The API allows 50 requests a second in total (burst 200); the scoreboard and game state are shared between viewers for a few seconds, and a visitor who has not joined does not poll for their team. If a big crowd ever shows "Could not refresh", raise `api_throttle_rate_limit` / `api_throttle_burst_limit` in `terraform/tfvars/prod.tfvars` (a Terraform apply).
- **Cost.** On-demand pricing everywhere: a game like this costs cents. There is no budget alarm in this repo: the account-wide monthly budget alert in the `surf-club-signin` repo covers this site too.
- **Not built (parked):** restoring an old game from its download, recovering a lost session.
