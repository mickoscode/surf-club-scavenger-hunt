# Overview

This website will be used to provide free scavenger hunt games. 
Only 1 game will exist at any time. So only 1 game can be in progress at any time. Most of the functionality will be provided by the website. But the game will also rely on a whatsapp group to simplify photo submissions and broadcast communications (including any emergency messages: the website has no emergency controls such as end/extend/pause game).

Expected size: fewer than 50 teams. No cap on the number of teams is required.

## Technical Approach

- Static pages (HTML, Bootstrap, JavaScript) on S3 + CloudFront, as in this repo today.
- The game needs shared state (teams, answers, scores, config), so the site also needs a small backend in the same AWS account, managed by Terraform: API Gateway + Lambda + DynamoDB (same pattern as the surf-club-signin repo).
- All validation happens on the server: answer checking, scoring, one-submission-only, and game timing. The server clock is the only clock that counts; the browser clock is used only to display the countdown.
- The official answers never leave the server, and neither does the answer a team submitted, with one exception: once the admin has published the final results, a team's own results page receives its answers, which were right, and the official answers (see "Answer rules" and "Results page"). Before that nothing is sent, and a browser without a team session never receives any of it.
- Accepted risk: this repository is public, so anyone who looks can read the official answers in docs/game-questions.json on GitHub. The server only prevents them being sent to the players' browsers. (Decision 2026-11-07: accepted. Options considered: keep the real questions out of the repo, or make the repo private, which would lose rulesets and required reviewers on GitHub Free.)
- The admin pages and their API calls have no authentication (accepted risk, see Admin Requirements).

## Website Pages

The site will only ever be accessible via a free aws cloudfront domain. Players and viewers will be given the url via a QR code/link (managed separately via whats app). 

page: <cloudfront_url>/
Redirects to /view/
page: <cloudfront_url>/game-config/
Used by Admin to edit the game config (5 fields), remove teams, and download/delete player data. Zones, questions and maps are NOT edited here: they are managed in the code repository (see Game Play).
Used by Admin to confirm all scores have been applied, by publishing the final results (a separate form on this page, see "Publishing the final results"). Publishing is what makes the results page show a player's final results and the answers to all questions, and turns the scoreboard's "provisional results:" into "final results:".
page: <cloudfront_url>/game-score/
Used by Admin to set scores for photo questions (submitted via separate whatsapp group). 
page: <cloudfront_url>/view/
Used by players to join
Used by players & viewers to view the live scoreboard
page: <cloudfront_url>/play/
Used by players to read instructions, select zone and answer questions
page: <cloudfront_url>/results/
Used by players, once the admin has published the final results, to see how they finished and a detailed breakdown of their score: all the answers, which were correct and which were wrong, and the official answers (see "Results page"). The top of the page includes a link back to the view/scoreboard page, identical to the one on the play page.
This page is not relevant to viewers. If a viewer visits this page (i.e. there is no active player session), they see only the link back to the view/scoreboard page.

The admin pages are not linked from anywhere and are marked noindex.

## Game Configuration & Management

The website will only ever have 1 game configured at any time.
The game must have a game-day (yyyy-mm-dd), game-start time (hh-mm), game-end time (hh-mm) and game-timezone (default = AWST).
The game is ACTIVE when game-start <= now <= game-end, where now, game-start and game-end are full date-times in game-timezone (inclusive at both ends). The game-day is always a single day: game-end is on the same day as game-start and must be later than it.
The game configuration can be edited by the admin at any time, EXCEPT when the game is active. Game configuration must also be editable at any time for the initial bootstrap setup.

game-name (string): default = "Sorrento Youth Scavenger Hunt"
game-timezone (timezone): chosen from a dropdown of Australian time zones; default = AWST Australian Western Standard Time (UTC + 8)
game-day (date): yyyy-mm-dd
game-start (datetime): <game-day> hh:mm:00
game-end (datetime): <game-day> hh:mm:00   (must be > game-start)
is-game-active (calculation): true/false - this is calculated as needed (as defined above), not stored/configured

### Zones and questions are loaded when the config is saved

When the admin saves the game configuration, the game loads (takes a copy of) the zones, questions and photo challenges from docs/game-questions.json as it is deployed at that moment. The game must work with whatever that file contains: for example a future game may have 4 zones, or 8 questions in a zone. Nothing in the website assumes 5 zones or 5 questions.
Merging a change to game-questions.json does not affect a configured game until the config is saved again (which is only possible when the game is not active). Questions that are not in the current copy do not exist for players.

### Typical Timeline

Steps happen in the following order, but the time between steps will vary, depending on whether the game is being tested, or the real life game is being played. A single day (yyyy-mm-dd) could be used to start and end multiple games (for testing), but given only 1 can ever be configured, it follows that only 1 game can ever be ACTIVE at any time.

PRE-GAME:
- now < game-start
- Admin can configure/edit game 
   - this step can be repeated while game is NOT active.
- Admin can delete all player data
- Players can join
- Players CANNOT play yet
- The view and play pages show a countdown to game-start

GAME IS ACTIVE:
- game-start <= now <= game-end
- Players can join
- Players can play
- Admin can score
- Admin can remove a team (moderation)

POST-GAME
- now > game-end
- Players CANNOT join
- Players CANNOT play. A submission that arrives after game-end is rejected, even by a second (no grace period).
- The view page shows "Game over" and the scoreboard (headed "provisional results:" until the admin publishes the final results). The play page shows "Game over" with a link to the scoreboard. Both remain available until the admin deletes the data.
- Admin can score (so the scoreboard can still change after the game ends), until the final results are published
- Admin can publish the final results, only once now > game-end, and can return them to provisional (see "Publishing the final results")
- Once the final results are published, the 'play' button on the view page becomes a 'results' button, and players can see their results
- Admin can delete all player data (names, answers, scores). This also returns the results to provisional.
- Admin can configure/edit game. Saving the configuration also returns the results to provisional.

## Personas

The are 3 distinct users for the website:
1. Admin - Single person that creates/edits and manages the game. The admin may also be a player, for testing purposes.
2. Players - Individuals that join and play the game (i.e. submit answers). One team plays on one device.
3. Viewers - view the game scoreboard only

## Game Play

The game is played in the real world, while the website facilitates timing, questions, answers and scoring.
Game data is managed in docs/game-questions.json (see "game-questions.json format" below).
The game zones, questions and maps are managed in the code repository. The admin edits the game data by submitting and merging a PR, and then a workflow updates the website. 
The admin will merge a PR to publish a game consisting of multiple zones.
Each zone will have:
- zone-name (string): e.g. "Southside"
- zone-map (image): png or jpeg format (the Google Maps images in docs/game-zones are approved for use)
- questions to answer (5 in the default game; any number is supported)
- photo-challenge (string): description of what needs to be captured in the photo, which must be submitted via whatsapp
- photo-score (number): points for the photo challenge

### Joining

Players click 'join' to enter the game. They must enter a "team name", and the website will allocate them a unique team number (small integer starting at 1, shared & visible) and a unique player-id (random, hidden). The player can then reference their team number when submitting photos.
The form for joining has only 1 input field "Enter Team Name:"
One join = one team = one device. There is no second device, no per-player scoring, and no way to recover a lost session (see "Parked").
Team name rules: unique (ignoring upper/lower case), 1 to 30 characters, and rejected if it fails a basic profanity filter (the team names are shown publicly, to children).
As there is no login or authentication, a simple web session mechanism must be used to remember the player has joined, and to link player data to their player-id.

Once a player has joined:
- the 'join' button should no longer be displayed on the view page.
- the 'play' link should be displayed instead of the join button. The play link links to the play page. Once the final results are published, the 'play' button becomes a 'results' button that links to the results page.
- the view page does not display the player's team name (their own row in the scoreboard is highlighted instead).

### Scoreboard

Under the join/play/results button, the scoreboard should be displayed. Immediately above the scoreboard, the exact text "provisional results:" (lower case, with the colon) should be displayed, until the final results are confirmed and published. Once the results are confirmed, "provisional" should be changed to "final" ("final results:"). The heading is only shown above the scoreboard table: it is not shown while there are no teams.
The scoreboard should auto-refresh every 5 seconds, to include latest score totals and latest list of teams.
The scoreboard must be sorted by score (descending order), then team name (alphabetically).
The scoreboard is a simple table with 3 columns (team number, team name, score), optimised for mobile display.
The player's own team row is highlighted.
Scores are shown as whole numbers, and with 1 decimal place only when a total needs it (e.g. 12.5).

### Play page

The play page works as follows:
- team name is displayed at the top, with the team number displayed large and clear (e.g. "Team 7"), because players need it for whatsapp photos. Team number and Team name should be displayed on a single line (wrapping as needed). Different text sizing and colouring should be used to make the distinction between name and number: the number ("Team 7") large, bold and in the site's blue; the name smaller and dark grey, sitting on the same baseline. A name of up to 30 characters with no spaces must still fit a phone screen.
- a 'view scoreboard' link is displayed below team name, which links back to the view page.
- once the final results are published, a link to the results page is also shown (the same 'results' button as on the view page).

Under the 'view scoreboard' link, display small tiles using the zone names and zone map images. Each tile shows the player's progress in that zone, e.g. "3/6 done" (questions plus the photo challenge).
clicking a zone tile should display individual forms to submit answers to each of the questions for that zone.
Players must also be able to view full size zone-map, and close it, returning to the zone questions.
Players must also be able to return to the play page, where they can again select any of the zone tiles, or click the 'view scoreboard' link.
When a correct answer is submitted, the team score total should be updated, which will then be visible on the next auto refresh for the score board.
The Photo challenge form should display the description, along with a button named 'photo sent to whatsapp'. 
Each question and photo challenge can be submitted only once, so the form should be disabled (and visibly marked as done) when submitted.
A form is marked done only after the server has confirmed the submission. If the network fails the player can try again; if the same form is somehow sent twice, the first one received counts.

### Answer rules

Every question has a type (see "game-questions.json format"): string, whole-number or decimal.
- After a submission the form shows "Done" only. Until the admin publishes the final results, the website NEVER displays what was submitted, and never says whether it was right or wrong, including after a reload or on another page. (This makes it harder for teams to share answers.) After the final results are published, a team's own results page shows its answers, which were right, and the official answers (see "Results page").
- string: the submitted text is trimmed, converted to lower case and compared with each accepted answer. Small typos are accepted: none for answers under 4 characters, 1 typo for 4 to 7 characters, 2 typos for 8 or more characters (typo = one added, missing or changed letter, or two neighbouring letters swapped).
- whole-number: the field accepts digits only (numeric keypad on phones). The value must match exactly.
- decimal: the field accepts digits and a single decimal point. The value must match exactly as a number (2.50 and 2.5 are the same value).
- Negative numbers are not supported.
- Photo challenges have no automatic checking: see the game-score page.

### game-questions.json format

Zones are keyed "zone 1", "zone 2", ... Each zone has: zone-name, zone-map (path to the image in the repo), photo-challenge, photo-score, and a list of questions. Each question has:
- "Q1", "Q2", ... : the question text (the key is the question's id within the zone)
- "type" : "string", "whole-number" or "decimal"
- "answer" : for whole-number and decimal, a single value as a string, e.g. "42" or "2.5". For string, either one answer, e.g. "paris", or a list of accepted answers, e.g. ["bike", "bicycle"] (each one gets the same typo tolerance). Write answers in lower case.
- "score" : points for a correct answer (a number)

## General Requirements
The site must be open to the public, so anyone can; view the live scoreboard, join the game and play the game. No authentication or account creation is required. 

### UX Modifications

The play and view pages show the status text and the countdown ("Time left" and the count down, or "Game starts in" and the count down before the game) on a single line, wrapping on a narrow screen only if it must, with no other style changes (the status text and the countdown keep their current sizes and weights). "Game over" and "Coming soon" have no countdown.

The view page no longer shows the player's team name above the scoreboard (see "Joining"), and the play page shows the team number and name on one line (see "Play page").

## Admin Requirements

The admin pages will not be protected by authentication. Urls for these pages should not be shared. 
Accepted risk: anyone who finds the admin pages or the API calls behind them could change the config, apply scores or delete data. Mitigations are limited to: the pages are not linked, they are marked noindex, and the API is rate limited.

page: <cloudfront_url>/game-config/

Admins use this page to edit config:
game-name (string): default = "Sorrento Youth Scavenger Hunt"
game-timezone (timezone): Australian time zone dropdown; default = AWST Australian Western Standard Time (UTC + 8)
game-day (date): yyyy-mm-dd
game-start (datetime): <game-day> hh:mm:00
game-end (datetime): <game-day> hh:mm:00   (must be > game-start)
Saving the config also loads the zones and questions from game-questions.json (see above). It is not possible while the game is active.

The page also lists the teams, with a 'remove' button for each (with confirmation), for moderating team names. Removing a team deletes its data. This is allowed at any time, including while the game is active.

Admins should also be able to delete all player data from a previous game. This is allowed before the game starts and after it ends, never while it is active. The data (teams, team numbers, submissions, scores) must first be downloaded as a single json file; the form should ask for confirmation before deleting the data. once confirmed, the data should be deleted, so that the next upcoming game has no players and no scores, and team numbers start again at 1.

### Publishing the final results

A separate form on this page (not part of the configuration form) lets the admin confirm that every score has been applied and publish the final results.
- It is not possible to publish until now > game-end (the server refuses; the form is disabled with a note while the game is not over).
- The form shows how many photo submissions have not been scored yet. The admin must tick "I have applied all scores" to publish. Any photo that was submitted but never scored counts as 0% (and the form says so).
- Publishing: the scoreboard's heading changes from "provisional results:" to "final results:", the 'play' button becomes a 'results' button for players with a team, and the results page shows each team its results.
- A "Return to provisional" button reverses it (for a mistake or a late correction): the scoreboard goes back to "provisional results:", the results page goes back to "not ready yet", and the 'results' button goes back to 'play' (after the game it leads to the "Game over" page).
- While the results are published, scores can not be changed: the scoring page says so and Apply is disabled. To correct a score, return to provisional first. Removing a team is still possible (and changes the places).
- Deleting all player data, or saving the game configuration, returns the results to provisional.

page: <cloudfront_url>/game-score/

This page enables the admin to confirm and apply the score for any photo challenge forms that have been submitted on the play page.
The admin will need to manually cross check the game-score page with the whatsapp group, to determine if a photo has actually been uploaded, and that it does meet the challenge criteria.
Team members must include their team number in the whatsapp message, and the photo must make it obvious which zone and challenge it is for. If it is not obvious, or there is no team number, or the player never pressed the 'photo sent to whatsapp' button, no score is awarded. There is no manual entry of photos or scores for missing submissions.

This page should dynamically list the photo challenges that have been submitted, in the order that they are sent (it refreshes automatically every 5 seconds).
Each submission should be listed on a single line that displays:
- Team number
- zone name
- 'full' radio button to award 100% of score, as defined in game-questions.json 
- 'half' radio button to award 50% of score, as defined in game-questions.json (not rounded: it can be a decimal)
- 'zero' radio button to award 0 
- 'apply' button to record the score decision. Clicking this should update the score total for the relevant player/team, and move the line to the bottom of the table.
Each line carries the team's internal id as a hidden form field, so the decision is always applied to the correct team. The id itself is not displayed.
No radio button is selected by default, and 'apply' stays disabled until one is chosen, so a decision is always deliberate.

It should be possible to re-select a different radio button for a line that has already been applied, so that the score can be corrected if necessary. Correcting a score, by re-applying will require the previous apply to be deducted, before the latest decision is applied. It should not be possible to increase a players score by accidentally apply multiple decisions for the same zone photo challenge. 
The admin cannot undo or reset a team's answer submissions.
While the final results are published, this page is read-only (a note says why, and Apply is disabled); see "Publishing the final results".

## Player Requirements

page: <cloudfront_url>/view/
in addition to the display components described above, this page should display a live countdown until the game-end. It shows "N min left", and switches to mm:ss for the last 5 minutes. Before the game starts it shows a countdown to the game-start instead.

page: <cloudfront_url>/play/
in addition to the display components described above, this page should display the same live countdown.

It should be very intuitive for players to join, start playing, and to switch between the play page, zones, and the view page.

if a player closes and re-opens their web browser, or browser tabs, their game session should be saved and unaffected. 

### Results page

page: <cloudfront_url>/results/

Only available once the final results are published. A player (a browser with a team session) sees:
- At the top, the same link back to the view/scoreboard page as on the play page.
- A large heading with their place: "You finished 3rd of 12" (place, then number of teams). For 1st, 2nd and 3rd, a gold, silver or bronze medal character (🥇 🥈 🥉) is shown with the heading to emphasise the achievement. Teams with the same score share a place (1st, 1st, 3rd) and each gets that place's medal; the number of teams is every team that joined.
- Their total score.
- For each zone, for every question in it (including questions they never answered): the question, their answer (or "Not answered"), whether it was correct or wrong (marked clearly with an icon and text, not colour alone), the points earned out of the points available, and the official answer (when several answers are accepted, all of them, e.g. "bike or bicycle").
- For each zone's photo challenge: the percentage awarded and the points ("Full: 100% - 30 of 30 points", "Half: 50%", "Zero: 0%"), or clearly "No photo submitted". A photo that was submitted but never scored shows 0% and says it was not scored.

Before the results are published (including during the game) the page tells a player the results are not ready yet and shows only the link back to the scoreboard; nothing about the answers is sent to the browser. A viewer (no team session, or a removed team) always sees only the link back to the scoreboard. Like all pages it is mobile first and must fit a phone.

### Instructions

The game instructions must be displayed at the top of the play page.
The heading "Instructions (tap to show/hide)" must be visible at all times.
The instructions content should be hidden by default, but then revealed/hidden as the player taps the heading.

Instructions content should be hard coded. It can be modified via a PR to the code repo, and does not require any website admin functionality. The instruction content to be hardcoded is in ./player-instructions.md

## Viewer Requirements

Anyone who goes to the main landing page (join button and scoreboard), and chooses not to click join, is considered a viewer.

Viewers should only ever see the main landing page (unless they click join, to become a player). If a viewer opens the results page they see only the link back to the scoreboard.

page: <cloudfront_url>/view/

## Parked for later (not in the first version)

- Restoring an old game: uploading the downloaded json file back into the website.
- Recovering a team's session after a cleared browser or a different phone (e.g. rejoin with team number and name).
- Admin passcode for the admin pages.

## As built

Where the finished site is more specific than the text above (details settled while building; the code and `docs/api.md` are the reference):

- **Scoreboard**: three columns (team number, team name, score); the player's own row is highlighted; scores show as whole numbers or with one decimal place only when needed.
- **Countdown**: "N min" until the last 5 minutes, then "m:ss"; before the start it counts to the start. It uses the server's clock. The status text and the countdown share one line on `/view/` and `/play/`.
- **Team line on `/play/`**: "Team 7" (large, bold, blue) and the name (smaller, dark grey) on one baseline; a name too long for the line wraps below the number. The view page shows no separate team name: the team's own row in the scoreboard is highlighted.
- **Statuses**: the game is `unconfigured`, `pre`, `active` or `post`; the end is inclusive and exact (no grace period).
- **Questions appear only while the game is active** (the API does not send them earlier or later).
- **Admin pages**: team removal asks for confirmation; deleting player data needs the download link used and the word "delete" typed, and is refused while the game is active. The scoring page identifies a team by hidden form fields (team number and zone); Apply is enabled only when scoring is open and the choice differs from what is recorded.
- **API status codes** avoid 403 and 404 for the API's own errors (CloudFront replaces those with the site's 404 page): wrong state is 409, unknown references 400.
- **Zone and question counts** are whatever `game-questions.json` holds when the admin saves the configuration (the zones are copied at that moment).
- **Maps** are converted at build time to small thumbnails and full-size WebP files.
- **Not built (parked)**: restoring an old game from its download, recovering a lost session, an admin passcode. See also "Accepted risk" above.

