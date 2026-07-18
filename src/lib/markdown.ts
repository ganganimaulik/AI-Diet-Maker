// Markdown rendering + diet-plan splitting helpers for the output panel.

export const getPart1AndPart2 = (md: string) => {
  if (!md) return { part1: '', part2: '' };

  // Find where PART 2 starts
  const splitRegex = /(?:###?\s*)?PART\s*2:\s*FOR\s*MY\s*COOK[^\n]*/i;
  const match = md.match(splitRegex);

  if (match && match.index !== undefined) {
    const part1 = md.substring(0, match.index).trim();
    let part2 = md.substring(match.index + match[0].length).trim();

    // Clean up leading horizontal rule if present
    if (part2.startsWith('---')) {
      part2 = part2.substring(3).trim();
    }

    // Clean up trailing horizontal rule from part1
    let cleanedPart1 = part1;
    if (cleanedPart1.endsWith('---')) {
      cleanedPart1 = cleanedPart1.substring(0, cleanedPart1.length - 3).trim();
    }

    return { part1: cleanedPart1, part2 };
  }

  // Fallback: split by last horizontal rule
  const sections = md.split('---');
  if (sections.length > 1) {
    const part2 = sections[sections.length - 1].trim();
    const part1 = sections.slice(0, sections.length - 1).join('---').trim();
    return { part1, part2 };
  }

  return { part1: md, part2: '' };
};

export const getCookPlanOnly = (md: string) => {
  return getPart1AndPart2(md).part2;
};

export const renderMarkdown = (md: string) => {
  if (!md) return '';

  const { part1 } = getPart1AndPart2(md);
  const lines = part1.split('\n');
  const html: string[] = [];
  let inList = false;
  let inTable = false;
  let tableRows: string[] = [];

  const parseInline = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 0.1rem 0.35rem; border-radius: 4px; font-family: monospace;">$1</code>');
  };

  const renderTable = (rows: string[]) => {
    if (rows.length === 0) return '';
    const tHtml = ['<table>'];
    let hasHeader = false;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row.includes('---') && r === 1) continue;

      const cells = row
        .split('|')
        .map(c => c.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      if (r === 0) {
        tHtml.push('<thead><tr>');
        cells.forEach(cell => tHtml.push(`<th>${parseInline(cell)}</th>`));
        tHtml.push('</tr></thead><tbody>');
        hasHeader = true;
      } else {
        tHtml.push('<tr>');
        cells.forEach(cell => tHtml.push(`<td>${parseInline(cell)}</td>`));
        tHtml.push('</tr>');
      }
    }
    if (hasHeader) tHtml.push('</tbody>');
    tHtml.push('</table>');
    return tHtml.join('\n');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      if (inList) { html.push('</ul>'); inList = false; }
      if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${parseInline(line.substring(2))}</li>`);
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
      if (inList) { html.push('</ul>'); inList = false; }
      const headingContent = line.replace(/^\d+\.\s/, '');
      const num = line.match(/^(\d+)\.\s/)?.[1] || '1';
      html.push(`<h4 style="margin-top: 1.25rem; font-size: 1.05rem; font-weight: 700; color: #c084fc;">${num}. ${parseInline(headingContent)}</h4>`);
      continue;
    }

    if (line.startsWith('### ')) {
      if (inList) { html.push('</ul>'); inList = false; }
      if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
      html.push(`<h3>${parseInline(line.substring(4))}</h3>`);
      continue;
    }

    if (line.startsWith('## ')) {
      if (inList) { html.push('</ul>'); inList = false; }
      if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
      html.push(`<h2>${parseInline(line.substring(3))}</h2>`);
      continue;
    }

    if (line.startsWith('# ')) {
      if (inList) { html.push('</ul>'); inList = false; }
      if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
      html.push(`<h1>${parseInline(line.substring(2))}</h1>`);
      continue;
    }

    if (line.startsWith('|')) {
      if (inList) { html.push('</ul>'); inList = false; }
      inTable = true;
      tableRows.push(line);
      continue;
    }

    if (inList) { html.push('</ul>'); inList = false; }
    if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
    html.push(`<p style="margin-bottom: 0.5rem;">${parseInline(line)}</p>`);
  }

  if (inList) html.push('</ul>');
  if (inTable) html.push(renderTable(tableRows));

  return html.join('\n');
};

export function parseCookPlanDays(cookPlan: string) {
  if (!cookPlan) return [];

  const dayRegex = /###\s*(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)[^\n]*/i;
  const lines = cookPlan.split('\n');
  const days: { day: string, heading: string, content: string[] }[] = [];
  let currentDay: typeof days[0] | null = null;

  for (const line of lines) {
    const match = line.match(dayRegex);
    if (match) {
      const dayName = match[1].toUpperCase();
      currentDay = {
        day: dayName,
        heading: line.trim(),
        content: []
      };
      days.push(currentDay);
    } else if (currentDay) {
      currentDay.content.push(line);
    }
  }

  return days.map(d => ({
    day: d.day,
    heading: d.heading,
    content: d.content.join('\n').trim()
  })).filter(d => d.content.length > 0);
}
