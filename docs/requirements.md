# Overview

This website will be used to provide free scavenger hunt games. 
Only 1 game will exist at any time. So only 1 game can be in progress at any time. Most of the functionality will be provided by the website. But the game will also rely on a whatsapp group to simplify photo submissions and broadcast communications (including any emergency messages: the website has no emergency controls such as end/extend/pause game).

Expected size: fewer than 50 teams. No cap on the number of teams is required.

## Technical Approach

- Static pages (HTML, Bootstrap, JavaScript) on S3 + CloudFront.
- The game needs shared state (teams, answers, scores, config), so the site also needs a small backend in the same AWS account, managed by Terraform: API Gateway + Lambda + DynamoDB (same pattern as the surf-club-signin repo).
- All validation happens on the server: answer checking, scoring, one-submission-only, and game timing. The server clock is the only clock that counts; the browser clock is used only to display the countdown.
- The official answers never leave the server, and neither does the answer a team submitted, with one exception: once the admin has published the final results, a team's own results page receives its answers, which were right, and the official answers (see "Answer rules" and "Results page"). Before that nothing is sent, and a browser without a team session never receives any of it.
- Games ("events") are stored in a private S3 bucket, not in this repository (see "Events"): several can be prepared, and the admin chooses which one is live. `docs/` holds documentation and an example event only. The repository is public, so the example is readable by anyone, but a real game's questions and answers are not.
- Earlier decision (2026-11-07, superseded by events): while the game lived in `docs/game-questions.json` its answers were readable on public GitHub, which was accepted. Real games no longer have that exposure.
- The admin pages and their API calls are protected by an admin passcode (see "Admin passcode"). The API is limited to 50 requests a second sustained, with a burst of 200 (see "Request limits and cost").

## Website Pages

The site will only ever be accessible via a free aws cloudfront domain. Players and viewers will be given the url via a QR code/link (managed separately via whats app). 

page: <cloudfront_url>/
Redirects to /view/
page: <cloudfront_url>/game-config/
Used by Admin to choose the active event, edit its game config (name, time zone, day, start, end, team names on or off, join code, WhatsApp link), remove teams, and download/delete player data. Zones, questions and maps are NOT edited here: they are uploaded on the events page (see "Events").
page: <cloudfront_url>/game-events/
Used by Admin to upload, replace, download and delete events (see "Events").
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

The three admin pages (/game-config/, /game-score/, /game-events/) are protected by the admin passcode, are not linked from anywhere and are marked noindex.

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

When the admin saves the game configuration, the game loads (takes a copy of) the zones, questions, photo challenges, instructions and maps of the chosen event as they are stored at that moment. The game must work with whatever the event contains: for example a game may have 4 zones, 8 questions in a zone, or a zone with no photo challenge. Nothing in the website assumes 5 zones or 5 questions.
Uploading a change to an event does not affect the live game until the config is saved again (which is only possible when the game is not active). Questions that are not in the current copy do not exist for players.

### Events

An event is one complete game: its configuration, questions, photo challenges and maps. Many events can be stored; exactly one is active (the live game) at a time. This lets the admin prepare several games and switch the site between them (a demo for one audience, another for a different audience, then the real event).
- **Storage**: a private S3 bucket (`<aws-account-id>-scavenger-events`) with one folder per event: `<event>/game-config.json`, `<event>/game-questions.json`, `<event>/player-instructions.md` and `<event>/game-zones/*`. The bucket is not public, is encrypted, and keeps old versions of files so a bad edit can be undone. Only the admin function can read or write it. Players and the public function never touch it.
- **Event name**: 1 to 40 characters: lower case letters, digits and hyphens. It is the folder name and is only for the admin.
- **Activating**: choosing an event on the config page and saving copies its configuration, questions, instructions and maps into the live game. The saved configuration values are also written back to the event's `game-config.json`, so the stored event always matches what was last used. Maps are copied to the site under a path unique to that activation. Nothing in the live game reads the bucket after that.
- **Switching events is refused while any player data exists** (teams, submissions). The admin downloads and deletes the data first using the existing controls. Saving the same event again keeps the teams, as today. As always, the configuration cannot be changed while the game is active.
- **The events page** (`/game-events/`) lists the stored events (event name, game name, day, number of zones and questions, and which is active) and lets the admin:
  - **Upload** a new event: type its name and choose its folder (the questions file, the map images, and optionally `player-instructions.md` and `game-config.json`). The page checks the questions file with the same rules as the server (the "Game data" rules), shrinks the maps in the browser (a small thumbnail and a full-size image for each) and uploads them. Nothing is stored unless everything is valid.
  - **Replace** the questions, maps or instructions of an existing event by uploading again (there is no in-browser editor for them).
  - **Download** an event's configuration, questions and instructions as one file (the maps are not included: keep your original images).
  - **Delete** an event, after a confirmation. The active event cannot be deleted.
- **Limits**: the questions file at most 256 KB, each map image at most 500 KB after shrinking, at most 20 zones per event and 100 events. Images must really be images (checked by content, not by name), and the server builds every storage path itself from the validated event name, never from a path supplied by the browser.
- **docs/**: nothing in the live game reads `docs/`. `docs/game-questions.json`, `docs/game-zones/` and `docs/player-instructions.md` stay as an example of the format; the "Game data" check validates the example so the documented format stays correct. To start, the admin can upload the example as an event.
- With no event active the game is `unconfigured`, exactly as a new site is today.

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
- The view page shows "Game over" and the scoreboard (headed "provisional results:" until the admin publishes the final results). The play page shows "The game is over. Final results will be published soon!" (once the results are published it says the final results are in) with a link to the scoreboard. Both remain available until the admin deletes the data.
- Admin can score (so the scoreboard can still change after the game ends), until the final results are published
- Admin can publish the final results, only once now > game-end, and can return them to provisional (see "Publishing the final results")
- As soon as the game is over (now > game-end) the 'play' button on the view page becomes a 'results' button, whether or not the final results have been published yet (the results page says they are not ready until they are). Once they are published, players can see their results
- Admin can delete all player data (names, answers, scores). This also returns the results to provisional.
- Admin can configure/edit game. Saving the configuration also returns the results to provisional.

## Personas

The are 3 distinct users for the website:
1. Admin - Single person that creates/edits and manages the game. The admin may also be a player, for testing purposes.
2. Players - Individuals that join and play the game (i.e. submit answers). One team plays on one device.
3. Viewers - view the game scoreboard only

## Game Play

The game is played in the real world, while the website facilitates timing, questions, answers and scoring.
Game data is a game-questions.json file plus map images, stored per event (see "Events" and "game-questions.json format" below).
The game zones, questions and maps are uploaded by the admin on the events page; nothing needs a code change or a deploy.
Each zone will have:
- zone-name (string): e.g. "Southside"
- zone-map (image): png or jpeg format (the Google Maps images in docs/game-zones are approved for use)
- questions to answer (5 in the default game; any number is supported), which include its photo challenges: none, one or several. A photo challenge is a question of type "photo": its text describes what needs to be captured in the photo (which must be submitted via whatsapp), and it has a score (number) but no answer

### Joining

Players click 'join' to enter the game. They must enter a "team name" (unless team names are turned off, see below), and the website will allocate them a unique team number (small integer starting at 1, shared & visible) and a unique player-id (random, hidden). The player can then reference their team number when submitting photos.
The form for joining has 1 input field "Enter Team Name:" (only when team names are on), plus a field "Code to join the game:" only when the admin has set a join code (see "Join code"). With team names off and no join code the form is just a join button.
One join = one team = one device. There is no second device, no per-player scoring, and no way to recover a lost session (see "Parked").
Team name rules: unique (ignoring upper/lower case), 1 to 30 characters, and rejected if it fails a basic profanity filter (the team names are shown publicly, to children).

### Team names on or off

The game configuration has a setting "team names", on by default. With it on, everything works as described elsewhere.
- **Off**: the join form does not ask for a name, and no name is stored or checked (the name rules, the profanity filter and "name taken" do not apply). A team is shown as "Team <number>" everywhere: on the scoreboard, in the play page heading (the number only), on the results page, and in the admin pages (team list, scoring, confirmations).
- It is part of the configuration, so it is set before the game starts and cannot be changed while the game is active. If it is changed while teams exist, the names they already have are kept in the data and what is shown follows the current setting.
- The load test needs team names on (it recognises its own teams by name) and refuses to run when they are off.
As there is no login or authentication, a simple web session mechanism must be used to remember the player has joined, and to link player data to their player-id.

Once a player has joined:
- the 'join' button is no longer displayed on the view page.
- the 'play' link should be displayed instead of the join button. The play link links to the play page. As soon as the game is over (now > game-end) the 'play' button becomes a 'results' button that links to the results page, even before the final results are published: until then the results page tells the player the results are not ready yet.
- the view page does not display the player's team name (their own row in the scoreboard is highlighted instead).

### Scoreboard

Under the join/play/results button, the scoreboard should be displayed. Immediately above the scoreboard, the exact text "provisional results:" (lower case, with the colon) should be displayed, until the final results are confirmed and published. Once the results are confirmed, "provisional" should be changed to "final" ("final results:"). The heading is only shown above the scoreboard table: it is not shown while there are no teams.
The scoreboard should auto-refresh every 5 seconds, to include latest score totals and latest list of teams.
The scoreboard must be sorted by score (descending order), then team name (alphabetically), or by team number when team names are off.
The scoreboard is a simple table with 4 columns, optimised for mobile display, headed in lower case:
- **rank**: the team's place, as a plain number (1, 2, 3, not 1st, 2nd). Teams with the same score share a place (1, 1, 3), exactly as on the results page.
- **name**: the team name, or "Team <number>" when team names are off.
- **done**: how many questions and photo challenges the team has attempted over how many there are in the whole game, e.g. "5/30" (the total counts every question and every photo challenge in every zone). Answering a question or sending a photo counts whether it is right or not, so this says nothing about correctness. A team that has done nothing shows "0/30".
- **score**: the team's total score, shown as now (whole number, or one decimal place only when needed).
The scoreboard does not show team numbers (a team sees its own on its play page).
The player's own team row is highlighted.
Scores are shown as whole numbers, and with 1 decimal place only when a total needs it (e.g. 12.5).

### Play page

The play page works as follows:
- team name is displayed at the top, with the team number displayed large and clear (e.g. "Team 7"), because players need it for whatsapp photos. Team number and Team name should be displayed on a single line (wrapping as needed). Different text sizing and colouring should be used to make the distinction between name and number: the number ("Team 7") large, bold and in the site's blue; the name smaller and dark grey, sitting on the same baseline. A name of up to 30 characters with no spaces must still fit a phone screen. When team names are off only the number ("Team 7") is shown.
- a 'view scoreboard' link is displayed below team name, which links back to the view page.
- once the final results are published, a link to the results page is also shown (the same 'results' button as on the view page).

Under the 'view scoreboard' link, display small tiles using the zone names and zone map images. Each tile shows the player's progress in that zone, e.g. "3/6 done" (questions plus the photo challenges; a zone may have several photo challenges or none).
clicking a zone tile should display individual forms to submit answers to each of the questions for that zone.
Players must also be able to view full size zone-map, and close it, returning to the zone questions.
Players must also be able to return to the play page, where they can again select any of the zone tiles, or click the 'view scoreboard' link.
When a correct answer is submitted, the team score total should be updated, which will then be visible on the next auto refresh for the score board.
Each photo challenge has its own form, which displays the description along with a button named 'photo sent to whatsapp'. A zone with no photo challenge has none. 
Each question and photo challenge can be submitted only once, so the form should be disabled (and visibly marked as done) when submitted.
A form is marked done only after the server has confirmed the submission. If the network fails the player can try again; if the same form is somehow sent twice, the first one received counts.

### Join code

The admin can set an optional code to join the game, so that only people at the event can join: the code is told to the players in person (never posted online), and anyone without it is refused.
- **Optional**: with no code set, joining works exactly as before and the join form has no code field.
- **Format**: 5 to 12 letters and digits. The admin chooses it. Case, spaces and dashes are ignored when it is typed (so "surf-24A" and "SURF24a" are the same code), like the admin passcode. Any other character is refused when the configuration is saved. An empty field means no code.
- **Joining with a code set**: the join form asks for the code as well as the team name. A wrong or missing code is refused with a clear message ("That code is not right") and nothing is created: the team name is not used up, and the form keeps what was typed. A correct code joins as usual.
- **Who needs it**: only a new team joining. A browser that has already joined is not asked again (it keeps its team, as today), and nobody has to enter it to view the scoreboard. A team the admin removes has to enter the code to join again. Joining stays possible during the game (a late team needs the code too).
- **Secrecy**: the code is a shared secret, not a password. It is kept with the game configuration and is shown only to the admin (on the configuration page, so it can be read out). Public information (the game and scoreboard) says only WHETHER a code is needed, never the code itself, and no public response contains it (a test scans for it). It is part of the configuration, so it is set before the game starts and, like the rest of the configuration, cannot be changed while the game is active.
- **Guessing**: there is no lockout (a lockout would let someone remote stop real players joining). At 5 or more letters and digits the code cannot realistically be guessed at the API's request limit.
- **Load test**: the load test reads the code through its admin session and uses it to join its test teams, so it needs nothing extra.
- Saving a new configuration with a different code does not affect teams that have already joined.

### WhatsApp group link

When the admin has set a WhatsApp group link in the game configuration, the places that mention WhatsApp link straight to the group (opening in a new tab). When no link is set they stay plain text, exactly as before.
- **On the play page, for each photo challenge**: the word "WhatsApp" in the challenge description is a link, and an **Open WhatsApp group** button sits under the description. The existing **Photo sent to WhatsApp** button is unchanged: it records the submission and is not a link.
- **In the instructions** (the Instructions panel on the play page): the word "WhatsApp" in the text is a link. (Every occurrence of the word "WhatsApp", in any capitalisation, in the photo challenge descriptions and the instructions is turned into a link: nothing needs to be marked up in `game-questions.json` or `player-instructions.md`.)
- **On the scoring page** (admin): the mention of the WhatsApp group in the help text is a link.
- **Who sees it**: a group invite link works like a key, so it is only given to a browser with a team session (and to the admin). It is not in the public game or scoreboard information, and a spectator never receives it.
- The link is part of the game configuration, so it is saved with it and covered by the same rules (not editable while the game is active).

### Answer rules

Every question has a type (see "game-questions.json format"): string, whole-number or decimal.
- After a submission the form shows "Done" only. Until the admin publishes the final results, the website NEVER displays what was submitted, and never says whether it was right or wrong, including after a reload or on another page. (This makes it harder for teams to share answers.) After the final results are published, a team's own results page shows its answers, which were right, and the official answers (see "Results page").
- string: the submitted text is trimmed, converted to lower case and compared with each accepted answer. Small typos are accepted: none for answers under 4 characters, 1 typo for 4 to 7 characters, 2 typos for 8 or more characters (typo = one added, missing or changed letter, or two neighbouring letters swapped).
- whole-number: the field accepts digits only (numeric keypad on phones). The value must match exactly.
- decimal: the field accepts digits and a single decimal point. The value must match exactly as a number (2.50 and 2.5 are the same value).
- Negative numbers are not supported.
- Photo challenges have no automatic checking: see the game-score page.

### game-questions.json format

Zones are keyed "zone 1", "zone 2", ... Each zone has: zone-name, zone-map (the image file in the event's game-zones folder) and a list of questions. A photo challenge is one of the questions, with the type "photo": a zone may have none, one or several, in any position in the list. Each question has:
- "Q1", "Q2", ... : the question text, or for a photo challenge the description of what to photograph (the key is the question's id within the zone)
- "type" : "string", "whole-number", "decimal" or "photo"
- "answer" : for whole-number and decimal, a single value as a string, e.g. "42" or "2.5". For string, either one answer, e.g. "paris", or a list of accepted answers, e.g. ["bike", "bicycle"] (each one gets the same typo tolerance). Write answers in lower case. A photo challenge has no answer (the admin scores the photo).
- "score" : points for a correct answer, or for a photo challenge its full points (a number)

## General Requirements
The site must be open to the public, so anyone can; view the live scoreboard, join the game and play the game. No authentication or account creation is required. 

### Status line

The play and view pages show the status text and the countdown ("Time left" and the count down, or "Game starts in" and the count down before the game) on a single line, wrapping on a narrow screen only if it must. "Game over" and "Coming soon" (no game configured) have no countdown.

The view page does not show the player's team name above the scoreboard (see "Joining"), and the play page shows the team number and name on one line (see "Play page").

## Admin Requirements

### Admin passcode

There is one admin and no accounts. The admin pages and every admin API call (`/api/admin/*`: configuration, teams, scoring, publishing, export, delete) require the admin passcode. The pages themselves stay ordinary public files that contain nothing secret; they show a login form first.
- **The passcode** is random, generated on the admin's own computer by a script that also prints its one-way hash. Only the hash is stored: as a sensitive HCP Terraform variable (`admin_passcode_hash`) handed to the admin function. The passcode itself is never in the repo, in AWS or in GitHub, except where the admin chooses to store it as the GitHub secret the load test needs (see "Load test").
- **Logging in** asks for the passcode once and starts a session of 12 hours, kept in a cookie that page scripts cannot read (HttpOnly, Secure, SameSite=Strict, only sent to the admin API). The session is signed with the stored hash, so changing the passcode ends every session. There is a log out button, and an expired session asks for the passcode again.
- **Without a valid session** every admin call is refused with 401 `not-authenticated`, whatever it is (including the data export).
- **Guessing is limited**: at most 10 failed logins in any 5 minutes, counted across everybody. After that logins are refused until the window has passed. (Someone could therefore block the admin for a few minutes, but not guess the passcode.)
- **Not set**: if the hash variable is empty, the admin pages and API stay open (this is how a new deployment starts), and the deploy's smoke test prints a warning saying so. Setting the variable and applying Terraform switches the passcode on.
- **Changing or recovering it**: generate a new passcode and hash, update the variable, apply.
- The admin pages are still not linked from anywhere and are marked noindex.

Remaining accepted risk: the repository is public, so the names of the admin pages and the example game in `docs/` are readable by anyone; the passcode protects what the admin pages can do. A real game's questions and answers are in the private events bucket.

page: <cloudfront_url>/game-config/

Admins use this page to choose the active event and edit its config:
event (choice): the stored event to make live; the fields below are filled in from it and saved back to it (see "Events").
game-name (string): default = "Sorrento Youth Scavenger Hunt"
game-timezone (timezone): Australian time zone dropdown; default = AWST Australian Western Standard Time (UTC + 8)
game-day (date): yyyy-mm-dd
game-start (datetime): <game-day> hh:mm:00
game-end (datetime): <game-day> hh:mm:00   (must be > game-start)
join-code (optional): the code a new team must enter to join (see "Join code"), 5 to 12 letters and digits, shown to the admin on the page; empty means no code.
team-names (on/off): whether teams have names; on by default (see "Team names on or off").
whatsapp-link (optional): the invite link of the WhatsApp group the teams send photos to, e.g. https://chat.whatsapp.com/AbCdEf123. Only links of that form are accepted. Leave it empty and everything simply says "WhatsApp" as plain text, as before. The page has a "Test link" next to the field.
Saving the config also loads the zones, questions and maps of the chosen event (see above). It is not possible while the game is active, so the join code and the WhatsApp link are also set (and the link tested) before the game starts. Choosing a different event is refused while any player data exists.

The page also lists the teams, with a 'remove' button for each (with confirmation), for moderating team names. Removing a team deletes its data. This is allowed at any time, including while the game is active.

Admins should also be able to delete all player data from a previous game. This is allowed before the game starts and after it ends, never while it is active. The data (teams, team numbers, submissions, scores) must first be downloaded as a single json file; the form should ask for confirmation before deleting the data. once confirmed, the data should be deleted, so that the next upcoming game has no players and no scores, and team numbers start again at 1.

### Publishing the final results

A separate form on this page (not part of the configuration form) lets the admin confirm that every score has been applied and publish the final results.
- It is not possible to publish until now > game-end (the server refuses; the form is disabled with a note while the game is not over).
- The form shows how many photo submissions have not been scored yet. The admin must tick "I have applied all scores" to publish. Any photo that was submitted but never scored counts as 0% (and the form says so).
- Publishing: the scoreboard's heading changes from "provisional results:" to "final results:", the play page's message changes, and the results page shows each team its results (the 'results' button is already there from the end of the game).
- A "Return to provisional" button reverses it (for a mistake or a late correction): the scoreboard goes back to "provisional results:", the results page goes back to "not ready yet", and the play page's message goes back to "Final results will be published soon" (the 'results' button stays, because the game is still over).
- While the results are published, scores can not be changed: the scoring page says so and Apply is disabled. To correct a score, return to provisional first. Removing a team is still possible (and changes the places).
- Deleting all player data, or saving the game configuration, returns the results to provisional.

page: <cloudfront_url>/game-score/

This page enables the admin to confirm and apply the score for any photo challenge forms that have been submitted on the play page.
The admin will need to manually cross check the game-score page with the whatsapp group, to determine if a photo has actually been uploaded, and that it does meet the challenge criteria.
Team members must include their team number in the whatsapp message, and the photo must make it obvious which zone and challenge it is for. If it is not obvious, or there is no team number, or the player never pressed the 'photo sent to whatsapp' button, no score is awarded. There is no manual entry of photos or scores for missing submissions.

This page should dynamically list the photo challenges that have been submitted, in the order that they are sent (it refreshes automatically every 5 seconds).
Each submission should be listed on a single line that displays:
- Team number (or the team's name too, when team names are on)
- zone name
- the photo challenge (its description)
- 'full' radio button to award 100% of score, as defined in game-questions.json 
- 'half' radio button to award 50% of score, as defined in game-questions.json (not rounded: it can be a decimal)
- 'zero' radio button to award 0 
- 'apply' button to record the score decision. Clicking this should update the score total for the relevant player/team, and move the line to the bottom of the table.
Each line carries the team's internal id as a hidden form field, so the decision is always applied to the correct team. The id itself is not displayed.
No radio button is selected by default, and 'apply' stays disabled until one is chosen, so a decision is always deliberate.

It should be possible to re-select a different radio button for a line that has already been applied, so that the score can be corrected if necessary. Correcting a score, by re-applying will require the previous apply to be deducted, before the latest decision is applied. It should not be possible to increase a players score by accidentally apply multiple decisions for the same photo challenge. 
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
- For each photo challenge in each zone: the percentage awarded and the points ("Full: 100% - 30 of 30 points", "Half: 50%", "Zero: 0%"), or clearly "No photo submitted". A photo that was submitted but never scored shows 0% and says it was not scored.

Before the results are published (including during the game) the page tells a player the results are not ready yet and shows only the link back to the scoreboard; nothing about the answers is sent to the browser. A viewer (no team session, or a removed team) always sees only the link back to the scoreboard. Like all pages it is mobile first and must fit a phone.

### Instructions

The game instructions must be displayed at the top of the play page.
The heading "Instructions (tap to show/hide)" must be visible at all times.
The instructions content should be hidden by default, but then revealed/hidden as the player taps the heading.

Instructions content belongs to the event (see "Events"): it is the event's `player-instructions.md`, plain Markdown (headings, bullet lists, bold and italic text, paragraphs). It is stored with the event, copied into the live game when the event is activated, and shown on the play page. There is no code change or deploy to change it.
- Everything in the file is shown as text: raw HTML or links written in it are never run or followed, and the page renders the Markdown itself with a small safe renderer (no HTML is ever built from the text). The word "WhatsApp" is linked as described in "WhatsApp group link".
- The file is at most 20 KB, valid text, and optional: an event without it has no Instructions panel on the play page.
- The instructions are public information, like the rest of the game's name and zones: they are part of the game information the page asks for, visible before the game starts (as today), not only to teams.
- `docs/player-instructions.md` stays as an example of the format; nothing in the live game reads it.

## Viewer Requirements

Anyone who goes to the main landing page (join button and scoreboard), and chooses not to click join, is considered a viewer.

Viewers should only ever see the main landing page (unless they click join, to become a player). If a viewer opens the results page they see only the link back to the scoreboard.

page: <cloudfront_url>/view/

## Operations

### Request limits and cost

The API accepts 50 requests a second sustained with a burst of 200 (API Gateway stage throttling, `api_throttle_rate_limit` / `api_throttle_burst_limit`). The scoreboard and game state are served from CloudFront's cache and do not count against the limit; a real game peaks at roughly 15 to 25 requests a second reaching the API.
- **Budget**: the owner runs at most two real games a month, so at most about 5 hours of play a month, and accepts a month of that costing less than $2. Counting API Gateway, Lambda, DynamoDB and CloudFront, a request costs roughly $2 to $3 per million before the free tiers, so 5 hours flat out at 50 a second (about 0.9 million requests) is about the $2 line, and a higher sustained limit would break it. The sustained limit therefore stays at 50; only the burst is raised, because a burst absorbs the moment everyone loads the game at the start without raising the worst-case hourly cost.
- **Cost alarm**: there is deliberately none in this repository. The account-wide monthly budget in the `surf-club-signin` repository (no cost filter, so it covers this site; alerts at 80% actual, 80% forecast and 100% actual of its monthly budget) is the alarm.

### Load test

A GitHub Actions workflow, started by hand from the Actions tab (never on a schedule), that simulates a crowd against the live site and produces a detailed report, so the owner can see where the limits are.
- **Inputs**: number of teams, number of spectators, duration, ramp-up time, how often a team answers, and a mode ("full", which needs the game to be in progress with team names on, or "spectators only", which works any time).
- **What it simulates**: teams join, refresh the way the real pages do, answer questions and send photos; spectators refresh the scoreboard. It goes through the site's public address only; it needs no AWS credentials for the load itself.
- **Report** (a summary in the job log, plus an HTML report with charts and the raw JSON as downloadable artifacts): per endpoint the requests, the status codes (429 means throttled, 5xx a failure) and the latency (typical, 95th and 99th percentile, worst); throughput over time; when errors began and at what request rate; CloudFront cache hit rate; whether the machine generating the load was itself the bottleneck; server-side numbers from CloudWatch (API Gateway, Lambda throttles and concurrency, DynamoDB throttling); an estimated cost for the run; and a plain verdict.
- **Guardrails**: it refuses to run if any real team exists (test teams are named `loadtest-001` and so on), and refuses sizes above 300 teams, 1,500 spectators or 15 minutes. It never changes the game configuration: the admin sets up a joinable demo game first (team names on). If a join code is set it reads the code through its admin session and uses it to join its test teams; it refuses to run when team names are off. It does not run at the same time as a deploy.
- **Clean up**: it removes its own test teams using the admin passcode, which the admin stores as the GitHub secret `ADMIN_PASSCODE` (the only place the plaintext passcode is kept besides the admin's password manager).
- **Reading CloudWatch** uses the deploy role's read-only permissions (it only works when the workflow runs from `main`).

As built: `.github/workflows/load-test.yml` runs `scripts/load-test.js` (code in `scripts/loadtest/`: `generator.js` the simulated users, `stats.js` the numbers, `verdict.js` the plain verdict, `cost.js`, `cloudwatch.js`, `report.js` the HTML and Markdown, `cli.js` the guards and clean-up). It refuses to start (exit 1, nothing sent) when the scoreboard is unreachable, the admin passcode is needed but missing or wrong, any non-`loadtest-` team exists, or (full mode) the game is not in progress; it removes leftover and its own `loadtest-` teams, concurrency 10, verifying afterwards (exit 3 if any remain). CloudWatch is read through the deploy role, which only works from `main`; otherwise the report has no server-side section. The deploy role has read-only `cloudwatch:GetMetricData`, `lambda:GetAccountSettings` and `apigateway:GET` for this. The load test's own tests are `npm run test:loadtest` (short real runs against a local site). They are not part of `npm test`: CI runs them as the separate check `Load test tool`, only when the tool or `api/` changes.

## Parked for later

- Restoring an old game: uploading the downloaded json file back into the website.
- Recovering a team's session after a cleared browser or a different phone (e.g. rejoin with team number and name).

## As built

Where the finished site is more specific than the text above (details settled while building; the code and `docs/api.md` are the reference):

- **Scoreboard**: four columns headed rank, name, done and score. rank is the place (teams on the same score share one: 1, 1, 3), done is `attempted/total` (questions and photo challenges, right or wrong), and there is no team number column; the player's own row is highlighted; scores show as whole numbers or with one decimal place only when needed. The server works out rank and done; `/api/scoreboard` sends `rank` and `done` for each team and `questionTotal` for the game.
- **Countdown**: "N min" until the last 5 minutes, then "m:ss"; before the start it counts to the start. It uses the server's clock. The status text and the countdown share one line on `/view/` and `/play/`.
- **Team line on `/play/`**: "Team 7" (large, bold, blue) and the name (smaller, dark grey) on one baseline; a name too long for the line wraps below the number. The view page shows no separate team name: the team's own row in the scoreboard is highlighted.
- **Statuses**: the game is `unconfigured`, `pre`, `active` or `post`; the end is inclusive and exact (no grace period).
- **Questions appear only while the game is active** (the API does not send them earlier or later).
- **Admin pages**: team removal asks for confirmation; deleting player data needs the download link used and the word "delete" typed, and is refused while the game is active. The scoring page identifies a team by hidden form fields (team number and zone); Apply is enabled only when scoring is open and the choice differs from what is recorded.
- **API status codes** avoid 403 and 404 for the API's own errors (CloudFront replaces those with the site's 404 page): wrong state is 409, unknown references 400.
- **Zone and question counts** are whatever the chosen event's `game-questions.json` holds when the admin saves the configuration (the zones are copied at that moment).
- **Maps** are made small by the admin's browser when an event is uploaded (a thumbnail and a full-size WebP where possible), and copied to the site when the event is made live.
- **After the game ends**: the Play button on `/view/` becomes Results at once (the local countdown notices the end, no reload needed); the play page says "The game is over. Final results will be published soon!" until the results are published, then "The game is over. The final results are in!"; the results page tells a team before publication that the results are not ready and will be published soon. The play page's own Results link appears only once published.
- **WhatsApp link**: stored in plain form (any tracking query removed) and given by `/api/me` to a team with a session only. The play page links every mention of "WhatsApp" in the photo challenge descriptions and the instructions (not inside buttons or existing links) and shows an **Open WhatsApp group** button under each photo challenge; the scoring page links its help text. A page ignores anything that is not a `https://chat.whatsapp.com/` address, even if the server sent it. The config page has a **Test link** beside the field.
- **Final results**: the admin form is on `/game-config/` ("Final results"): the publish button is disabled until the game is over and "I have applied all scores" is ticked, and shows how many photos are unscored; "Return to provisional" undoes it. While published, `/game-score/` is read-only. The scoreboard heading (`provisional results:` / `final results:`) sits directly above the table and is hidden while there are no teams. `/results/` shows a viewer, a removed team, or an unpublished game only the link back to the scoreboard (plus a note to a team before publication); nothing about answers is sent to the browser in those cases. Medals: 🥇 🥈 🥉 with an accessible label; teams that tie share a place and its medal. Official answers with alternatives are joined with "or".
- **Admin passcode**: both admin pages show only a login box until the passcode is entered (typing is forgiving: case, spaces and dashes are ignored), keep the admin in for 12 hours, offer **Log out**, and bring the login box back (with a message) if the session ends while a page is open, then carry on. With no passcode set they open at once and the smoke test warns. A mistake in the stored hash locks the admin rather than opening it. Only the hash is stored (HCP variable `admin_passcode_hash`).
- **Team names**: the box **Teams have names** on `/game-config/` (ticked by default and for any configuration saved before it existed). With it off the join form has no name field (the Join button joins), the server stores no name, and every name the API sends is `Team <number>`, so every page shows that without needing to know; the scoreboard orders teams on the same score by number. `game.teamNames` tells the pages whether to ask for a name and whether the play page shows one next to the number. The load test needs names on and refuses to run in full mode when they are off.
- **Join code**: the box **Code to join the game** on `/game-config/` (5 to 12 letters and digits; case, spaces and dashes are ignored; saved tidy in capitals and shown back to the admin only). `game.joinCodeRequired` is the only thing the public sees. `POST /api/join` checks the code first (400 `wrong-code`, nothing created), compared in constant time; a browser that already has a team is never asked. The join form shows the code field when one is needed (the only field when team names are off). The load test reads the code through its admin session, joins with it, and keeps it out of its report.
- **Events page** (`/game-events/`): lists the stored events (ready or incomplete, and which is active) with Replace, Download and Delete (after a confirmation; not for the active event), and uploads one: the admin chooses the event folder (or its files one by one) and names it (suggested from the folder). The page reads `game-questions.json`, finds each zone's map by the file name in `zone-map` (in any subfolder, any capitals), and refuses before uploading anything when a map is missing. It then uploads the questions (the server checks them first), the instructions, each map (shrunk in the browser to a 320 px thumbnail and a 1400 px picture, WebP where the browser can make it) and finally the settings file. A failure part way leaves the event listed as incomplete, which cannot be activated; uploading again completes it. A bad settings file only warns.
- **Choosing an event**: on `/game-config/` the **Event** list shows the stored events (an incomplete one is greyed out); an event must be chosen to save. Choosing an event fills the form from its saved settings; saving makes it the live game (its questions, instructions and maps are copied in) and stores the settings back into the event. A different event is refused while teams exist (the page says to download and delete the player data first); the list is locked while the game is in progress. Players get the event's maps from `/event-maps/...` and its instructions as text from `/api/game`, drawn by a small safe Markdown renderer (headings, bullets, numbered lists, bold, italic; raw HTML, links and images stay plain text).
- **Not built (parked)**: restoring an old game from its download and recovering a lost session. See also "Accepted risk" above.

