import {hasPaperAbstract} from './document-content.mjs';
/** Template selection: explicit selection, then GB/skill metadata, then author plus explicit abstract. */

export const PROFILES = {
  general: {
    name: 'general',
    // fallback：不主动命中任何文档
    detect: () => false,
    // 无默认报头小标题（沿用 category 或 Markdown kicker 块）
    kicker: null,
    // 元信息条不按技能文档样式渲染
    skillMeta: false,
    defaults: { numberScheme: 'cjk' },
  },


  skill: {
    name: 'skill',
    // 沿用原有 isSkill 判定：SKILL.md，或 frontmatter 含 name
    // 注意：不改成「name 且 description」，否则只写 name 的历史技能文件会被漏判
    detect: ({ basename, fm }) => basename === 'SKILL.md' || !!fm.name,
    kicker: '技能文档',
    skillMeta: true,
    defaults: {},
  },

  paper: {
    name: 'paper',
    // Explicit abstract plus author metadata; keywords are shared by all templates.
    detect: ({ fm, body }) => !!(fm.author?.trim?.() || fm.authors?.some(a=>a?.name?.trim?.())) && hasPaperAbstract(body),
    kicker: null,
    skillMeta: false,
    // 作者及单位报头；摘要、关键词来自 Markdown 内容角色
    paperHeader: true,
    defaults: {},
  },

  gb: {
    name: 'gb',
    // GB 国标：frontmatter 含「标准号」或 standard
    detect: ({ fm }) => !!(fm['标准号'] || fm.standard),
    kicker: null,
    skillMeta: false,
    // 启用封面 + 页眉 + GB 专用编号
    gbDoc: true,
    defaults: {
      theme: 'gb',
      numberScheme: 'gb',
      numbering: 'force',
      lead: false,     // GB 正文不用导语
      toc: true,       // GB 通常有目次
      // E.1/E.2：五号书眉顶 25 mm、书眉下空 5 mm；正文镜像边距由 gb.css 命名页设置。
      fontSize: 10.5, marginTop: 33.70417, marginBottom: 27, marginLeft: 25, marginRight: 20,
    },
  },
};

export const PROFILE_NAMES = Object.keys(PROFILES);

/**
 * 判定文档类型。
 * @param {object} args
 * @param {string} args.basename 文件名（含扩展名）
 * @param {object} args.fm       frontmatter 键值对
 * @param {string} [args.explicit]  --type 显式指定；为空则自动探测
 * @returns {object} profile
 * @throws  显式指定未知类型时抛错（与 --theme 的处理风格一致）
 */
export function detectProfile({ basename, fm, explicit, body = '' }) {
  if (explicit) {
    const p = PROFILES[explicit];
    if (!p) {
      throw new Error('未知文档类型：' + explicit + '（可用：' + PROFILE_NAMES.join(', ') + '）');
    }
    return p;
  }
  for (const p of ['gb','skill','paper'].map(name=>PROFILES[name])) {
    if (p.detect && p.detect({ basename, fm, body })) return p;
  }
  return PROFILES.general;
}
