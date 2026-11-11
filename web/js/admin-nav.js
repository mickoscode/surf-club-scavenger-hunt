// The menu at the top of every admin page. The page you are on is marked as current. Built in the browser from one list, so a new
// admin page is added in one place.
import { $, el } from './dom.js';

const PAGES = [
  { href: '/game-teams/', label: 'Teams', testid: 'nav-teams' },
  { href: '/game-score/', label: 'Scoring', testid: 'nav-score' },
  { href: '/game-config/', label: 'Game', testid: 'nav-config' },
  { href: '/game-events/', label: 'Events', testid: 'nav-events' },
];

export function renderAdminNav() {
  const nav = $('admin-nav');
  nav.replaceChildren(...PAGES.map((page) => {
    const current = location.pathname === page.href;
    const link = el('a', { class: `nav-link py-1 px-2${current ? ' active' : ''}`, href: page.href, 'data-testid': page.testid }, page.label);
    if (current) link.setAttribute('aria-current', 'page');
    const item = el('li', { class: 'nav-item' });
    item.append(link);
    return item;
  }));
}
