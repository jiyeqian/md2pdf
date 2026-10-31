import { pinyin } from '../vendor/pinyin-pro/index.mjs';
import { parseGbParameters } from './gb-blocks.mjs';

const fail = message => { throw Object.assign(new Error(message), {status:400}); };
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const leading = value => value.trim().replace(/^[\s\p{P}]+/u, '');
const lexical = value => leading(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[\s\p{P}]/gu,'');
// Fixed natural-number comparison, independent of the host ICU/locale version.
function natural(a,b) {
  const left=a.match(/\d+|\D+/g)||[], right=b.match(/\d+|\D+/g)||[];
  for(let i=0;i<Math.min(left.length,right.length);i++) {
    let x=left[i],y=right[i],order;
    if(/^\d+$/.test(x)&&/^\d+$/.test(y)) {
      x=x.replace(/^0+(?=\d)/,'');y=y.replace(/^0+(?=\d)/,'');
      order=compare(x.length,y.length)||compare(x,y);
    } else order=compare(x,y);
    if(order)return order;
  }
  return compare(left.length,right.length);
}

export function parseGbIndex(text, label='') {
  if(label&&!/^[a-z]$/i.test(label))fail('gb-index 分组只支持单个英文字母');
  const rows=text.split('\n').map(line=>line.trim()).filter(Boolean);
  if(!rows.length)fail('gb-index 至少需要一个“关键词 | 位置”条目');
  return rows.map(line=>{
    const separator=line.indexOf('|');
    let term=separator<0?'':line.slice(0,separator).trim();
    const locations=separator<0?'':line.slice(separator+1).trim();
    let sortKey;
    const attribute=/\s*\{([^{}]*)\}$/.exec(term);
    if(attribute) {
      const params=parseGbParameters(attribute[1],['sort-key']);
      sortKey=params['sort-key'];
      if(!sortKey?.trim())fail('索引 sort-key 必须为非空字符串');
      term=term.slice(0,attribute.index).trim();
    }
    if(!term||!locations)fail('gb-index 条目必须为“关键词 | 章条、图表或附录位置”');
    return {term,locations,sortKey,forced:label.toUpperCase()};
  });
}

export function parseGbIndexSection(text) {
  const groups=[];let label=null,rows=[];
  for(const line of text.split('\n')) {
    if(label===null) {
      if(!line.trim())continue;
      const open=/^ {0,3}:::gb-index(?:[ \t]+([A-Za-z]))?[ \t]*$/.exec(line);
      if(!open)fail('gb-index-section 内仅支持 gb-index 分组');
      label=open[1]||'';rows=[];
    } else if(/^ {0,3}:::[ \t]*$/.test(line)) {
      groups.push(...parseGbIndex(rows.join('\n'),label));label=null;
    } else rows.push(line);
  }
  if(label!==null)fail('gb-index：块未闭合');
  if(!groups.length)fail('gb-index-section 至少需要一个 gb-index 分组');
  return groups;
}

export function groupGbIndex(entries,{lang='zh',sort='auto'}={}) {
  if(!['auto','input','pinyin','alphabetical'].includes(sort))fail('索引 sort 仅支持 auto、input、pinyin、alphabetical');
  const mode=sort==='auto'?(lang==='en'?'alphabetical':'pinyin'):sort;
  const merged=new Map();
  for(const entry of entries) {
    const previous=merged.get(entry.term);
    if(previous) {
      if(previous.forced&&entry.forced&&previous.forced!==entry.forced)fail('同名索引词条的强制字母冲突：'+entry.term);
      if(previous.sortKey&&entry.sortKey&&previous.sortKey!==entry.sortKey)fail('同名索引词条的 sort-key 冲突：'+entry.term);
      previous.forced ||= entry.forced;previous.sortKey ||= entry.sortKey;
      previous.refs.push(...entry.locations.split(/[,，、;；/]/).map(s=>s.trim()).filter(Boolean));
    } else merged.set(entry.term,{...entry,refs:entry.locations.split(/[,，、;；/]/).map(s=>s.trim()).filter(Boolean)});
  }
  const groups=new Map();
  for(const entry of merged.values()) {
    const raw=leading(entry.sortKey||entry.term);
    const usePinyin=mode==='pinyin'||(mode==='input'&&lang==='zh');
    const spelling=usePinyin?pinyin(raw,{toneType:'none',type:'array',v:true}).join(''):raw;
    const key=lexical(spelling);
    const letter=entry.forced||(/^[a-z]/i.test(key)?key[0].toUpperCase():'#');
    const item={...entry,locations:[...new Set(entry.refs)].join('，'),key,
      tones:usePinyin?pinyin(raw,{toneType:'num',type:'array',v:true}).join(''):''};
    if(!groups.has(letter))groups.set(letter,[]);
    groups.get(letter).push(item);
  }
  const output=[...groups];
  if(mode!=='input') {
    output.sort(([a],[b])=>a==='#'?1:b==='#'?-1:compare(a,b));
    for(const [,rows] of output) rows.sort((a,b)=>natural(a.key,b.key)||compare(a.tones,b.tones)||compare(a.term,b.term));
  }
  return output;
}
