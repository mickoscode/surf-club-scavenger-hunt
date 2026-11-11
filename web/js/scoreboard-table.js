// The rows of the scoreboard table, shared by the public scoreboard (/view/) and the admin's live scoreboard (/game-teams/) so
// the two are always the same: rank, name, done and score. Everything is put on the page as text. `nameCell(team)` may return
// the element for the name cell's content (the admin makes it a button); `isMine(team)` highlights the viewer's own row.
import { formatScore } from './format.js';

export function scoreboardRows(teams, questionTotal, { isMine = () => false, nameCell = null } = {}) {
  return teams.map((team) => {
    const row = document.createElement('tr');
    row.dataset.testid = 'scoreboard-row';
    row.dataset.teamNumber = String(team.number);
    row.dataset.score = String(team.score);
    row.dataset.rank = String(team.rank);
    row.dataset.done = String(team.done);
    row.dataset.total = String(questionTotal);
    if (isMine(team)) {
      row.dataset.mine = 'true';
      row.className = 'table-primary';
    }
    const cells = [
      [String(team.rank), 'text-muted'], // the team's place: teams on the same score share one
      [team.name, 'team-name', nameCell],
      [`${team.done}/${questionTotal}`, 'text-end text-nowrap'],
      [formatScore(team.score), 'text-end fw-semibold'],
    ];
    for (const [text, classes, build] of cells) {
      const cell = document.createElement('td');
      cell.className = classes;
      if (build) cell.append(build(team)); else cell.textContent = text; // text, never markup
      row.append(cell);
    }
    return row;
  });
}
