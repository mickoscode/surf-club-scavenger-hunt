# Overview

This website will be used to provide free scavenger hunt games. 
Only 1 game will exist at any time. So only 1 game can be in progress at any time. Most of the functionality will be provided by the website. But the game will also rely on a whatsapp group to simplify photo submissions and broadcast communications.

## Website Pages

The site will only ever be accessible via a free aws cloudfront domain. Players and viewers will be given the url via a QR code/link (managed separately via whats app). 

page: <cloudfront_url>/game-config/
Used by Admin to build game (edit config, create/edit zones, create/edit questions) and delete player data
page: <cloudfront_url>/game-score/
Used by Admin to set scores for photo questions (submitted bia separate whatsapp group). 
page: <cloudfront_url>/view/
Used by players to join
Used by players & viewers to view the live scoreboard
page: <cloudfront_url>/play/
Used by players to read instructions, select zone and answer questions

## Game Configuration & Management

The website will only ever have 1 game configured at any time.
The game must have a game-day (yyyy-mm-dd), game-start time (hh-mm), game-end time (hh-mm) and game-timezone (default = AWST).
The game is ACTIVE when current date = game-date AND current time >= game-start AND current-time <= game end (based on game-timezone)  
The game configuration can be edited by the admin at any time, EXCEPT when the game is active. Game configuration must also be editable at any time for the initial bootstrap setup.

game-name (string): default = "Sorrento Youth Scavenger Hunt"
game-timezone (timezone): default = AWST Australian Western Standard Time (UTC + 8)
game-day (date): yyyy-mm-dd
game-start (datetime): <game-day> hh:mm:00
game-end (datetime): <game-day> hh:mm:00   (must be > game-start)
is-game-active (calculation): true/false - this is calculated as needed (as defined above), not stored/configured

### Typical Timeline

Steps happen in the following order, but the time between steps will vary, depending on whether the game is being tested, or the real life game is being played. A single day (yyyy-mm-dd) could be used to start and end multiple games (for testing), but given only 1 can ever be configured, it follows that only 1 game can ever be ACTIVE at any time.

PRE-GAME:
- current date <= game-date AND current time < game-start (based on game-timezone)  
- Admin can configure/edit game 
   - this step can be repeated while game is NOT active.
- Players can join

GAME IS ACTIVE:
- current date = game-date AND current time >= game-start AND current-time <= game end (based on game-timezone)  
- Players can join
- Players can play
- Admin can score

POST-GAME
- current date >= game-date AND current time > game-end (based on game-timezone)  
- Players CANNOT join
- Players CANNOT play
- Admin can score
- Admin can delete all player data (names, answers, scores)
- Admin can configure/edit game 

## Personas

The are 3 distinct users for the website:
1. Admin - Single person that creates/edits and manages the game. The admin may also be a player, for testing purposes.
2. Players - Individuals that join and play the game (i.e. submit answers)
3. Viewers - view the game scoreboard only

## Game Play

The game is played in the real world, while the website facilitates timing, questions, answers and scoring.
Game data is managed in docs/game-questions.json.
The game zones, questions and maps are managed in the code repository. The admin edits the game data by submitting and merging a PR, and then a workflow updates the website. 
The admin will merge a PR to publish a game consisting of multiple zones.
Each zone will have:
- zone-name (string): e.g. "Southside"
- zone-map (image): png or jpeg format
- 5 questions to answer
- photo-challenge (string): description of what needs to be captured in the photo, which must be submitted via whatsapp

Players click 'join' to enter the game. They must enter a "team name", and the website will allocate them a unique team number (small integer, shared & visible) and a unique player-id (random, hidden). The player can then reference their team number when submitting photos.
The form for joining has only 1 input field "Enter Team Name:"
As there is no login or authentication, a simple web session mechanism must be used to remember the player has joined, and to link player data to their player-id.

Once a player has joined:
- the 'join' button should no longer be displayed on the view page.
- the 'play' link should be displayed instead of the join button. The play link links to the play page.
- the player's "team name" should be displayed below the play link.

Under the join button / team name, the scoreboard should be displayed.
The scoreboard should auto-refresh every 5 seconds, to include latest score totals and latest list of teams.
The scoreboard must be sorted by score (descending order), then team name (alphabetically).
The scoreboard is a simple table with 2 columns (team name, score), optimised for mobile display.

The play page works as follows:
- team name is displayed at the top
- a 'view scoreboard' link is displayed below team name, which links back to the view page.

Under the 'view scoreboard' link, display small tiles using the zone names and zone map images.
clicking a zone tile should display individual forms to submit answers to each of the questions for that zone.
Players must also be able to view full size zone-map, and close it, returning to the zone questions.
Players must also be able to return to the play page, where they can again select any of the zone tiles, or click the 'view scoreboard' link.
When a correct answer is submitted, the team score total should be updated, which will then be visible on the next auto refresh for the score board.
The Photo challenge form should display the description, along with a button named 'photo sent to whatsapp'. 
Each question and photo challenge can be submitted only once, so the form should be disabled (and visibly marked as done) when submitted.
Submitted answers should be converted to lower case, to compare against the official answer. Slightly mispelled answers should be accepted for strings, but only exact values should be accepted for numerical questions.
Numerical questions should only accept digits in the answer field.


## General Requirements
The site must be open to the public, so anyone can; view the live scoreboard, join the game and play the game. No authentication or account creation is required. 

## Admin Requirements

The admin pages will not be protected by authentication. Urls for these pages should not be shared.
page: <cloudfront_url>/game-config/

Admins use this page to edit config:
game-name (string): default = "Sorrento Youth Scavenger Hunt"
game-timezone (timezone): default = AWST Australian Western Standard Time (UTC + 8)
game-day (date): yyyy-mm-dd
game-start (datetime): <game-day> hh:mm:00
game-end (datetime): <game-day> hh:mm:00   (must be > game-start)

Admins should also be able to delete all player data from a previous game. The form for doing this should enable the data to be downloaded/uploaded as a single json file. The form should ask for confirmation before deleting the data. once confirmed, the data should be deleted, so that the next upcoming game has no players and no scores, etc.

page: <cloudfront_url>/game-score/

This page enables the admin to confirm and apply the score for any photo challenge forms that have been submitted on the play page.
The admin will need to manually cross check the game-score page with the whatsapp group, to determine if a photo has actually been uploaded, and that it does meet the challenge criteria.

This page should dynamically list the photo challenges that have been submitted, in the order that they are sent.
Each submission should be listed on a single line that displays:
- Team number
- zone name
- 'full' radio button to award 100% of score, as defined in game-questions.json 
- 'half' radio button to award 50% of score, as defined in game-questions.json
- 'zero' radio button to award 0 
- 'apply' button to record the score decision. Clicking this should update the score total for the relevant player/team, and move the line to the bottom of the table.

It should be possible to re-select a different radio button for a line that has already been applied, so that the score can be corrected if necessary. Correcting a score, by re-applying will require the previous apply to be deducted, before the latest decision is applied. It should not be possible to increase a players score by accidentally apply multiple decisions for the same zone photo challenge. 

## Player Requirements

page: <cloudfront_url>/view/
in addition to the display components described above, this page should display a live countdown of minutes remaining until the game-end.

page: <cloudfront_url>/play/
in addition to the display components described above, this page should display a live countdown of minutes remaining until the game-end.

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