// ============================================================
// raw-modules.d.ts — vite ?raw import 声明(给 .sty / .fv 文件用)
// ============================================================
// 让 TS 知道 vite 的 `import foo from './bar.sty?raw'` 返回 string。
// 没有这个声明,TS 会报"Cannot find module"。
// ============================================================

declare module '*.sty?raw' {
  const content: string;
  export default content;
}

declare module '*.fv?raw' {
  const content: string;
  export default content;
}

declare module '*.grammar?raw' {
  const content: string;
  export default content;
}
