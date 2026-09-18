/**
 * profiles —— 文档类型预设（按用途定制转 PDF 的地基）
 *
 * 当前阶段（P0）只落地骨架：内置 general 与 skill，并支持显式 --type 覆盖。
 * 后续（P1+）再逐步增加：jekyll / paper / gb / docs … 以及各自 defaults、编号方案、预处理。
 *
 * 识别原则（已确认）：
 *   1. 显式 --type 优先；
 *   2. 否则自动探测（文件名 + frontmatter 键特征）；
 *   3. 不支持在 frontmatter 里声明类型（避免历史遗留文档需要回填字段）。
 */

export const PROFILES = {
  general: {
    name: 'general',
    // fallback：不主动命中任何文档
    detect: () => false,
    // 无默认报头小标题（沿用 fm.kicker / fm.category）
    kicker: null,
    // 元信息条不按技能文档样式渲染
    skillMeta: false,
    // 不覆盖全局默认选项
    defaults: {},
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
export function detectProfile({ basename, fm, explicit }) {
  if (explicit) {
    const p = PROFILES[explicit];
    if (!p) {
      throw new Error('未知文档类型：' + explicit + '（可用：' + PROFILE_NAMES.join(', ') + '）');
    }
    return p;
  }
  for (const p of Object.values(PROFILES)) {
    if (p.detect && p.detect({ basename, fm })) return p;
  }
  return PROFILES.general;
}
