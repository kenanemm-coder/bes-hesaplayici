// Çalıştırma: node --test tests/
// Hesap çekirdeği index.html içindeki /*SIM_START*/ ... /*SIM_END*/ bloğundan alınır,
// yani test edilen kod sitede çalışan kodun kendisidir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/\/\*SIM_START\*\/([\s\S]*?)\/\*SIM_END\*\//);
assert.ok(m, 'SIM bloğu index.html içinde bulunamadı');
const { RULES, vestShare, stopajRate, simulate } =
  new Function(m[1] + '; return {RULES, vestShare, stopajRate, simulate};')();

const base = { monthly: 2500, years: 25, age: 30, growth: 0, ret: 0, infl: 0, alt: 0 };
const last = (p) => { const r = simulate(p); return r[r.length - 1]; };
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('kurallar: devlet katkısı %20, tavan 79.272, emeklilik 56 yaş ve 10 yıl', () => {
  assert.equal(RULES.stateRate, 0.20);
  assert.equal(RULES.capYear, 79272);
  assert.equal(RULES.retireAge, 56);
  assert.equal(RULES.retireYears, 10);
});

test('hak ediş eşikleri: 3, 6 ve 10 yılda sınır değerleri', () => {
  const cases = [[0, 0], [1, 0], [2, 0], [2.99, 0], [3, 0.15], [5, 0.15], [5.99, 0.15], [6, 0.35],
                 [9, 0.35], [9.99, 0.35], [10, 0.60], [30, 0.60]];
  for (const [t, hv] of cases) assert.equal(vestShare(t, false), hv, `t=${t}`);
  assert.equal(vestShare(1, true), 1);
});

test('stopaj oranları: 10 yıldan az %15, 10 yıl ve üzeri %10, emeklilikte %5', () => {
  assert.equal(stopajRate(1, false), 0.15);
  assert.equal(stopajRate(9, false), 0.15);
  assert.equal(stopajRate(10, false), 0.10);
  assert.equal(stopajRate(40, false), 0.10);
  assert.equal(stopajRate(10, true), 0.05);
});

test('simülasyon çıkış satırlarında doğru eşikleri uygular (yaş 18, emeklilik yok)', () => {
  const rows = simulate({ ...base, years: 12, age: 18 });
  const hv = Object.fromEntries(rows.map(r => [r.t, r.hv]));
  assert.deepEqual([hv[1], hv[2], hv[3], hv[5], hv[6], hv[9], hv[10], hv[12]], [0, 0, 0.15, 0.15, 0.35, 0.35, 0.60, 0.60]);
  assert.ok(rows.every(r => !r.elig));
});

test('yaş ve süre birlikte: emeklilik için 56 yaş VE 10 yıl gerekir', () => {
  assert.equal(last({ ...base, age: 46, years: 10 }).elig, true);    // 56 yaş, 10 yıl
  assert.equal(last({ ...base, age: 45, years: 10 }).elig, false);   // 55 yaş
  assert.equal(last({ ...base, age: 46, years: 9 }).elig, false);    // 10 yıl dolmadı
  assert.equal(last({ ...base, age: 60, years: 3 }).elig, false);    // yaş tamam, süre değil
  assert.equal(last({ ...base, age: 60, years: 10 }).elig, true);
  const e = last({ ...base, age: 46, years: 10 });
  assert.equal(e.hv, 1); assert.equal(e.sp, 0.05);
  const n = last({ ...base, age: 45, years: 10 });
  assert.equal(n.hv, 0.60); assert.equal(n.sp, 0.10);
});

test('sıfır getiri: NaN/Infinity yok, sonuç elle hesapla birebir', () => {
  const r = last(base);                                  // 2.500 TL x 12 x 25 yıl
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number') assert.ok(Number.isFinite(v), k + ' sonlu olmalı');
  near(r.ownC, 750000);
  near(r.stC, 150000);                                   // yıllık 6.000 TL, tavanın altında
  near(r.net, 750000 + 0.60 * 150000);                   // 55 yaş: emeklilik yok, %60 hak ediş
  near(r.altNet, 750000);
});

test('devlet katkısı yıllık tavanı aşmaz ve tavan enflasyonla artar', () => {
  const r1 = last({ ...base, monthly: 100000, years: 1 });  // yıllık 1,2 milyon katkı
  near(r1.stC, 79272);
  const r2 = simulate({ ...base, monthly: 100000, years: 2, infl: 0.5 });
  near(r2[1].stC, 79272 + 79272 * 1.5);
});

test('kapalı form: sabit katkı ve getiride birikim formülle kuruşuna kadar uyuşur', () => {
  const p = { monthly: 1000, years: 10, age: 18, growth: 0, ret: 0.24, infl: 0, alt: 0 };
  const m = Math.pow(1.24, 1 / 12) - 1, n = 120;
  const expected = 1000 * (1 + m) * (Math.pow(1 + m, n) - 1) / m;   // her ay başı katkı
  near(last(p).own, expected, 1e-12);
});

test('getiri yokken stopaj matrahı sıfır, ana para kaybı olmaz', () => {
  const r = last({ ...base, years: 5, age: 18 });
  near(r.ownNet, r.ownC);
});

test('yüksek getiri ve uzun süre: sonuçlar sonlu kalır', () => {
  const r = last({ monthly: 10000000, years: 45, age: 18, growth: 2, ret: 2, infl: 0, alt: 2 });
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number') assert.ok(Number.isFinite(v), k + ' sonlu olmalı');
});
