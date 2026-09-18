/**
 * numbering —— 章节编号方案（P2）
 *
 * 与「行为维度」分开：
 *   行为（--numbering）：auto | force | none —— 是否编号、是否覆盖已有编号
 *   方案（--number-scheme）：arabic | gb | cjk | chapter —— 编号长什么样
 *
 * 说明：
 * - `gb` 与 `arabic` 在数值上一致（章条制：章 1、条 1.1、细分 1.1.1）；
 *   附录字母化（附录 A / A.1）与前言豁免属 GB profile（P3）范畴，本阶段不处理。
 */

// 1–99 的中文数字（章节编号够用；更大数值退回阿拉伯数字）
const CJK_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function cjkNum(n) {
  if (n < 1 || n > 99) return String(n);
  if (n < 10) return CJK_DIGITS[n];
  if (n === 10) return '十';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  // 11–19 读作「十一…十九」，不写「一十一…一十九」
  const head = tens === 1 ? '十' : CJK_DIGITS[tens] + '十';
  return ones === 0 ? head : head + CJK_DIGITS[ones];
}

export const NUMBER_SCHEMES = {
  // 1 / 1.1 / 1.1.1
  arabic: ({ counters, lvl }) => counters.slice(0, lvl + 1).join('.') + ' ',

  // 章条制（GB/T 1.1-2020）：章 1、条 1.1；前言/引言/目次/参考文献不编号；
  // 附录标题（「附录 A…」字母写在标题里）不自动编号，其下条用 A.1 / A.1.1。
  // 对象形态：skip(text) 决定「不编号且不占号」，fmt(...) 返回 null 表示「不加号」（保留原样）。
  gb: {
    skip: (t) => /^(前言|引言|目次|参考文献)\s*$/.test(t.trim()),
    fmt: ({ counters, lvl, text, state }) => {
      const t = text.trim();
      if (lvl === 0 && /^附录/.test(t)) {
        // 字母已写在标题里；记录之，供其下条使用
        const m = /附录\s*([A-Za-z])/.exec(t);
        state.appendixCount = (state.appendixCount || 0) + 1;
        state.appendix = m ? m[1].toUpperCase() : String.fromCharCode(64 + state.appendixCount);
        return null;
      }
      if (state.appendix) {
        return state.appendix + '.' + counters.slice(1, lvl + 1).join('.') + ' ';
      }
      return counters.slice(0, lvl + 1).join('.') + ' ';
    },
  },

  // 一、/（一）/ 1. /（1）
  cjk: ({ counters, lvl }) => {
    if (lvl === 0) return cjkNum(counters[0]) + '、';
    if (lvl === 1) return '（' + cjkNum(counters[1]) + '）';
    if (lvl === 2) return counters[2] + '. ';
    return '（' + counters[lvl] + '）';
  },

  // 第 1 章 / 1.1 / 1.1.1
  chapter: ({ counters, lvl }) => {
    if (lvl === 0) return '第' + counters[0] + '章 ';
    return counters.slice(0, lvl + 1).join('.') + ' ';
  },
};

export const SCHEME_NAMES = Object.keys(NUMBER_SCHEMES);

/**
 * 校验并取回编号方案。未知值抛错（与 --theme / --type 的处理风格一致）。
 */
export function resolveNumberScheme(name) {
  const s = NUMBER_SCHEMES[name];
  if (!s) {
    throw new Error('未知编号方案：' + name + '（可用：' + SCHEME_NAMES.join(', ') + '）');
  }
  return s;
}
