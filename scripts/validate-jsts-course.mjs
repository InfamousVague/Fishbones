#!/usr/bin/env node
// Central validation gate for the "JavaScript & TypeScript" course.
// Re-verifies EVERYTHING the chapter agents claimed, against the assembled
// course.json, mirroring the in-app worker (sucrase for TS):
//   1. ids unique; chapters/lessons well-formed; difficulty/kind values legal
//   2. every exercise: starter LOADS clean; solution passes ALL tests;
//      hints >= 2; objectives >= 1; topic present
//   3. every `*** playground` fence in every body: runs + logs >= 1
//   4. every quiz: >= 4 questions; mcq correctIndex in range + explanation;
//      short has accept[]; correctIndex VARIES (not all equal)
//   5. every blocks spec: slots <-> pool consistent; expected-fill passes tests
//   6. every data:image/svg+xml diagram: base64 decodes to well-formed XML
//   7. enrichment shape (glossary term/definition, symbols pattern)
// Usage: node .jsts-work/validate-jsts-course.mjs <course.json>
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire("/Users/matt/Development/Apps/Libre.academy/package.json");
const { transform } = require("sucrase");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const coursePath = process.argv[2];
const course = JSON.parse(readFileSync(coursePath, "utf8"));
const problems = [];
const counts = { lessons: 0, exercises: 0, exercisesPass: 0, playgrounds: 0, playgroundsOK: 0, quizzes: 0, quizzesOK: 0, blocks: 0, blocksOK: 0, diagrams: 0, diagramsOK: 0, readings: 0 };

function compile(src, isTS) {
  if (!isTS) return src;
  return transform(src, { transforms: ["typescript", "imports"], disableESTransforms: true }).code;
}
const fmt = (v) => typeof v === "string" ? JSON.stringify(v) : (typeof v === "object" ? (()=>{try{return JSON.stringify(v)}catch{return String(v)}})() : String(v));
function makeExpect(actual, negate) {
  const A=(c,m)=>{ if(negate?c:!c) throw new Error((negate?"not: ":"")+m); };
  return { toBe:(x)=>A(actual===x,`expected ${fmt(x)}, got ${fmt(actual)}`),
    toEqual:(x)=>A(JSON.stringify(actual)===JSON.stringify(x),`expected ${fmt(x)}, got ${fmt(actual)}`),
    toStrictEqual:(x)=>A(JSON.stringify(actual)===JSON.stringify(x),`expected ${fmt(x)}, got ${fmt(actual)}`),
    toBeTruthy:()=>A(!!actual,`expected truthy`), toBeFalsy:()=>A(!actual,`expected falsy`),
    toBeGreaterThan:(n)=>A(actual>n,`expected > ${n}`), toBeGreaterThanOrEqual:(n)=>A(actual>=n,`expected >= ${n}`),
    toBeLessThan:(n)=>A(actual<n,`expected < ${n}`), toBeLessThanOrEqual:(n)=>A(actual<=n,`expected <= ${n}`),
    toContain:(i)=>A(actual&&actual.includes&&actual.includes(i),`expected to contain ${fmt(i)}`),
    toHaveLength:(n)=>A(actual&&actual.length===n,`expected length ${n}, got ${fmt(actual&&actual.length)}`),
    toHaveProperty(k,v){const has=actual!=null&&Object.prototype.hasOwnProperty.call(actual,k);if(arguments.length<2)A(has,`expected property ${fmt(k)}`);else A(has&&JSON.stringify(actual[k])===JSON.stringify(v),`expected property ${fmt(k)}=${fmt(v)}`);},
    toBeCloseTo:(x,d=2)=>A(Math.abs(actual-x)<=Math.pow(10,-d)/2,`expected ~${x}`),
    toBeNull:()=>A(actual===null,`expected null`), toBeUndefined:()=>A(actual===undefined,`expected undefined`),
    toBeDefined:()=>A(actual!==undefined,`expected defined`), toBeNaN:()=>A(typeof actual==="number"&&actual!==actual,`expected NaN`),
    toBeInstanceOf:(c)=>A(actual instanceof c,`expected instance of ${c&&c.name}`),
    toMatch:(re)=>A(typeof re==="string"?String(actual).includes(re):re.test(String(actual)),`expected match ${fmt(re)}`),
    toThrow(x){let t=false,er;try{typeof actual==="function"&&actual();}catch(e){t=true;er=e;}if(x===undefined)A(t,"expected throw");else{const m=(er&&(er.message||String(er)))||"";A(t&&(x instanceof RegExp?x.test(m):m.includes(x)),`expected throw matching ${fmt(x)}`);}} };
}
const expect=(a)=>{const b=makeExpect(a,false);b.not=makeExpect(a,true);b.resolves={async toBe(x){return expect(await a).toBe(x)},async toEqual(x){return expect(await a).toEqual(x)}};b.rejects={async toThrow(x){let er;try{await a}catch(e){er=e}if(!er)throw new Error("expected reject");if(x!==undefined){const m=(er&&er.message)||String(er);if(!(x instanceof RegExp?x.test(m):m.includes(x)))throw new Error(`expected reject ${fmt(x)}`)}}};return b;};

async function runUser(src, isTS) {
  const userModule = { exports: {} };
  const con = { log(){},info(){},warn(){},error(){},debug(){},trace(){} };
  const fn = new AsyncFunction("module", "exports", "console", compile(src, isTS));
  await Promise.race([Promise.resolve(fn(userModule, userModule.exports, con)),
    new Promise((_, r) => setTimeout(() => r(new Error("load timeout")), 5000))]);
  return userModule;
}
async function runExercise(solution, tests, isTS) {
  const userModule = await runUser(solution, isTS);
  const results = [], pending = [];
  const test = (name, fn) => { const p=(async()=>{try{await fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,err:(e&&e.message)||String(e)})}})(); pending.push(p); return p; };
  const req = (p) => { if (p === "./user" || p === "../user" || p === "user") return userModule.exports; throw new Error("require " + p + " unsupported"); };
  const con = { log(){},info(){},warn(){},error(){},debug(){},trace(){} };
  const noop = () => {};
  const t = new AsyncFunction("test","it","describe","expect","require","console","beforeEach","afterEach","beforeAll","afterAll","jest","global","globalThis", compile(tests, isTS));
  await Promise.race([Promise.resolve(t(test, test, async (_n,f)=>f(), expect, req, con, noop, noop, noop, noop, {}, globalThis, globalThis)),
    new Promise((_, r) => setTimeout(() => r(new Error("tests timeout")), 8000))]);
  await Promise.allSettled(pending);
  return results;
}
async function runSnippet(code, isTS) {
  const logs = [];
  // Mirror the worker's formatArg: objects JSON-stringified, everything else
  // String()-ed — joining raw args would crash on null-prototype objects.
  const fa = (v) => v === null ? "null" : v === undefined ? "undefined" :
    typeof v === "string" ? v :
    typeof v === "object" ? (() => { try { return JSON.stringify(v); } catch { return String(v); } })() :
    String(v);
  const mk = () => (...a) => logs.push(a.map(fa).join(" "));
  const con = { log: mk(), info: mk(), warn: mk(), error: mk(), debug: mk(), trace: mk() };
  const mod = { exports: {} };
  const fn = new AsyncFunction("module", "exports", "console", compile(code, isTS));
  // module.exports and the `exports` param are the SAME object in the app's
  // worker — keep that invariant or `exports.x` + `module.exports.x` diverge.
  await Promise.race([Promise.resolve(fn(mod, mod.exports, con)),
    new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
  return logs.length;
}
function extractFences(body) {
  const out = []; const re = /```([^\n]*)\n([\s\S]*?)```/g; let m;
  while ((m = re.exec(body || "")) !== null) {
    const info = m[1].trim().split(/\s+/);
    out.push({ lang: info[0] || "", playground: info.slice(1).includes("playground"), code: m[2] });
  }
  return out;
}

const ids = new Set();
const tmp = mkdtempSync(join(tmpdir(), "jsts-val-"));
try {
  for (const ch of course.chapters) {
    for (const l of ch.lessons || []) {
      counts.lessons++;
      if (ids.has(l.id)) problems.push(`DUPLICATE id: ${l.id}`); ids.add(l.id);
      const isTS = (l.language || "").toLowerCase() === "typescript";
      if (!["reading","exercise","quiz","mixed"].includes(l.kind)) problems.push(`${l.id}: bad kind ${l.kind}`);
      if (l.difficulty && !["easy","medium","hard"].includes(l.difficulty)) problems.push(`${l.id}: bad difficulty ${l.difficulty}`);

      // diagrams
      for (const m of (l.body || "").matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)) {
        counts.diagrams++;
        try {
          const svg = Buffer.from(m[1], "base64").toString("utf8");
          const f = join(tmp, "d.svg"); writeFileSync(f, svg);
          execFileSync("xmllint", ["--noout", f], { stdio: "pipe" });
          if (!/^<svg[\s>]/.test(svg.trim())) throw new Error("not an <svg> root");
          counts.diagramsOK++;
        } catch (e) { problems.push(`${l.id}: bad diagram (${(e.message||e).toString().slice(0,80)})`); }
      }
      // playgrounds
      for (const f of extractFences(l.body)) {
        if (!f.playground) continue;
        counts.playgrounds++;
        const fenceTS = f.lang === "typescript" || f.lang === "ts";
        try {
          const n = await runSnippet(f.code, fenceTS);
          if (n >= 1) counts.playgroundsOK++;
          else problems.push(`${l.id}: playground with 0 logs`);
        } catch (e) { problems.push(`${l.id}: playground ERR ${(e.message||e).toString().slice(0,100)}`); }
      }
      // enrichment
      if (l.enrichment) {
        for (const g of l.enrichment.glossary || []) if (!g.term || !g.definition) problems.push(`${l.id}: bad glossary entry`);
        for (const s of l.enrichment.symbols || []) if (!s.pattern) problems.push(`${l.id}: bad symbol entry`);
      }
      if (l.kind === "reading") counts.readings++;

      if (l.kind === "exercise" || l.kind === "mixed") {
        counts.exercises++;
        if (!Array.isArray(l.hints) || l.hints.length < 2) problems.push(`${l.id}: <2 hints`);
        if (!Array.isArray(l.objectives) || l.objectives.length < 1) problems.push(`${l.id}: no objectives`);
        if (!l.topic) problems.push(`${l.id}: no topic`);
        try { await runUser(l.starter, isTS); }
        catch (e) { problems.push(`${l.id}: STARTER load error: ${(e.message||e).toString().slice(0,100)}`); }
        try {
          const res = await runExercise(l.solution, l.tests, isTS);
          const failed = res.filter((r) => !r.ok);
          if (res.length === 0) problems.push(`${l.id}: no tests ran`);
          else if (failed.length) problems.push(`${l.id}: ${failed.length}/${res.length} tests FAIL — ${failed[0].name}: ${failed[0].err}`);
          else counts.exercisesPass++;
        } catch (e) { problems.push(`${l.id}: exercise ERR ${(e.message||e).toString().slice(0,120)}`); }
        // blocks
        if (l.blocks) {
          counts.blocks++;
          const b = l.blocks; let ok = true;
          const poolIds = new Set((b.pool || []).map((p) => p.id));
          for (const s of b.slots || []) {
            if (!b.template.includes(`__SLOT_${s.id}__`)) { problems.push(`${l.id}: blocks slot ${s.id} missing in template`); ok = false; }
            if (!poolIds.has(s.expectedBlockId)) { problems.push(`${l.id}: blocks expected ${s.expectedBlockId} not in pool`); ok = false; }
          }
          if (ok) {
            let filled = b.template;
            for (const s of b.slots) {
              const blk = b.pool.find((p) => p.id === s.expectedBlockId);
              filled = filled.split(`__SLOT_${s.id}__`).join(blk.code);
            }
            try {
              const res = await runExercise(filled, l.tests, isTS);
              if (res.length && res.every((r) => r.ok)) counts.blocksOK++;
              else problems.push(`${l.id}: blocks-filled template fails tests`);
            } catch (e) { problems.push(`${l.id}: blocks-filled ERR ${(e.message||e).toString().slice(0,80)}`); }
          }
        }
      }
      if (l.kind === "quiz") {
        counts.quizzes++;
        const qs = l.questions || [];
        let ok = qs.length >= 4;
        if (!ok) problems.push(`${l.id}: only ${qs.length} questions`);
        const mcqIdx = [];
        for (const [i, q] of qs.entries()) {
          if (q.kind === "mcq") {
            if (!Array.isArray(q.options) || q.options.length < 2 || q.correctIndex == null || q.correctIndex < 0 || q.correctIndex >= q.options.length) { problems.push(`${l.id} Q${i}: bad mcq`); ok = false; }
            if (!q.explanation) { problems.push(`${l.id} Q${i}: no explanation`); ok = false; }
            mcqIdx.push(q.correctIndex);
          } else if (q.kind === "short") {
            if (!Array.isArray(q.accept) || q.accept.length < 1) { problems.push(`${l.id} Q${i}: short with no accept[]`); ok = false; }
          } else { problems.push(`${l.id} Q${i}: unknown kind ${q.kind}`); ok = false; }
          if (!q.prompt) { problems.push(`${l.id} Q${i}: no prompt`); ok = false; }
        }
        if (mcqIdx.length >= 3 && new Set(mcqIdx).size === 1) { problems.push(`${l.id}: ALL mcq answers at index ${mcqIdx[0]}`); ok = false; }
        if (ok) counts.quizzesOK++;
      }
    }
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log(`chapters=${course.chapters.length} lessons=${counts.lessons} (readings=${counts.readings})`);
console.log(`exercises:   ${counts.exercisesPass}/${counts.exercises} pass (starter+solution+tests)`);
console.log(`playgrounds: ${counts.playgroundsOK}/${counts.playgrounds} run clean with output`);
console.log(`quizzes:     ${counts.quizzesOK}/${counts.quizzes} valid`);
console.log(`blocks:      ${counts.blocksOK}/${counts.blocks} fill-and-pass`);
console.log(`diagrams:    ${counts.diagramsOK}/${counts.diagrams} well-formed SVG`);
if (problems.length) {
  console.log(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
console.log("\n✓ ALL GREEN");
