const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const text = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function paperAuthorErrors(fm) {
  if (!owns(fm, 'authors') && !owns(fm, 'affiliations')) return [];
  const errors = [];
  const reject = (field, message) => errors.push({field, message});
  if (owns(fm, 'author') || owns(fm, 'affiliation')) reject('authors', 'authors／affiliations 不能与旧 author／affiliation 字段同时填写');
  for (const field of ['authors', 'affiliations']) {
    if (!Array.isArray(fm[field]) || !fm[field].length) reject(field, `${field} 必须为非空对象列表`);
  }
  if (errors.length) return errors;
  const ids = new Set();
  fm.affiliations.forEach((unit, index) => {
    const label = `affiliations 第 ${index + 1} 项`;
    if (!record(unit) || !text(unit.id) || !text(unit.text)) { reject('affiliations', `${label} 必须包含非空字符串 id 和 text`); return; }
    if (Object.keys(unit).some(key => !['id', 'text'].includes(key))) reject('affiliations', `${label} 只支持 id 和 text 字段`);
    if (ids.has(unit.id.trim())) reject('affiliations', `${label} 的 id 重复：${unit.id.trim()}`);
    ids.add(unit.id.trim());
  });
  fm.authors.forEach((author, index) => {
    const label = `authors 第 ${index + 1} 项`;
    if (!record(author) || !text(author.name)) { reject('authors', `${label} 必须包含非空字符串 name`); return; }
    if (Object.keys(author).some(key => !['name', 'affiliations', 'corresponding', 'email'].includes(key))) reject('authors', `${label} 含不支持的字段`);
    if (!Array.isArray(author.affiliations) || !author.affiliations.length || author.affiliations.some(id => !text(id))) {
      reject('authors', `${label} 的 affiliations 必须为非空单位 ID 字符串列表`);
    } else {
      const refs = author.affiliations.map(id => id.trim());
      if (new Set(refs).size !== refs.length) reject('authors', `${label} 重复引用同一单位`);
      for (const id of refs) if (!ids.has(id)) reject('authors', `${label} 引用了不存在的单位：${id}`);
    }
    if (owns(author, 'corresponding') && typeof author.corresponding !== 'boolean') reject('authors', `${label} 的 corresponding 必须为布尔值`);
    if (owns(author, 'email') && (!text(author.email) || !/^[^\s@]+@[^\s@]+$/.test(author.email))) reject('authors', `${label} 的 email 必须为有效邮箱字符串`);
  });
  return errors;
}

export function paperAuthorWarnings(fm) {
  if (!fm.authors || paperAuthorErrors(fm).length) return [];
  const used = new Set(fm.authors.flatMap(author => author.affiliations.map(id => id.trim())));
  return fm.affiliations.filter(unit => !used.has(unit.id.trim())).map(unit =>
    `单位“${unit.text.trim()}”（${unit.id.trim()}）未被任何作者引用，已在排版中隐藏`);
}

export function paperAuthorsHtml(fm, esc) {
  if (!fm.authors) {
    return fm.author || fm.affiliation
      ? '<p class="authors">' + (fm.author ? '<span class="author">' + esc(fm.author) + '</span>' : '') + (fm.affiliation ? '<span class="affil">' + esc(fm.affiliation) + '</span>' : '') + '</p>'
      : '';
  }
  const used = new Set(fm.authors.flatMap(author => author.affiliations.map(id => id.trim())));
  const units = fm.affiliations.filter(unit => used.has(unit.id.trim())).map((unit, index) => ({id: unit.id.trim(), text: unit.text.trim(), number: index + 1}));
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const firstRefs = new Set(fm.authors[0].affiliations.map(id => id.trim()));
  const showNumbers = fm.authors.some(author => author.affiliations.length !== firstRefs.size
    || author.affiliations.some(id => !firstRefs.has(id.trim())));
  const authors = fm.authors.map(author => {
    const refs = showNumbers ? author.affiliations.map(id => byId.get(id.trim())).sort((a,b) => a.number-b.number).map(unit => `<a href="#md2pdf-affiliation-${unit.number}">${unit.number}</a>`) : [];
    const marks = refs.join(',') + (author.corresponding ? '<a href="#md2pdf-correspondence">*</a>' : '');
    return '<span class="author author-entry">' + esc(author.name.trim()) + (marks ? '<sup class="author-mark">' + marks + '</sup>' : '') + '</span>';
  }).join(' ');
  const affiliations = units.map(unit => `<div class="affil" id="md2pdf-affiliation-${unit.number}">` + (showNumbers ? `<sup class="author-mark">${unit.number}</sup> ` : '') + esc(unit.text) + '</div>').join('');
  const contacts = fm.authors.filter(author => author.corresponding).map(author => esc(author.name.trim()) + (author.email ? `（<a href="mailto:${esc(author.email)}">${esc(author.email)}</a>）` : ''));
  const correspondence = contacts.length ? '<div class="correspondence" id="md2pdf-correspondence">* 通讯作者：' + contacts.join('；') + '</div>' : '';
  return '<div class="authors"><div class="author-list">' + authors + '</div>' + affiliations + correspondence + '</div>';
}
