/* =========================================================================
   Pedigree — clinical pedigree drawing tool
   Vanilla JS + HTML5 canvas. Data is autosaved to localStorage.
   ========================================================================= */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const R = 20;             // symbol half-size (world units)
  const GEN_H = 170;        // vertical distance between generations
  const GRID = 10;          // horizontal snap
  const SPACING = 100;      // default horizontal spacing between new relatives
  const LINE_H = 14;        // annotation line height
  const NOTE_W = 104;       // wrap width for clinical notes
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const STORAGE_KEY = 'pedigree-tool:v1';
  const INK = '#1a1a1a';
  const ACCENT = '#0f6cbd';
  const PENDING = '#e8590c';
  const PALETTE = ['#d64545', '#2f6fdb', '#e0a100', '#2a9d6f', '#8b5cf6', '#e0719e', '#0e9aa7', '#7c5a3a'];
  const KINDS = ['marriage', 'consanguineous', 'separated', 'divorced', 'sibship'];
  const ZYGS = ['dz', 'mz', 'unknown'];
  const SEX_NAMES = { M: 'Male', F: 'Female', U: 'Unknown sex' };
  // Pregnancy outcomes ('' = live born). SAB / TOP are drawn as small triangles.
  const OUTCOMES = {
    P: { name: 'Pregnancy', abbr: '' },
    SB: { name: 'Stillbirth', abbr: 'SB' },
    SAB: { name: 'Spontaneous abortion', abbr: 'SAB' },
    TOP: { name: 'Termination of pregnancy', abbr: 'TOP' },
  };
  const PLACE_TOOLS = {
    male: { sex: 'M', outcome: '' },
    female: { sex: 'F', outcome: '' },
    unknown: { sex: 'U', outcome: '' },
    pregnancy: { sex: 'U', outcome: 'P' },
    stillbirth: { sex: 'U', outcome: 'SB' },
    sab: { sex: 'U', outcome: 'SAB' },
    top: { sex: 'U', outcome: 'TOP' },
  };
  const HINTS = {
    select: 'Click to select · drag to move · drag empty space to pan · scroll to zoom',
    male: 'Click on the canvas to place a male.',
    female: 'Click on the canvas to place a female.',
    unknown: 'Click on the canvas to place an individual of unknown sex.',
    pregnancy: 'Click on the canvas to place an ongoing pregnancy (P). Tip: select a couple and use "Add child" instead.',
    stillbirth: 'Click on the canvas to place a stillbirth (SB).',
    sab: 'Click on the canvas to place a spontaneous abortion / miscarriage (triangle).',
    top: 'Click on the canvas to place a termination of pregnancy (triangle with slash).',
    partner: ['Click the first partner…', 'Now click the second partner.'],
    child: ['Click a couple (their relationship line, or one parent)…', 'Now click the child.'],
    sibling: ['Click the first sibling…', 'Now click the second sibling.'],
    twin: ['Click the first twin…', 'Now click the second twin.'],
  };

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const mctx = document.createElement('canvas').getContext('2d'); // text measuring
  const stage = $('#stage');
  const ui = {
    title: $('#titleInput'), undo: $('#undoBtn'), redo: $('#redoBtn'),
    newBtn: $('#newBtn'), open: $('#openBtn'), save: $('#saveBtn'), file: $('#fileInput'),
    exportScale: $('#exportScale'), exportBtn: $('#exportBtn'),
    hint: $('#hintText'), partnerOpts: $('#partnerOpts'), partnerKind: $('#partnerKind'),
    twinOpts: $('#twinOpts'), twinZyg: $('#twinZyg'),
    zoomOut: $('#zoomOut'), zoomIn: $('#zoomIn'), zoomFit: $('#zoomFit'), zoomLabel: $('#zoomLabel'),
    toast: $('#toast'), empty: $('#emptyState'),
    diseaseList: $('#diseaseList'), addDisease: $('#addDiseaseBtn'),
    noSel: $('#noSel'), personForm: $('#personForm'), unionForm: $('#unionForm'),
    pTitle: $('#pTitle'), pId: $('#pId'), pLabel: $('#pLabel'), pAge: $('#pAge'), pSex: $('#pSex'),
    pDeceased: $('#pDeceased'), pDeceasedWrap: $('#pDeceasedWrap'),
    pOutcome: $('#pOutcome'), pGestRow: $('#pGestRow'), pGest: $('#pGest'), pGestHint: $('#pGestHint'), pProband: $('#pProband'), pConditions: $('#pConditions'),
    pTwinRow: $('#pTwinRow'), pTwinZyg: $('#pTwinZyg'), pUntwin: $('#pUntwin'),
    pNotes: $('#pNotes'), quick: $('#quickAdd'), pDetach: $('#pDetach'), pDelete: $('#pDelete'),
    uTitle: $('#uTitle'), uDesc: $('#uDesc'), uKindRow: $('#uKindRow'), uKind: $('#uKind'),
    uAdd: $('#uAdd'), uParents: $('#uParents'), uDelete: $('#uDelete'),
    optIds: $('#optIds'), optNotes: $('#optNotes'), optGrid: $('#optGrid'),
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  function freshState() {
    return {
      version: 1,
      title: '',
      // {id, sex, x, y, label, age, notes, deceased, proband, outcome:''|'P'|'SB'|'SAB'|'TOP', gestation,
      //  conditions:{diseaseId:'affected'|'carrier'}, parents}
      people: [],
      unions: [],   // {id, a, b, kind}  kind 'sibship' = siblings whose parents are not drawn (a = b = null)
      twins: [],    // {id, members:[personId…], zyg:'dz'|'mz'|'unknown'}
      diseases: [{ id: 'd1', name: 'Condition A', color: PALETTE[0] }],
      display: { ids: true, notes: true, grid: true },
      seq: 2,
    };
  }

  let state = freshState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = normalize(JSON.parse(raw));
  } catch (err) { console.warn('Could not restore saved pedigree:', err); }

  const view = { x: 0, y: 0, scale: 1 };
  let tool = 'select';
  let selection = null;     // {kind:'person'|'union', id}
  let pending = null;       // first click of a two-click tool: {kind:'person'|'union', id}
  let drag = null;
  let spaceDown = false;
  let mouse = { x: 0, y: 0 };
  let textBefore = null;    // snapshot taken when a text field gains focus
  let didInitialFit = false;
  const undoStack = [];
  const redoStack = [];

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const newId = (prefix) => prefix + (state.seq++);
  const getPerson = (id) => (id && state.people.find((p) => p.id === id)) || null;
  const getUnion = (id) => (id && state.unions.find((u) => u.id === id)) || null;
  const childrenOf = (uid) => state.people.filter((p) => p.parents === uid);
  const partnerUnionsOf = (pid) => state.unions.filter((u) => u.kind !== 'sibship' && (u.a === pid || u.b === pid));
  const twinGroupOf = (pid) => state.twins.find((t) => t.members.includes(pid)) || null;
  const snapX = (x) => Math.round(x / GRID) * GRID;
  const snapY = (y) => Math.round(y / GEN_H) * GEN_H;
  const isTriangle = (p) => p.outcome === 'SAB' || p.outcome === 'TOP';
  const shapeOf = (p) => (isTriangle(p) ? 'T' : p.sex);
  const symH = (p) => (isTriangle(p) ? R * 0.7 : p.sex === 'U' ? R * 1.2 : R);
  const textTop = (p) => p.y + symH(p) + 12;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const selPerson = () => (selection && selection.kind === 'person' ? getPerson(selection.id) : null);
  const selUnion = () => (selection && selection.kind === 'union' ? getUnion(selection.id) : null);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function roman(n) {
    const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    for (const [v, r] of table) while (n >= v) { s += r; n -= v; }
    return s;
  }

  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1) : 0;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  let toastTimer = null;
  function toast(msg, isError = false) {
    ui.toast.textContent = msg;
    ui.toast.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.className = ''; }, 2600);
  }
  function fail(msg) { toast(msg, true); return false; }

  // ---------------------------------------------------------------------------
  // Persistence, history
  // ---------------------------------------------------------------------------
  const snapshot = () => JSON.stringify(state);

  function save() {
    try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch (err) { /* storage full / disabled */ }
  }

  function pushUndo(before) {
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }

  /** Run a state change as one undoable step. If fn returns false the change is rolled back. */
  function mutate(fn) {
    const before = snapshot();
    const result = fn();
    if (result === false) { state = JSON.parse(before); return false; }
    prune();
    if (snapshot() !== before) pushUndo(before);
    changed();
    return result;
  }

  function commitTextEdit() {
    if (textBefore) { pushUndo(textBefore); textBefore = null; }
  }

  function changed() {
    save();
    if (selection && !(selection.kind === 'person' ? getPerson(selection.id) : getUnion(selection.id))) selection = null;
    refreshPanels();
    render();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    state = JSON.parse(undoStack.pop());
    pending = null;
    changed();
    updateUndoButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    state = JSON.parse(redoStack.pop());
    pending = null;
    changed();
    updateUndoButtons();
  }

  function updateUndoButtons() {
    ui.undo.disabled = !undoStack.length;
    ui.redo.disabled = !redoStack.length;
  }

  /** Validate and clean data loaded from storage or a file. */
  function normalize(obj) {
    if (!obj || !Array.isArray(obj.people) || !Array.isArray(obj.unions)) throw new Error('Not a pedigree file.');
    const s = freshState();
    s.title = String(obj.title || '');
    s.people = obj.people.map((p) => ({
      id: String(p.id),
      sex: ['M', 'F', 'U'].includes(p.sex) ? p.sex : 'U',
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      label: String(p.label || ''),
      age: String(p.age || ''),
      notes: String(p.notes || ''),
      deceased: !!p.deceased,
      proband: !!p.proband,
      outcome: p.outcome in OUTCOMES ? p.outcome : '',
      gestation: String(p.gestation || ''),
      conditions: p.conditions && typeof p.conditions === 'object' ? { ...p.conditions } : {},
      parents: p.parents ? String(p.parents) : null,
    }));
    s.unions = obj.unions.map((u) => {
      const kind = KINDS.includes(u.kind) ? u.kind : 'marriage';
      return { id: String(u.id), kind, a: kind === 'sibship' ? null : String(u.a), b: kind === 'sibship' ? null : String(u.b) };
    });
    s.twins = Array.isArray(obj.twins) ? obj.twins.map((t) => ({
      id: String(t.id),
      members: Array.isArray(t.members) ? t.members.map(String) : [],
      zyg: ZYGS.includes(t.zyg) ? t.zyg : 'dz',
    })) : [];
    if (Array.isArray(obj.diseases)) {
      s.diseases = obj.diseases.map((d) => ({
        id: String(d.id),
        name: String(d.name ?? ''),
        color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#888888',
      }));
    }
    if (obj.display) for (const k of Object.keys(s.display)) if (k in obj.display) s.display[k] = !!obj.display[k];
    // Make sure newly generated ids never collide with loaded ones.
    const nums = [...s.people, ...s.unions, ...s.twins, ...s.diseases].map((o) => parseInt(o.id.replace(/\D/g, ''), 10) || 0);
    s.seq = Math.max(Number(obj.seq) || 1, ...nums, 0) + 1;
    return s;
  }

  /** Keep the data model consistent after any change. */
  function prune() {
    const pids = new Set(state.people.map((p) => p.id));

    // A couple that lost a partner keeps its children together as a sibship.
    for (const u of state.unions) {
      if (u.kind !== 'sibship' && (!pids.has(u.a) || !pids.has(u.b))) { u.a = null; u.b = null; u.kind = 'sibship'; }
    }
    // A sibship without drawn parents only makes sense with 2+ children.
    state.unions = state.unions.filter((u) => u.kind !== 'sibship' || childrenOf(u.id).length >= 2);

    const uids = new Set(state.unions.map((u) => u.id));
    for (const p of state.people) if (p.parents && !uids.has(p.parents)) p.parents = null;

    const dids = new Set(state.diseases.map((d) => d.id));
    for (const p of state.people) {
      for (const k of Object.keys(p.conditions)) {
        if (!dids.has(k) || !['affected', 'carrier'].includes(p.conditions[k])) delete p.conditions[k];
      }
    }

    // Twins must share the same parents; each person belongs to at most one twin group.
    const seen = new Set();
    state.twins = state.twins.filter((t) => {
      const ms = [...new Set(t.members)].map(getPerson).filter((m) => m && m.parents && !seen.has(m.id));
      const counts = {};
      for (const m of ms) counts[m.parents] = (counts[m.parents] || 0) + 1;
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      t.members = ms.filter((m) => m.parents === best).map((m) => m.id);
      if (t.members.length < 2) return false;
      t.members.forEach((id) => seen.add(id));
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Pedigree operations
  // ---------------------------------------------------------------------------
  function createPerson(sex, x, y, extra = {}) {
    const p = {
      id: newId('p'), sex, x: snapX(x), y: snapY(y),
      label: '', age: '', notes: '', deceased: false, proband: false,
      outcome: '', gestation: '', conditions: {}, parents: null, ...extra,
    };
    state.people.push(p);
    return p;
  }

  /** Nearest free horizontal slot on a generation row. */
  function freeX(x, y, dir = 1, gap = SPACING - 20) {
    x = snapX(x);
    let guard = 0;
    while (guard++ < 200 && state.people.some((o) => Math.abs(o.y - y) < GEN_H / 2 && Math.abs(o.x - x) < gap)) {
      x += (gap + 10) * dir;
    }
    return x;
  }

  function linkPartners(p, q, kind) {
    if (p.id === q.id) return fail('Choose two different individuals.');
    if (state.unions.some((u) => (u.a === p.id && u.b === q.id) || (u.a === q.id && u.b === p.id))) {
      return fail('These two are already linked as partners.');
    }
    const [a, b] = p.x <= q.x ? [p, q] : [q, p];
    const u = { id: newId('u'), a: a.id, b: b.id, kind };
    state.unions.push(u);
    return u;
  }

  /** True if pid is one of the union's partners or one of their ancestors. */
  function isAncestorOrPartner(pid, union) {
    const seen = new Set();
    const stack = [union.a, union.b].filter(Boolean);
    while (stack.length) {
      const id = stack.pop();
      if (id === pid) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const pu = getUnion(getPerson(id)?.parents);
      if (pu) stack.push(...[pu.a, pu.b].filter(Boolean));
    }
    return false;
  }

  function linkChild(u, c) {
    if (isAncestorOrPartner(c.id, u)) return fail('That would make someone their own ancestor.');
    if (c.parents === u.id) return fail('Already a child of this couple.');
    c.parents = u.id;
    return true;
  }

  function makeSiblings(p, q) {
    if (p.id === q.id) return fail('Choose two different individuals.');
    if (p.parents && q.parents) {
      if (p.parents === q.parents) return true;
      const up = getUnion(p.parents), uq = getUnion(q.parents);
      if (up.kind === 'sibship') { childrenOf(up.id).forEach((k) => { k.parents = uq.id; }); return true; }
      if (uq.kind === 'sibship') { childrenOf(uq.id).forEach((k) => { k.parents = up.id; }); return true; }
      return fail('These individuals already have different parents.');
    }
    if (p.parents) { q.parents = p.parents; return true; }
    if (q.parents) { p.parents = q.parents; return true; }
    const u = { id: newId('u'), a: null, b: null, kind: 'sibship' };
    state.unions.push(u);
    p.parents = q.parents = u.id;
    return true;
  }

  function makeTwins(p, q, zyg) {
    if (!makeSiblings(p, q)) return false;
    const tp = twinGroupOf(p.id), tq = twinGroupOf(q.id);
    if (tp && tp === tq) tp.zyg = zyg;
    else if (tp && tq) { tp.members.push(...tq.members); tp.zyg = zyg; state.twins = state.twins.filter((t) => t !== tq); }
    else if (tp) { tp.members.push(q.id); tp.zyg = zyg; }
    else if (tq) { tq.members.push(p.id); tq.zyg = zyg; }
    else state.twins.push({ id: newId('t'), members: [p.id, q.id], zyg });
    return true;
  }

  function addParents(p) {
    let u = getUnion(p.parents);
    if (u && u.kind !== 'sibship') return fail('This individual already has parents.');
    const sibs = u ? childrenOf(u.id) : [p];
    const cx = sibs.reduce((s, k) => s + k.x, 0) / sibs.length;
    const y = snapY(Math.min(...sibs.map((k) => k.y)) - GEN_H);
    const father = createPerson('M', freeX(cx - 60, y, -1), y);
    const mother = createPerson('F', freeX(cx + 60, y, 1), y);
    if (u) { u.a = father.id; u.b = mother.id; u.kind = 'marriage'; }
    else { u = { id: newId('u'), a: father.id, b: mother.id, kind: 'marriage' }; state.unions.push(u); p.parents = u.id; }
    return u;
  }

  function addPartner(p) {
    const q = createPerson(p.sex === 'M' ? 'F' : 'M', freeX(p.x + SPACING + 30, p.y), p.y);
    return linkPartners(p, q, 'marriage');
  }

  /** The most recent couple this person belongs to (creating a partner if needed). */
  function coupleFor(p) {
    const us = partnerUnionsOf(p.id);
    return us.length ? us[us.length - 1] : addPartner(p);
  }

  function addChild(u, sex, outcome = '') {
    const kids = childrenOf(u.id);
    const g = unionGeom(u);
    const y = snapY(g.partner ? Math.max(g.partner.y1, g.partner.y2) + GEN_H : kids[0].y);
    const x0 = kids.length ? Math.max(...kids.map((k) => k.x)) + SPACING : g.mid.x;
    const c = createPerson(sex, freeX(x0, y), y, { outcome });
    c.parents = u.id;
    return c;
  }

  /** Siblings go on the side away from this person's partners, so lines don't cross. */
  function siblingSide(p) {
    const xs = partnerUnionsOf(p.id)
      .map((u) => getPerson(u.a === p.id ? u.b : u.a))
      .filter(Boolean)
      .map((q) => q.x);
    return xs.some((x) => x > p.x) && !xs.some((x) => x < p.x) ? -1 : 1;
  }

  function addSibling(p, sex, offset = SPACING, gap) {
    if (!p.parents) {
      const u = { id: newId('u'), a: null, b: null, kind: 'sibship' };
      state.unions.push(u);
      p.parents = u.id;
    }
    const dir = siblingSide(p);
    const s = createPerson(sex, freeX(p.x + dir * offset, p.y, dir, gap), p.y);
    s.parents = p.parents;
    return s;
  }

  function addTwin(p) {
    const s = addSibling(p, p.sex, 90, 80);
    const tg = twinGroupOf(p.id);
    return makeTwins(p, s, tg ? tg.zyg : ui.twinZyg.value);
  }

  function deleteSelection() {
    if (!selection) return;
    if (selection.kind === 'person') {
      const id = selection.id;
      mutate(() => { state.people = state.people.filter((p) => p.id !== id); });
    } else {
      const id = selection.id;
      mutate(() => {
        childrenOf(id).forEach((k) => { k.parents = null; });
        state.unions = state.unions.filter((u) => u.id !== id);
      });
    }
    selection = null;
    refreshPanels();
    render();
    toast('Deleted — press Ctrl/⌘ Z to undo.');
  }

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------
  function genRows() {
    const keys = [...new Set(state.people.map((p) => Math.round(p.y / GEN_H)))].sort((a, b) => a - b);
    return keys.map((key, index) => ({ key, index, y: key * GEN_H }));
  }

  /** Standard pedigree numbering: generation (Roman) + position from left, e.g. II-3. */
  function computeIds() {
    const ids = {};
    for (const row of genRows()) {
      state.people
        .filter((p) => Math.round(p.y / GEN_H) === row.key)
        .sort((a, b) => a.x - b.x)
        .forEach((p, i) => { ids[p.id] = `${roman(row.index + 1)}-${i + 1}`; });
    }
    return ids;
  }

  function unionGeom(u) {
    const A = getPerson(u.a), B = getPerson(u.b);
    const kids = childrenOf(u.id);
    const g = { u, kids, partner: null, mid: null, units: [], segs: [] };

    if (A && B) {
      const [L, Rt] = A.x <= B.x ? [A, B] : [B, A];
      g.partner = { x1: L.x, y1: L.y, x2: Rt.x, y2: Rt.y };
      g.mid = { x: (L.x + Rt.x) / 2, y: (L.y + Rt.y) / 2 };
      g.segs.push([L.x, L.y, Rt.x, Rt.y]);
    }
    if (!kids.length) return g;

    // Twins hang from a single point on the sibship line.
    const used = new Set();
    for (const t of state.twins) {
      const ms = t.members.map(getPerson).filter((k) => k && k.parents === u.id);
      if (ms.length < 2) continue;
      ms.sort((a, b) => a.x - b.x);
      ms.forEach((m) => used.add(m.id));
      g.units.push({ x: ms.reduce((s, m) => s + m.x, 0) / ms.length, members: ms, twin: t });
    }
    for (const k of kids) if (!used.has(k.id)) g.units.push({ x: k.x, members: [k], twin: null });

    g.sibY = Math.min(...kids.map((k) => k.y - symH(k))) - 34;
    const unitXs = g.units.map((t) => t.x);
    const xs = g.mid ? [...unitXs, g.mid.x] : unitXs;
    g.sibX1 = Math.min(...xs);
    g.sibX2 = Math.max(...xs);
    if (g.mid) {
      g.segs.push([g.mid.x, g.mid.y, g.mid.x, g.sibY]);
    } else {
      g.stubX = (Math.min(...unitXs) + Math.max(...unitXs)) / 2;
      g.segs.push([g.stubX, g.sibY, g.stubX, g.sibY - 22]);
    }
    g.segs.push([g.sibX1, g.sibY, g.sibX2, g.sibY]);
    return g;
  }

  function annotationLines(p, ids) {
    const lines = [];
    const add = (t, font, color) => { mctx.font = font; lines.push({ t, font, color, w: mctx.measureText(t).width }); };
    if (state.display.ids && ids[p.id]) add(ids[p.id], `600 10.5px ${FONT}`, '#6b7280');
    const oc = outcomeText(p);
    if (oc) add(oc, `700 11.5px ${FONT}`, '#111827');
    if (p.label.trim()) add(p.label.trim(), `600 12px ${FONT}`, '#111827');
    if (p.age.trim()) add(p.age.trim(), `12px ${FONT}`, '#111827');
    if (state.display.notes && p.notes.trim()) {
      const f = `italic 11px ${FONT}`;
      for (const t of wrapText(p.notes.trim(), f, NOTE_W)) add(t, f, '#374151');
    }
    return lines;
  }

  /** Standard annotation for pregnancies and losses, e.g. "SB 28 wk", "SAB 10 wk · male", "20 wk". */
  function outcomeText(p) {
    if (!p.outcome) return '';
    const parts = [OUTCOMES[p.outcome].abbr, p.gestation.trim()].filter(Boolean).join(' ');
    const sex = isTriangle(p) && p.sex !== 'U' ? (p.sex === 'M' ? 'male' : 'female') : '';
    return [parts, sex].filter(Boolean).join(' · ');
  }

  function wrapText(text, font, maxW) {
    mctx.font = font;
    const out = [];
    for (const para of text.split(/\r?\n/)) {
      let line = '';
      for (let word of para.split(/\s+/).filter(Boolean)) {
        // Hard-break words that are wider than the column.
        while (word.length > 1 && mctx.measureText(word).width > maxW) {
          let i = word.length - 1;
          while (i > 1 && mctx.measureText(word.slice(0, i)).width > maxW) i--;
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, i));
          word = word.slice(i);
        }
        const test = line ? `${line} ${word}` : word;
        if (line && mctx.measureText(test).width > maxW) { out.push(line); line = word; } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  function personExtent(p, ids) {
    const lines = annotationLines(p, ids);
    const half = Math.max(R + 10, ...lines.map((l) => l.w / 2 + 3));
    return {
      lines,
      left: p.x - Math.max(half, p.proband ? R + 42 : 0),
      right: p.x + half,
      top: p.y - symH(p) - 10,
      bottom: Math.max(textTop(p) + lines.length * LINE_H, p.y + R + 28),
    };
  }

  function sceneLayout() {
    const ids = computeIds();
    const ext = new Map(state.people.map((p) => [p.id, personExtent(p, ids)]));
    const minLeft = Math.min(...[...ext.values()].map((e) => e.left));
    return { ids, ext, labelX: minLeft - 30 };
  }

  function sceneBounds() {
    if (!state.people.length) return null;
    const { ext, labelX } = sceneLayout();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const e of ext.values()) {
      x1 = Math.min(x1, e.left); x2 = Math.max(x2, e.right);
      y1 = Math.min(y1, e.top); y2 = Math.max(y2, e.bottom);
    }
    if (state.display.ids) x1 = Math.min(x1, labelX - 16);
    return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function line(c, x1, y1, x2, y2) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }

  /** shape: 'M' square, 'F' circle, 'U' diamond, 'T' small triangle (pregnancy loss). */
  function symbolPath(c, shape, x, y, r) {
    c.beginPath();
    if (shape === 'M') c.rect(x - r, y - r, 2 * r, 2 * r);
    else if (shape === 'F') c.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === 'T') {
      c.moveTo(x, y - r * 0.7); c.lineTo(x + r * 0.8, y + r * 0.6); c.lineTo(x - r * 0.8, y + r * 0.6); c.closePath();
    } else {
      const d = r * 1.2;
      c.moveTo(x, y - d); c.lineTo(x + d, y); c.lineTo(x, y + d); c.lineTo(x - d, y); c.closePath();
    }
  }

  /** Fill the (already clipped) symbol with one color, or equal pie segments for several conditions. */
  function fillSegments(c, x, y, r, colors) {
    if (colors.length === 1) { c.fillStyle = colors[0]; c.fillRect(x - 2 * r, y - 2 * r, 4 * r, 4 * r); return; }
    const step = (Math.PI * 2) / colors.length;
    colors.forEach((col, i) => {
      c.beginPath();
      c.moveTo(x, y);
      c.arc(x, y, r * 2, -Math.PI / 2 + i * step, -Math.PI / 2 + (i + 1) * step);
      c.closePath();
      c.fillStyle = col;
      c.fill();
    });
  }

  function drawProbandArrow(c, x, y, r, withLabel = true) {
    const len = r >= 14 ? 24 : 13;
    const tx = x - r - 4, ty = y + r * 0.45;
    const sx = tx - len, sy = ty + len * 0.66;
    const ang = Math.atan2(ty - sy, tx - sx);
    const head = r >= 14 ? 8 : 5;
    c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = r >= 14 ? 2 : 1.5;
    line(c, sx, sy, tx - Math.cos(ang) * head * 0.6, ty - Math.sin(ang) * head * 0.6);
    c.beginPath();
    c.moveTo(tx, ty);
    c.lineTo(tx - head * Math.cos(ang - 0.45), ty - head * Math.sin(ang - 0.45));
    c.lineTo(tx - head * Math.cos(ang + 0.45), ty - head * Math.sin(ang + 0.45));
    c.closePath();
    c.fill();
    if (withLabel) {
      c.font = `700 12px ${FONT}`; c.textAlign = 'right'; c.textBaseline = 'middle';
      c.fillText('P', sx - 3, sy + 3);
    }
  }

  function drawPerson(c, p, lines, o) {
    const aff = state.diseases.filter((d) => p.conditions[d.id] === 'affected');
    const car = state.diseases.filter((d) => p.conditions[d.id] === 'carrier');
    c.save();

    // Fill: white, then affected shading.
    const shape = shapeOf(p);
    symbolPath(c, shape, p.x, p.y, R);
    c.fillStyle = '#fff';
    c.fill();
    if (aff.length) {
      c.save();
      c.clip();
      fillSegments(c, p.x, p.y, R, aff.map((d) => d.color));
      c.restore();
    }

    // Carrier: centered dot(s) — moved below the "P" of a pregnancy, smaller inside a triangle.
    if (car.length) {
      const tri = shape === 'T';
      const gap = tri ? 8 : 11;
      const dotR = tri ? 3.2 : 4.5;
      const dotY = p.outcome === 'P' ? p.y + R * 0.55 : tri ? p.y + 3 : p.y;
      const start = p.x - ((car.length - 1) * gap) / 2;
      car.forEach((d, i) => {
        c.beginPath();
        c.arc(start + i * gap, dotY, dotR, 0, Math.PI * 2);
        c.fillStyle = d.color;
        c.fill();
        c.lineWidth = aff.length ? 1.5 : 1;
        c.strokeStyle = aff.length ? '#fff' : INK;
        c.stroke();
      });
    }

    // Outline.
    symbolPath(c, shape, p.x, p.y, R);
    c.lineWidth = 2;
    c.strokeStyle = INK;
    c.lineJoin = 'miter';
    c.stroke();

    // Pregnancy: "P" inside the symbol.
    if (p.outcome === 'P') {
      c.font = `700 ${p.sex === 'U' ? 15 : 17}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const py = car.length ? p.y - 3 : p.y + 1;
      if (aff.length) { c.lineWidth = 3; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.strokeText('P', p.x, py); }
      c.fillStyle = INK;
      c.fillText('P', p.x, py);
    }

    // Diagonal slash: deceased or stillbirth (full size), termination of pregnancy (through the triangle).
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.lineCap = 'round';
    if (p.outcome === 'TOP') line(c, p.x - 16, p.y + 16, p.x + 16, p.y - 16);
    else if (!isTriangle(p) && (p.deceased || p.outcome === 'SB')) line(c, p.x - R - 7, p.y + R + 7, p.x + R + 7, p.y - R - 7);

    if (p.proband) drawProbandArrow(c, p.x, p.y, isTriangle(p) ? 14 : R);

    // Selection / pending highlight.
    const isSel = o.sel && o.sel.kind === 'person' && o.sel.id === p.id;
    const isPend = o.pending && o.pending.kind === 'person' && o.pending.id === p.id;
    if (isSel || isPend) {
      const e = symH(p) + 8;
      c.save();
      c.setLineDash([4, 3]);
      c.lineWidth = 1.5;
      c.strokeStyle = isPend ? PENDING : ACCENT;
      c.strokeRect(p.x - e, p.y - e, 2 * e, 2 * e);
      c.restore();
    }

    // Annotations (with a white halo so they stay legible over lines).
    let ty = textTop(p);
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.lineJoin = 'round';
    for (const l of lines) {
      c.font = l.font;
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(255,255,255,0.92)';
      c.strokeText(l.t, p.x, ty);
      c.fillStyle = l.color;
      c.fillText(l.t, p.x, ty);
      ty += LINE_H;
    }
    c.restore();
  }

  function drawUnion(c, g, o) {
    const isSel = o.sel && o.sel.kind === 'union' && o.sel.id === g.u.id;
    const isPend = o.pending && o.pending.kind === 'union' && o.pending.id === g.u.id;
    const col = isPend ? PENDING : isSel ? ACCENT : INK;
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = isSel || isPend ? 3 : 2;

    if (g.partner) {
      const { x1, y1, x2, y2 } = g.partner;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      if (g.u.kind === 'consanguineous') {
        const nx = -uy * 3, ny = ux * 3;
        line(c, x1 + nx, y1 + ny, x2 + nx, y2 + ny);
        line(c, x1 - nx, y1 - ny, x2 - nx, y2 - ny);
      } else {
        line(c, x1, y1, x2, y2);
      }
      if (g.u.kind === 'separated' || g.u.kind === 'divorced') {
        // Slash(es) across the relationship line; kept left of the descent line when there are children.
        const t0 = Math.min(0.5, R / len), t1 = 1 - t0;
        const t = g.kids.length ? (t0 + 0.5) / 2 : (t0 + t1) / 2;
        const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
        const offs = g.u.kind === 'divorced' ? [-4, 4] : [0];
        for (const off of offs) line(c, px + off - 5, py + 9, px + off + 5, py - 9);
      }
    }

    if (g.kids.length) {
      if (g.mid) line(c, g.mid.x, g.mid.y, g.mid.x, g.sibY);
      else line(c, g.stubX, g.sibY, g.stubX, g.sibY - 22);
      line(c, g.sibX1, g.sibY, g.sibX2, g.sibY);

      c.strokeStyle = INK;
      c.fillStyle = INK;
      c.lineWidth = 2;
      for (const unit of g.units) {
        if (!unit.twin) {
          const k = unit.members[0];
          line(c, k.x, g.sibY, k.x, k.y - symH(k));
          continue;
        }
        const tops = unit.members.map((m) => ({ x: m.x, y: m.y - symH(m) }));
        for (const tp of tops) line(c, unit.x, g.sibY, tp.x, tp.y);
        if (unit.twin.zyg === 'mz') {
          // Monozygotic: horizontal bar between the twin lines.
          const a = tops[0], b = tops[tops.length - 1];
          const f = 0.5;
          line(c, unit.x + (a.x - unit.x) * f, g.sibY + (a.y - g.sibY) * f, unit.x + (b.x - unit.x) * f, g.sibY + (b.y - g.sibY) * f);
        } else if (unit.twin.zyg === 'unknown') {
          c.font = `700 12px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText('?', unit.x, g.sibY + (Math.min(...tops.map((t) => t.y)) - g.sibY) * 0.62);
        }
      }
    }
    c.restore();
  }

  function drawScene(c, o = {}) {
    if (!state.people.length) return;
    const { ids, ext, labelX } = sceneLayout();
    if (state.display.ids) {
      c.font = `700 15px ${FONT}`;
      c.fillStyle = '#4b5563';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const row of genRows()) c.fillText(roman(row.index + 1), labelX, row.y);
    }
    for (const u of state.unions) drawUnion(c, unionGeom(u), o);
    for (const p of state.people) drawPerson(c, p, ext.get(p.id).lines, o);
  }

  function drawGrid(c, w, h) {
    const x1 = -view.x / view.scale, y1 = -view.y / view.scale;
    const x2 = x1 + w / view.scale, y2 = y1 + h / view.scale;
    c.save();
    c.strokeStyle = '#edf1f6';
    c.lineWidth = 1 / view.scale;
    c.setLineDash([6 / view.scale, 6 / view.scale]);
    for (let y = Math.floor(y1 / GEN_H) * GEN_H; y <= y2; y += GEN_H) line(c, x1, y, x2, y);
    c.restore();
  }

  function canvasSize() {
    const dpr = window.devicePixelRatio || 1;
    return { w: canvas.width / dpr, h: canvas.height / dpr, dpr };
  }

  function render() {
    const { w, h, dpr } = canvasSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    if (state.display.grid) drawGrid(ctx, w, h);
    drawScene(ctx, { sel: selection, pending });

    // Rubber band for two-click tools.
    if (pending) {
      let from = null;
      if (pending.kind === 'person') from = getPerson(pending.id);
      else {
        const u = getUnion(pending.id);
        if (u) { const g = unionGeom(u); from = g.mid || { x: g.stubX, y: g.sibY }; }
      }
      if (from) {
        ctx.save();
        ctx.setLineDash([6 / view.scale, 5 / view.scale]);
        ctx.strokeStyle = PENDING;
        ctx.lineWidth = 1.5 / view.scale;
        line(ctx, from.x, from.y, mouse.x, mouse.y);
        ctx.restore();
      }
    }
    ui.zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  }

  // ---------------------------------------------------------------------------
  // Legend + PNG export
  // ---------------------------------------------------------------------------
  function legendSections() {
    const mini = (sex, fill) => (c, x, y) => {
      symbolPath(c, sex, x, y, 8);
      c.fillStyle = fill || '#fff'; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = INK; c.stroke();
    };
    const miniLine = (kind) => (c, x, y) => {
      c.strokeStyle = INK; c.lineWidth = 1.5; c.lineCap = 'round';
      if (kind === 'consanguineous') { line(c, x - 11, y - 2.5, x + 11, y - 2.5); line(c, x - 11, y + 2.5, x + 11, y + 2.5); return; }
      line(c, x - 11, y, x + 11, y);
      const offs = kind === 'divorced' ? [-3, 3] : [0];
      for (const off of offs) line(c, x + off - 3, y + 6, x + off + 3, y - 6);
    };
    const miniTwin = (zyg) => (c, x, y) => {
      c.strokeStyle = INK; c.lineWidth = 1.5; c.lineCap = 'round';
      line(c, x, y - 9, x - 8, y + 9); line(c, x, y - 9, x + 8, y + 9);
      if (zyg === 'mz') line(c, x - 4, y, x + 4, y);
    };

    const symbols = [
      { label: 'Male', draw: mini('M') },
      { label: 'Female', draw: mini('F') },
      { label: 'Unknown sex', draw: mini('U') },
      { label: 'Deceased', draw: (c, x, y) => { mini('M')(c, x, y); c.lineCap = 'round'; line(c, x - 12, y + 12, x + 12, y - 12); } },
      { label: 'Carrier', draw: (c, x, y) => { mini('F')(c, x, y); c.beginPath(); c.arc(x, y, 2.6, 0, Math.PI * 2); c.fillStyle = INK; c.fill(); } },
      { label: 'Proband', draw: (c, x, y) => { mini('M')(c, x + 6, y); drawProbandArrow(c, x + 6, y, 8, false); } },
    ];
    const used = new Set(state.unions.map((u) => u.kind));
    if (used.has('consanguineous')) symbols.push({ label: 'Consanguinity', draw: miniLine('consanguineous') });
    if (used.has('separated')) symbols.push({ label: 'Separated', draw: miniLine('separated') });
    if (used.has('divorced')) symbols.push({ label: 'Divorced', draw: miniLine('divorced') });
    // Pregnancy symbols are listed when they appear in the pedigree.
    const outs = new Set(state.people.map((p) => p.outcome));
    const tri = (slash) => (c, x, y) => {
      symbolPath(c, 'T', x, y + 1, 14);
      c.fillStyle = '#fff'; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = INK; c.stroke();
      if (slash) { c.lineCap = 'round'; line(c, x - 11, y + 11, x + 11, y - 11); }
    };
    if (outs.has('P')) {
      symbols.push({ label: 'Pregnancy (P)', draw: (c, x, y) => {
        mini('U')(c, x, y);
        c.font = `700 9px ${FONT}`; c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('P', x, y + 0.5);
      } });
    }
    if (outs.has('SB')) {
      symbols.push({ label: 'Stillbirth (SB)', draw: (c, x, y) => { mini('M')(c, x, y); c.lineCap = 'round'; line(c, x - 12, y + 12, x + 12, y - 12); } });
    }
    if (outs.has('SAB')) symbols.push({ label: 'Spontaneous abortion (SAB)', draw: tri(false) });
    if (outs.has('TOP')) symbols.push({ label: 'Termination of pregnancy (TOP)', draw: tri(true) });
    const zygs = new Set(state.twins.map((t) => t.zyg));
    if (zygs.has('mz')) symbols.push({ label: 'Monozygotic twins', draw: miniTwin('mz') });
    if (zygs.has('dz') || zygs.has('unknown')) symbols.push({ label: 'Dizygotic / unknown twins', draw: miniTwin('dz') });

    const conditions = state.diseases.map((d) => ({
      label: d.name.trim() || 'Unnamed condition',
      draw: (c, x, y) => {
        c.fillStyle = d.color; c.fillRect(x - 7, y - 7, 14, 14);
        c.lineWidth = 1.5; c.strokeStyle = INK; c.strokeRect(x - 7, y - 7, 14, 14);
      },
    }));
    return [
      { title: 'Symbols', items: symbols },
      { title: 'Conditions — shaded = affected · centered dot = carrier', items: conditions },
    ];
  }

  /** Draws the key; returns its height. Pass the measuring context to lay out without drawing. */
  function drawLegend(c, x0, y0, maxW) {
    let y = y0;
    c.save();
    c.strokeStyle = '#d7dce3'; c.lineWidth = 1;
    line(c, x0, y, x0 + maxW, y);
    y += 22;
    for (const sec of legendSections()) {
      if (!sec.items.length) continue;
      c.font = `700 10.5px ${FONT}`; c.fillStyle = '#6b7280'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(sec.title.toUpperCase(), x0, y);
      y += 22;
      let x = x0;
      for (const it of sec.items) {
        c.font = `12px ${FONT}`;
        const w = 30 + c.measureText(it.label).width + 26;
        if (x > x0 && x + w > x0 + maxW) { x = x0; y += 26; }
        c.save(); it.draw(c, x + 12, y); c.restore();
        c.font = `12px ${FONT}`; c.fillStyle = '#1f2937'; c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText(it.label, x + 30, y);
        x += w;
      }
      y += 30;
    }
    c.restore();
    return y - y0;
  }

  function fileName(ext) {
    const slug = state.title.trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    const date = new Date().toISOString().slice(0, 10);
    return `pedigree${slug ? '_' + slug : ''}_${date}.${ext}`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportPNG() {
    const b = sceneBounds();
    if (!b) return fail('Add individuals before exporting.');
    const PAD = 48, HEAD = 64;
    const W = Math.ceil(Math.max(b.w + PAD * 2, 720));
    const legendH = drawLegend(mctx, PAD, 0, W - PAD * 2);
    const H = Math.ceil(HEAD + PAD + b.h + PAD + legendH + 8);

    // Browsers cap canvas dimensions/area; step the scale down if needed.
    let scale = Number(ui.exportScale.value) || 3;
    scale = Math.min(scale, 16000 / W, 16000 / H, Math.sqrt(2.4e8 / (W * H)));

    const out = document.createElement('canvas');
    out.width = Math.round(W * scale);
    out.height = Math.round(H * scale);
    const c = out.getContext('2d');
    c.scale(scale, scale);
    c.fillStyle = '#fff';
    c.fillRect(0, 0, W, H);

    // Header.
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.fillStyle = '#111827';
    c.font = `700 20px ${FONT}`;
    c.fillText(state.title.trim() || 'Pedigree', PAD, 38);
    c.font = `12px ${FONT}`;
    c.fillStyle = '#6b7280';
    c.textAlign = 'right';
    c.fillText(`Generated ${new Date().toLocaleString()}`, W - PAD, 38);
    c.strokeStyle = '#d7dce3';
    c.lineWidth = 1;
    line(c, PAD, 54, W - PAD, 54);

    // Chart, centered.
    c.save();
    c.translate(PAD + (W - PAD * 2 - b.w) / 2 - b.x1, HEAD + PAD - b.y1);
    drawScene(c, {});
    c.restore();

    drawLegend(c, PAD, HEAD + PAD + b.h + PAD, W - PAD * 2);

    out.toBlob((blob) => {
      if (!blob) return fail('Export failed — the pedigree may be too large. Try a lower resolution.');
      download(blob, fileName('png'));
      toast(`Exported ${out.width} × ${out.height} px PNG.`);
    }, 'image/png');
  }

  function saveJSON() {
    download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), fileName('json'));
    toast('Pedigree data saved.');
  }

  // ---------------------------------------------------------------------------
  // View
  // ---------------------------------------------------------------------------
  function resizeCanvas() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    if (!didInitialFit && r.width > 0) { didInitialFit = true; fit(); return; }
    render();
  }

  function fit() {
    const b = sceneBounds();
    const { w, h } = canvasSize();
    if (!b) { view.scale = 1; view.x = w / 2; view.y = h / 3; render(); return; }
    view.scale = clamp(Math.min((w - 100) / b.w, (h - 120) / b.h, 1.5), 0.2, 4);
    view.x = w / 2 - (b.x1 + b.w / 2) * view.scale;
    view.y = h / 2 + 10 - (b.y1 + b.h / 2) * view.scale;
    render();
  }

  function zoomAt(factor, sx, sy) {
    const ns = clamp(view.scale * factor, 0.2, 4);
    const k = ns / view.scale;
    view.x = sx - (sx - view.x) * k;
    view.y = sy - (sy - view.y) * k;
    view.scale = ns;
    render();
  }

  function zoomCenter(factor) {
    const { w, h } = canvasSize();
    zoomAt(factor, w / 2, h / 2);
  }

  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale, sx, sy };
  }

  function hitPerson(pt) {
    for (let i = state.people.length - 1; i >= 0; i--) {
      const p = state.people[i];
      const r = symH(p) + 4;
      if (Math.abs(pt.x - p.x) <= r && Math.abs(pt.y - p.y) <= r) return p;
    }
    return null;
  }

  function hitUnion(pt) {
    const tol = Math.max(6, 7 / view.scale);
    for (const u of state.unions) {
      for (const s of unionGeom(u).segs) if (distToSeg(pt.x, pt.y, ...s) <= tol) return u;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Tools & canvas interaction
  // ---------------------------------------------------------------------------
  function setTool(name) {
    tool = name;
    pending = null;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === name));
    updateHint();
    updateCursor();
    render();
  }

  function updateHint() {
    const h = HINTS[tool];
    ui.hint.textContent = Array.isArray(h) ? h[pending ? 1 : 0] : h;
    ui.partnerOpts.hidden = tool !== 'partner';
    ui.twinOpts.hidden = tool !== 'twin';
  }

  function updateCursor(pt) {
    let cur = 'default';
    if (drag && drag.type === 'pan') cur = 'grabbing';
    else if (spaceDown) cur = 'grab';
    else if (PLACE_TOOLS[tool]) cur = 'crosshair';
    else if (pt) {
      const onPerson = !!hitPerson(pt);
      if (tool === 'select') cur = onPerson || hitUnion(pt) ? 'move' : 'default';
      else if (tool === 'child' && !pending) cur = onPerson || hitUnion(pt) ? 'pointer' : 'crosshair';
      else cur = onPerson ? 'pointer' : 'crosshair';
    }
    canvas.style.cursor = cur;
  }

  function select(sel) {
    selection = sel;
    refreshPanels();
    render();
  }

  function startPan(e) {
    drag = { type: 'pan', cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y };
    updateCursor();
  }

  function startMove(e, pt, movers) {
    drag = {
      type: 'move', start: pt, cx: e.clientX, cy: e.clientY, moved: false, before: snapshot(),
      items: movers.filter(Boolean).map((m) => ({ id: m.id, x: m.x, y: m.y })),
    };
  }

  function onPointerDown(e) {
    if (e.button === 2) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    canvas.setPointerCapture(e.pointerId);
    const pt = toWorld(e);
    mouse = pt;
    if (e.button === 1 || spaceDown) { startPan(e); return; }
    const hp = hitPerson(pt);

    switch (tool) {
      case 'select': {
        if (hp) {
          select({ kind: 'person', id: hp.id });
          startMove(e, pt, [hp]);
          break;
        }
        const hu = hitUnion(pt);
        if (hu) {
          select({ kind: 'union', id: hu.id });
          startMove(e, pt, hu.kind === 'sibship' ? childrenOf(hu.id) : [getPerson(hu.a), getPerson(hu.b)]);
        } else {
          if (selection) select(null);
          startPan(e);
        }
        break;
      }

      case 'male': case 'female': case 'unknown':
      case 'pregnancy': case 'stillbirth': case 'sab': case 'top': {
        if (hp) { setTool('select'); select({ kind: 'person', id: hp.id }); break; }
        const { sex, outcome } = PLACE_TOOLS[tool];
        const np = mutate(() => createPerson(sex, pt.x, pt.y, { outcome }));
        setTool('select');
        select({ kind: 'person', id: np.id });
        break;
      }

      case 'partner': case 'sibling': case 'twin': {
        if (!hp) {
          if (pending) { pending = null; updateHint(); render(); }
          else toast('Click on an individual.');
          break;
        }
        if (!pending) { pending = { kind: 'person', id: hp.id }; updateHint(); render(); break; }
        const first = getPerson(pending.id);
        pending = null;
        updateHint();
        if (!first || first.id === hp.id) { render(); break; }
        if (tool === 'partner') {
          const u = mutate(() => linkPartners(first, hp, ui.partnerKind.value));
          if (u) { toast('Partners linked.'); select({ kind: 'union', id: u.id }); }
        } else if (tool === 'sibling') {
          if (mutate(() => makeSiblings(first, hp))) toast('Siblings linked.');
        } else if (mutate(() => makeTwins(first, hp, ui.twinZyg.value))) {
          toast('Twins linked.');
        }
        break;
      }

      case 'child': {
        if (!pending) {
          let u = null;
          if (hp) {
            const us = partnerUnionsOf(hp.id);
            if (!us.length) { fail('This individual has no partner yet — link a partner first.'); break; }
            u = us[us.length - 1];
          } else {
            u = hitUnion(pt);
          }
          if (!u) { toast('Click a relationship line or a parent.'); break; }
          pending = { kind: 'union', id: u.id };
          updateHint();
          render();
          break;
        }
        const u = getUnion(pending.id);
        pending = null;
        updateHint();
        if (!hp || !u) { render(); break; }
        if (mutate(() => linkChild(u, hp))) toast('Child linked.');
        break;
      }
    }
  }

  function onPointerMove(e) {
    const pt = toWorld(e);
    mouse = pt;
    if (drag && drag.type === 'pan') {
      view.x = drag.vx + e.clientX - drag.cx;
      view.y = drag.vy + e.clientY - drag.cy;
      render();
      return;
    }
    if (drag && drag.type === 'move') {
      if (!drag.moved && Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 4) return;
      drag.moved = true;
      let dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
      if (!e.shiftKey) { dx = Math.round(dx / GRID) * GRID; dy = Math.round(dy / GEN_H) * GEN_H; }
      for (const it of drag.items) {
        const p = getPerson(it.id);
        if (p) { p.x = it.x + dx; p.y = it.y + dy; }
      }
      render();
      return;
    }
    if (pending) render();
    updateCursor(pt);
  }

  function onPointerUp() {
    if (drag && drag.type === 'move' && drag.moved) {
      if (snapshot() !== drag.before) pushUndo(drag.before);
      save();
      refreshPanels();
    }
    drag = null;
    updateCursor(mouse);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const pt = toWorld(e);
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), pt.sx, pt.sy);
    } else {
      view.x -= e.deltaX;
      render();
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const hp = hitPerson(toWorld(e));
    if (!hp) return;
    setTool('select');
    select({ kind: 'person', id: hp.id });
    ui.pNotes.focus();
  });

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  const TOOL_KEYS = { v: 'select', m: 'male', f: 'female', u: 'unknown', p: 'partner', c: 'child', s: 'sibling', t: 'twin' };

  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select');
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); saveJSON(); return; }
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;

    if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; updateCursor(); } return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Escape') { setTool('select'); select(null); return; }
    if (TOOL_KEYS[key]) { setTool(TOOL_KEYS[key]); return; }
    if (key === '0') fit();
    else if (key === '+' || key === '=') zoomCenter(1.2);
    else if (key === '-') zoomCenter(1 / 1.2);
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; updateCursor(mouse); }
  });

  // ---------------------------------------------------------------------------
  // Side panels
  // ---------------------------------------------------------------------------
  function setVal(input, v) { if (document.activeElement !== input) input.value = v; }

  function personName(p, ids) {
    return p.label.trim() || ids[p.id] || SEX_NAMES[p.sex];
  }

  function refreshPanels() {
    setVal(ui.title, state.title);
    renderDiseaseList();

    const p = selPerson(), u = selUnion();
    ui.noSel.hidden = !!(p || u);
    ui.personForm.hidden = !p;
    ui.unionForm.hidden = !u;
    if (p) fillPerson(p);
    if (u) fillUnion(u);

    ui.optIds.checked = state.display.ids;
    ui.optNotes.checked = state.display.notes;
    ui.optGrid.checked = state.display.grid;
    ui.empty.hidden = state.people.length > 0;
    updateUndoButtons();
  }

  function renderDiseaseList() {
    if (ui.diseaseList.contains(document.activeElement)) return; // don't clobber while editing
    ui.diseaseList.textContent = '';
    if (!state.diseases.length) {
      ui.diseaseList.append(el('li', 'empty', 'No conditions defined.'));
      return;
    }
    for (const d of state.diseases) {
      const li = el('li');
      li.dataset.id = d.id;
      const color = el('input');
      color.type = 'color';
      color.value = d.color;
      color.title = 'Condition color';
      color.dataset.hist = '';
      const name = el('input');
      name.type = 'text';
      name.value = d.name;
      name.placeholder = 'Condition name';
      name.dataset.hist = '';
      const rm = el('button', 'remove', '×');
      rm.type = 'button';
      rm.title = 'Remove condition';
      li.append(color, name, rm);
      ui.diseaseList.append(li);
    }
  }

  function fillPerson(p) {
    const ids = computeIds();
    ui.pTitle.textContent = p.proband ? 'Proband'
      : p.outcome ? OUTCOMES[p.outcome].name
        : p.sex === 'U' ? 'Individual' : SEX_NAMES[p.sex];
    ui.pId.textContent = ids[p.id] || '';
    setVal(ui.pLabel, p.label);
    setVal(ui.pAge, p.age);
    setVal(ui.pNotes, p.notes);
    ui.pSex.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.sex === p.sex));
    ui.pOutcome.value = p.outcome;
    setVal(ui.pGest, p.gestation);
    ui.pGestRow.hidden = !p.outcome;
    ui.pGestHint.textContent = p.outcome === 'P' ? '(e.g. 20 wk, LMP 01/03/2026, EDD 12/2026)' : '(e.g. 12 wk)';
    ui.pDeceasedWrap.hidden = !!p.outcome;
    ui.pDeceased.checked = p.deceased;
    ui.pProband.checked = p.proband;
    buildConditions(p);
    const tg = twinGroupOf(p.id);
    ui.pTwinRow.hidden = !tg;
    if (tg) ui.pTwinZyg.value = tg.zyg;
    ui.pDetach.hidden = !p.parents;
  }

  function buildConditions(p) {
    const box = ui.pConditions;
    box.textContent = '';
    if (!state.diseases.length) {
      box.append(el('p', 'muted small', 'Add a condition in the Conditions legend above to record affected or carrier status.'));
      return;
    }
    for (const d of state.diseases) {
      const row = el('div', 'cond-row');
      const title = el('div', 'cond-title');
      const sw = el('span', 'swatch');
      sw.style.background = d.color;
      title.append(sw, el('span', null, d.name.trim() || 'Unnamed condition'));
      const seg = el('div', 'seg seg-sm');
      const cur = p.conditions[d.id] || '';
      for (const [val, label] of [['', 'Unaffected'], ['carrier', 'Carrier'], ['affected', 'Affected']]) {
        const b = el('button', val === cur ? 'active' : '', label);
        b.type = 'button';
        b.dataset.did = d.id;
        b.dataset.val = val;
        if (val === 'affected' && val === cur) b.style.background = d.color;
        seg.append(b);
      }
      row.append(title, seg);
      box.append(row);
    }
  }

  function fillUnion(u) {
    const sib = u.kind === 'sibship';
    const n = childrenOf(u.id).length;
    const kids = `${n} ${n === 1 ? 'child' : 'children'}`;
    ui.uTitle.textContent = sib ? 'Sibship' : 'Relationship';
    if (sib) {
      ui.uDesc.textContent = `Siblings whose parents are not drawn · ${kids}`;
    } else {
      const ids = computeIds();
      ui.uDesc.textContent = `${personName(getPerson(u.a), ids)} & ${personName(getPerson(u.b), ids)} · ${kids}`;
      ui.uKind.value = u.kind;
    }
    ui.uKindRow.hidden = sib;
    ui.uParents.hidden = !sib;
  }

  // Text fields: one undo step per focus session.
  document.addEventListener('focusin', (e) => {
    if (e.target instanceof Element && e.target.matches('[data-hist]')) textBefore = snapshot();
  });
  document.addEventListener('focusout', (e) => {
    if (e.target instanceof Element && e.target.matches('[data-hist]')) textBefore = null;
  });

  ui.title.addEventListener('input', () => { commitTextEdit(); state.title = ui.title.value; save(); });

  for (const [input, field] of [[ui.pLabel, 'label'], [ui.pAge, 'age'], [ui.pGest, 'gestation'], [ui.pNotes, 'notes']]) {
    input.addEventListener('input', () => {
      const p = selPerson();
      if (!p) return;
      commitTextEdit();
      p[field] = input.value;
      save();
      render();
    });
  }

  ui.pSex.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sex]');
    const p = selPerson();
    if (b && p) mutate(() => { p.sex = b.dataset.sex; });
  });

  ui.pOutcome.addEventListener('change', () => {
    const p = selPerson();
    if (p) mutate(() => { p.outcome = ui.pOutcome.value; });
  });

  ui.pDeceased.addEventListener('change', () => {
    const p = selPerson();
    if (p) mutate(() => { p.deceased = ui.pDeceased.checked; });
  });

  ui.pProband.addEventListener('change', () => {
    const p = selPerson();
    if (!p) return;
    const on = ui.pProband.checked;
    mutate(() => {
      if (on) state.people.forEach((o) => { o.proband = false; }); // only one proband per pedigree
      p.proband = on;
    });
  });

  ui.pConditions.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-did]');
    const p = selPerson();
    if (!b || !p) return;
    mutate(() => {
      if (b.dataset.val) p.conditions[b.dataset.did] = b.dataset.val;
      else delete p.conditions[b.dataset.did];
    });
  });

  ui.pTwinZyg.addEventListener('change', () => {
    const p = selPerson();
    const tg = p && twinGroupOf(p.id);
    if (tg) mutate(() => { tg.zyg = ui.pTwinZyg.value; });
  });

  ui.pUntwin.addEventListener('click', () => {
    const p = selPerson();
    const tg = p && twinGroupOf(p.id);
    if (tg) mutate(() => { tg.members = tg.members.filter((id) => id !== p.id); });
  });

  ui.pDetach.addEventListener('click', () => {
    const p = selPerson();
    if (p) mutate(() => { p.parents = null; });
  });

  ui.pDelete.addEventListener('click', deleteSelection);

  const onQuickAdd = (e) => {
    const b = e.target.closest('button[data-add]');
    const p = selPerson();
    if (!b || !p) return;
    const act = b.dataset.add;
    mutate(() => {
      switch (act) {
        case 'parents': return addParents(p);
        case 'partner': return addPartner(p);
        case 'son': return addChild(coupleFor(p), 'M');
        case 'daughter': return addChild(coupleFor(p), 'F');
        case 'child': return addChild(coupleFor(p), 'U');
        case 'brother': return addSibling(p, 'M');
        case 'sister': return addSibling(p, 'F');
        case 'sibling': return addSibling(p, 'U');
        case 'twin': return addTwin(p);
        case 'pregnancy': return addChild(coupleFor(p), 'U', 'P');
        case 'stillbirth': return addChild(coupleFor(p), 'U', 'SB');
        case 'sab': return addChild(coupleFor(p), 'U', 'SAB');
        case 'top': return addChild(coupleFor(p), 'U', 'TOP');
        default: return false;
      }
    });
  };
  ui.quick.addEventListener('click', onQuickAdd);
  $('#quickPreg').addEventListener('click', onQuickAdd);

  ui.uKind.addEventListener('change', () => {
    const u = selUnion();
    if (u) mutate(() => { u.kind = ui.uKind.value; });
  });

  const onUnionAdd = (e) => {
    const b = e.target.closest('button[data-uadd]');
    const u = selUnion();
    if (b && u) mutate(() => addChild(u, b.dataset.uadd, b.dataset.outcome || ''));
  };
  ui.uAdd.addEventListener('click', onUnionAdd);
  $('#uAddPreg').addEventListener('click', onUnionAdd);

  ui.uParents.addEventListener('click', () => {
    const u = selUnion();
    const first = u && childrenOf(u.id)[0];
    if (first) mutate(() => addParents(first));
  });

  ui.uDelete.addEventListener('click', deleteSelection);

  // Conditions legend.
  ui.addDisease.addEventListener('click', () => {
    mutate(() => {
      const usedColors = new Set(state.diseases.map((d) => d.color.toLowerCase()));
      const color = PALETTE.find((c) => !usedColors.has(c)) || PALETTE[state.diseases.length % PALETTE.length];
      const letter = String.fromCharCode(65 + (state.diseases.length % 26));
      state.diseases.push({ id: newId('d'), name: `Condition ${letter}`, color });
    });
    const inputs = ui.diseaseList.querySelectorAll('input[type="text"]');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });

  ui.diseaseList.addEventListener('input', (e) => {
    const li = e.target.closest('li');
    const d = li && state.diseases.find((x) => x.id === li.dataset.id);
    if (!d) return;
    commitTextEdit();
    if (e.target.type === 'color') d.color = e.target.value;
    else d.name = e.target.value;
    save();
    render();
    const p = selPerson();
    if (p) buildConditions(p);
  });

  ui.diseaseList.addEventListener('click', (e) => {
    const b = e.target.closest('button.remove');
    const li = b && b.closest('li');
    if (!li) return;
    const id = li.dataset.id;
    li.remove(); // lets the list rebuild even if one of its inputs had focus
    mutate(() => { state.diseases = state.diseases.filter((d) => d.id !== id); });
  });

  // Display options.
  for (const [input, key] of [[ui.optIds, 'ids'], [ui.optNotes, 'notes'], [ui.optGrid, 'grid']]) {
    input.addEventListener('change', () => mutate(() => { state.display[key] = input.checked; }));
  }

  // ---------------------------------------------------------------------------
  // Top bar, rail, zoom, empty state
  // ---------------------------------------------------------------------------
  document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

  ui.undo.addEventListener('click', undo);
  ui.redo.addEventListener('click', redo);
  ui.exportBtn.addEventListener('click', exportPNG);
  ui.save.addEventListener('click', saveJSON);
  ui.open.addEventListener('click', () => ui.file.click());

  ui.file.addEventListener('change', async () => {
    const f = ui.file.files[0];
    ui.file.value = '';
    if (!f) return;
    try {
      const loaded = normalize(JSON.parse(await f.text()));
      mutate(() => { state = loaded; });
      selection = null;
      pending = null;
      refreshPanels();
      fit();
      toast(`Opened ${f.name}.`);
    } catch (err) {
      fail(`Could not open file: ${err.message}`);
    }
  });

  ui.newBtn.addEventListener('click', () => {
    if (state.people.length && !window.confirm('Start a new, empty pedigree?\n\nThe current chart can be restored with Undo.')) return;
    mutate(() => { state = freshState(); });
    selection = null;
    setTool('select');
    fit();
  });

  ui.zoomIn.addEventListener('click', () => zoomCenter(1.2));
  ui.zoomOut.addEventListener('click', () => zoomCenter(1 / 1.2));
  ui.zoomFit.addEventListener('click', fit);
  ui.zoomLabel.addEventListener('click', () => zoomCenter(1 / view.scale));

  ui.empty.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-start]');
    if (!b) return;
    const { w, h } = canvasSize();
    const cx = (w / 2 - view.x) / view.scale;
    const cy = (h / 2 - view.y) / view.scale;
    const p = mutate(() => createPerson(b.dataset.start, cx, cy, { proband: true }));
    select({ kind: 'person', id: p.id });
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  prune();
  new ResizeObserver(resizeCanvas).observe(stage);
  window.addEventListener('resize', resizeCanvas); // devicePixelRatio changes
  setTool('select');
  refreshPanels();
})();
