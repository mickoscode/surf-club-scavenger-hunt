# Dress rehearsal checklist

Do this a week or two before the real game, on the real site, with **at least three real phones** (a mix of iPhone and Android if you can) and one laptop for the admin pages. The automated test `tests/browser/full-game.test.js` already runs this whole journey in a desktop browser on every change to the site; what only you can check is **real phones, real mobile data and real WhatsApp**.

Allow about 30 minutes. Tick as you go; write down anything odd.

## Before you start
- [ ] The event (real questions, photo challenges, maps and instructions) is uploaded on `/game-events/`, shows as **Ready**, and is chosen on `/game-config/` (`runbook.md`, sections 1 and 3)
- [ ] WhatsApp group exists with the helpers who will act as teams
- [ ] On the laptop: `/game-config/` and `/game-score/` ask for the admin passcode; log in on each (a wrong passcode is refused, the right one lets you in), and check **Log out** brings the login box back

## Set up a short test game
- [ ] `/game-config/`: day = today, start a few minutes from now, end 30 minutes later, correct time zone. **Save & Load Game**
- [ ] The page reports the right number of zones; status "before the game"
- [ ] Paste the WhatsApp group link, press **Test link** (it opens the right group on the laptop), **Save & Load Game**
- [ ] On a phone: open the site address (scan the QR code if you have one). It shows the scoreboard, a countdown to the start and a **Join** button

## Joining (before the start)
- [ ] Each phone joins with a different team name; the **Play** button replaces the Join button and the team's own row in the scoreboard is highlighted
- [ ] A name already taken is refused with a clear message; an empty name too
- [ ] (If you will use a join code: set one in `/game-config/` and press **Save & Load Game**; the join form on a phone now also asks for the **Join Code:** first, then **Name for Your Team:**; a wrong code is refused with a clear message and the name stays typed; the right one, in any capitals, joins; a phone that has already joined is not asked again)
- [ ] (If you will run the game with team names off: untick **Enable custom team names**, press **Save & Load Game**, and check the Join button joins at once and every team is shown as "Team 1", "Team 2"... on the scoreboard, the play page and the results)
- [ ] Close the browser completely and reopen the site: still joined
- [ ] The scoreboard on every phone shows all teams, updating within about 5 seconds
- [ ] `/game-config/` lists the teams; remove one, confirm it disappears everywhere, and that the phone goes back to being able to join

## Playing (after the start)
- [ ] On the play page the team number (large, blue) and the team name sit on one line; "Time left" and the countdown share one line on every page that shows them
- [ ] When the countdown reaches zero the zone tiles appear on the play page within about 10 seconds (no reload needed)
- [ ] At a photo challenge, **Open WhatsApp group** opens the group in WhatsApp on the phone, and the word "WhatsApp" in the challenge and in the instructions does too; a spectator's phone (not joined) shows no WhatsApp links anywhere
- [ ] Every zone's map thumbnail loads on mobile data; tapping a map shows it full size and **Close** returns to the questions
- [ ] The instructions are hidden until the heading is tapped
- [ ] Answer a text question (try a small typo and a capital letter), a whole-number question (the number keypad appears; letters are not accepted) and a decimal question
- [ ] After submitting, the form shows **Done** and nothing else; submitting a second time is not possible. Reload the page: still Done
- [ ] The team's score on the scoreboard goes up for a correct answer and does not for a wrong one (but both show Done)
- [ ] Press **Photo sent to WhatsApp** and really send a photo with the team number to the WhatsApp group
- [ ] The countdown matches the end time you set (the game ends exactly then)

## Checking on a team (admin)
- [ ] `/game-teams/` shows the same scoreboard as the phones, updating by itself; tap a team: its answers appear as that team will see them later (right and wrong marked, official answers shown), and a new answer from its phone appears within a few seconds
- [ ] Each admin page has the menu at the top (Teams, Scoring, Game, Events) and it takes you to the other pages

## Scoring (admin)
- [ ] `/game-score/` lists the photos in the order they were pressed; match them with WhatsApp
- [ ] Apply Full to one, Half to another; check the scoreboard (Half shows a decimal if the points are odd)
- [ ] Change one decision and apply again: the score is **replaced**, not added to
- [ ] During the game the configuration page is locked; after the end it unlocks

## After the end
- [ ] Teams' play pages say "The game is over. Final results will be published soon!" and refuse answers; the **Play** button on the scoreboard page has turned into **Results** (without reloading), and a team that taps it is told the results are not ready; the scoreboard stays
- [ ] You can still score photos
- [ ] `/game-config/`, Final results: it counts the photos not scored yet; the publish button stays disabled until "I have applied all scores" is ticked
- [ ] Publish. The scoreboard heading changes from "provisional results:" to "final results:" on every phone, the play page says the final results are in, and each team's **Results** button now shows its results
- [ ] Each team's results page: the place ("You finished 2nd of 3", a medal for 1st to 3rd), its total, every question with its own answer, right or wrong, and the official answer, and the photo percentages (try one team that sent no photo and one whose photo you never scored)
- [ ] Someone who is not a team (a spectator's phone) opening the results address sees only the link back to the scoreboard
- [ ] The scoring page is locked while published; **Return to provisional** unlocks it and the scoreboard says "provisional results:" again
- [ ] `/game-config/`: **Download the player data** if you want to keep it (open the file: teams, answers and scores are in it), type `delete`, delete
- [ ] The scoreboard is empty and says nothing about final results; the next team to join is **Team 1**

## Then the real game
- [ ] Set up the real game (`runbook.md`, section 3). Remember: if you changed questions after the rehearsal's **Save & Load Game**, **Save & Load Game again**
- [ ] Check once more that the status reads "before the game" and no teams are listed

Anything that went wrong or looked confusing on a phone is worth fixing before the real day: note it and raise it.
