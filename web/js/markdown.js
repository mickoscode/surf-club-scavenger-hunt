// A small, safe Markdown renderer for the player instructions (docs/requirements.md, "Instructions"): headings (#, ##, ...),
// bullet lists (- or *, nested by indenting), numbered lists, paragraphs, **bold** and *italic*. Nothing else is Markdown
// here: raw HTML, links and images are shown as the plain text they are, and the page is built only with createElement and
// textContent, so what the file says can never become markup or script.
//
// parseMarkdown(text) -> blocks, a plain structure (tested in Node); renderMarkdown(container, text) builds the page from it.

// "a **b** and *c*" -> [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' and ' }, { text: 'c', italic: true }]
export function parseInline(text) {
  const parts = [];
  const pattern = /\*\*([^*]+)\*\*|(?<![A-Za-z0-9])__([^_]+)__(?![A-Za-z0-9])|\*([^*\s][^*]*)\*|(?<![A-Za-z0-9])_([^_\s][^_]*)_(?![A-Za-z0-9])/g; // underscores only at word edges, so snake_case_name stays plain
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    const [, strong1, strong2, em1, em2] = match;
    if (strong1 ?? strong2) parts.push({ text: strong1 ?? strong2, bold: true });
    else parts.push({ text: em1 ?? em2, italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  // The open lists: [{ indent, list }]; an item indented further than the one before belongs to a list inside it.
  let stack = [];

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const item = BULLET.exec(line);
    if (line.trim() === '') { flush(); stack = []; continue; }
    if (heading) {
      flush(); stack = [];
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(heading[2]) });
    } else if (item) {
      flush();
      const indent = item[1].length;
      const ordered = /\d/.test(item[2]);
      while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
      const top = stack[stack.length - 1];
      if (!top || indent > top.indent) { // a new list, at the top or inside the last item
        const list = { type: 'list', ordered, items: [] };
        if (top) top.list.items[top.list.items.length - 1].children.push(list);
        else blocks.push(list);
        stack.push({ indent, list });
      }
      stack[stack.length - 1].list.items.push({ inline: parseInline(item[3]), children: [] });
    } else if (stack.length && /^\s+\S/.test(line)) { // a continuation line of the last list item
      const items = stack[stack.length - 1].list.items;
      const last = items[items.length - 1];
      last.inline = parseInline(`${last.inline.map((p) => (p.bold ? `**${p.text}**` : p.italic ? `*${p.text}*` : p.text)).join('')} ${line.trim()}`);
    } else {
      stack = [];
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

function inline(parent, parts) {
  for (const part of parts) {
    if (part.bold || part.italic) {
      const node = document.createElement(part.bold ? 'strong' : 'em');
      node.textContent = part.text;
      parent.append(node);
    } else {
      parent.append(document.createTextNode(part.text));
    }
  }
}

function buildList(list) {
  const ul = document.createElement(list.ordered ? 'ol' : 'ul');
  for (const item of list.items) {
    const li = document.createElement('li');
    inline(li, item.inline);
    for (const child of item.children) li.append(buildList(child));
    ul.append(li);
  }
  return ul;
}

// Replaces what is in `container` with the rendered text. Headings are small section headings (the page has its own h1).
export function renderMarkdown(container, text) {
  const nodes = parseMarkdown(text).map((block) => {
    if (block.type === 'list') return buildList(block);
    const node = document.createElement(block.type === 'heading' ? 'h2' : 'p');
    if (block.type === 'heading') node.className = 'h6 fw-bold mt-3';
    inline(node, block.inline);
    return node;
  });
  container.replaceChildren(...nodes);
}
