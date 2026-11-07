# Overview

This website will be used to provide free scavenger hunt games. 
Only 1 game will exist at any time. So only 1 game can be in progress at any time. Most of the functionality will be provided by the website. But the game will also rely on a whatsapp group to simplify photo submissions and broadcast communications (including any emergency messages: the website has no emergency controls such as end/extend/pause game).

Expected size: fewer than 50 teams. No cap on the number of teams is required.

## Technical Approach

- Static pages (HTML, Bootstrap, JavaScript) on S3 + CloudFront, as in this repo today.
- The game needs shared state (teams, answers, scores, config), so the site also needs a small backend in the same AWS account, managed by Terraform: API Gateway + Lambda + DynamoDB (same pattern as the surf-club-signin repo).
- All validation happens on the server: answer checking, scoring, one-submission-only, and game timing. The server clock is the only clock that counts; the browser clock is used only to display the countdown.
- The official answers never leave the server. The browser never receives them, and never receives the answer a team submitted either (see "Answer rules").
- The admin pages and their API calls have no authentication (accepted risk, see Admin Requirements).

## Website Pages

The site will only ever be accessible via a free aws cloudfront domain. Players and viewers will be given the url via a QR code/link (managed separately via whats app). 

page: <cloudfront_url>/
Redirects to /view/
page: <cloudfront_url>/game-config/
Used by Admin to edit the game config (5 fields), remove teams, and download/delete player data. Zones, questions and maps are NOT edited here: they are managed in the code repository (see Game Play).
page: <cloudfront_url>/game-score/
Used by Admin to set scores for photo questions (submitted via separate whatsapp group). 
page: <cloudfront_url>/view/
Used by players to join
Used by players & viewers to view the live scoreboard
page: <cloudfront_url>/play/
Used by players to read instructions, select zone and answer questions

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
- The view page shows "Game over" and the final scoreboard. The play page shows "Game over" with a link to the scoreboard. Both remain available until the admin deletes the data.
- Admin can score (so the scoreboard can still change after the game ends)
- Admin can delete all player data (names, answers, scores)
- Admin can configure/edit game 

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
- the 'play' link should be displayed instead of the join button. The play link links to the play page.
- the player's "team name" should be displayed below the play link.

### Scoreboard

Under the join button / team name, the scoreboard should be displayed.
The scoreboard should auto-refresh every 5 seconds, to include latest score totals and latest list of teams.
The scoreboard must be sorted by score (descending order), then team name (alphabetically).
The scoreboard is a simple table with 3 columns (team number, team name, score), optimised for mobile display.
The player's own team row is highlighted.
Scores are shown as whole numbers, and with 1 decimal place only when a total needs it (e.g. 12.5).

### Play page

The play page works as follows:
- team name is displayed at the top, with the team number displayed large and clear (e.g. "Team 7"), because players need it for whatsapp photos
- a 'view scoreboard' link is displayed below team name, which links back to the view page.

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
- After a submission the form shows "Done" only. The website NEVER displays what was submitted, and never says whether it was right or wrong, including after a reload or on another page. (This makes it harder for teams to share answers.)
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

## Player Requirements

page: <cloudfront_url>/view/
in addition to the display components described above, this page should display a live countdown until the game-end. It shows "N min left", and switches to mm:ss for the last 5 minutes. Before the game starts it shows a countdown to the game-start instead.

page: <cloudfront_url>/play/
in addition to the display components described above, this page should display the same live countdown.

It should be very intuitive for players to join, start playing, and to switch between the play page, zones, and the view page.

if a player closes and re-opens their web browser, or browser tabs, their game session should be saved and unaffected. 

### Instructions

The game instructions must be displayed at the top of the play page.
The heading "Instructions (tap to show/hide)" must be visible at all times.
The instructions content should be hidden by default, but then revealed/hidden as the player taps the heading.

Instructions content should be hard coded. It can be modified via a PR to the code repo, and does not require any website admin functionality. The instruction content to be hardcoded is in ./player-instructions.md

## Viewer Requirements

Anyone who goes to the main landing page (join button and scoreboard), and chooses not to click join, is considered a viewer.

Viewers should only ever see the main landing page (unless they click join, to become a player).  

page: <cloudfront_url>/view/

## Parked for later (not in the first version)

- Restoring an old game: uploading the downloaded json file back into the website.
- Recovering a team's session after a cleared browser or a different phone (e.g. rejoin with team number and name).
- Admin passcode for the admin pages.
