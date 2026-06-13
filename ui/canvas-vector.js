/* icenovel 캔버스 벡터 확장 — 일러스트레이터식 펜툴/도형/면·선 페인트
   도구: V 선택 / A 직접선택 / P 펜 / M 사각형 / L 원
   색  : D 기본(흰 면+검은 선), X 면↔선 전환, Shift+X 색 맞바꿈, / 활성 색 없음
   펜(선택한 패스 위): 선분 클릭=앵커 추가(모양 유지 분할), 앵커 클릭=앵커 삭제,
                      열린 끝점 클릭=이어 그리기, Alt+앵커 드래그=핸들 생성/클릭=삭제
   직접선택: 선 근처 클릭(8px 허용)=앵커 표시, Alt 조합은 펜과 동일
   레이어 순서: Alt(또는 Ctrl)+]/[ 한 칸, Shift 추가=맨앞/맨뒤
   패스 노드: { type:'path', x,y,width,height, vw,vh, points:[{x,y,ix,iy,ox,oy,sm}], closed, fill, stroke, strokeWidth }
   points 좌표는 뷰박스(vw×vh) 공간, ix/iy·ox/oy는 앵커 기준 핸들 오프셋 */
(function () {
    'use strict';
    var C = window.__CANVAS_CORE__;
    if (!C) return;
    var SVGNS = 'http://www.w3.org/2000/svg';

    // ───────── 패스 지오메트리 ─────────
    function r2(v) { return Math.round(v * 100) / 100; }
    function seg(a, b) {
        return ' C' + r2(a.x + a.ox) + ',' + r2(a.y + a.oy) + ' ' + r2(b.x + b.ix) + ',' + r2(b.y + b.iy) + ' ' + r2(b.x) + ',' + r2(b.y);
    }
    function pathD(pts, closed) {
        if (!pts || !pts.length) return '';
        var d = 'M' + r2(pts[0].x) + ',' + r2(pts[0].y);
        for (var i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
        if (closed && pts.length > 1) d += seg(pts[pts.length - 1], pts[0]) + ' Z';
        return d;
    }
    // 리사이즈로 width/height만 바뀐 경우 점들을 새 크기에 맞게 굽기(bake)
    function normPath(n) {
        var w = Math.max(1, n.width || 250), h = Math.max(1, n.height || 60);
        if (!n.vw) n.vw = w; if (!n.vh) n.vh = h;
        if (n.vw !== w || n.vh !== h) {
            var sx = w / n.vw, sy = h / n.vh;
            (n.points || []).forEach(function (p) { p.x *= sx; p.y *= sy; p.ix *= sx; p.iy *= sy; p.ox *= sx; p.oy *= sy; });
            n.vw = w; n.vh = h;
        }
    }

    // 패스 렌더러 (뷰어 포함 항상 등록)
    C.registerRenderer('path', function (n) {
        normPath(n);
        var sw = n.strokeWidth != null ? +n.strokeWidth : 2;
        return '<svg class="cpath" viewBox="0 0 ' + (n.vw || 1) + ' ' + (n.vh || 1) + '" preserveAspectRatio="none">' +
            '<path d="' + pathD(n.points, n.closed) + '" fill="' + (n.fill ? C.esc(n.fill) : 'none') +
            '" stroke="' + (n.stroke ? C.esc(n.stroke) : 'none') + '" stroke-width="' + sw +
            '" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    });
    C.render(); // 렌더러 등록 후 기존 패스 노드 다시 그리기

    if (!C.admin) return; // 이하 편집 도구는 관리자 전용

    var stage = C.stage, world = C.world;
    function cropping() { return stage.classList.contains('is-cropping'); }
    function w2p(n) { // 월드 → 패스 좌표 배율
        return { x: (n.vw || n.width || 1) / (n.width || 1), y: (n.vh || n.height || 1) / (n.height || 1) };
    }
    function p2w(n) { // 패스 → 월드 좌표 배율
        return { x: (n.width || 1) / (n.vw || n.width || 1), y: (n.height || 1) / (n.vh || n.height || 1) };
    }

    // ───────── 오버레이 (펜 미리보기 / 앵커 핸들) ─────────
    var ov = document.createElementNS(SVGNS, 'svg');
    ov.setAttribute('class', 'canvas-vecov');
    // 주의: 크기 0인 SVG는 overflow:visible이어도 Chrome이 그리지 않는다 — 반드시 0보다 크게
    ov.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;overflow:visible;pointer-events:none;z-index:30;';
    world.appendChild(ov);
    function clearOv() { while (ov.firstChild) ov.removeChild(ov.firstChild); }
    function ovEl(tag, attrs) {
        var el = document.createElementNS(SVGNS, tag);
        for (var k in attrs) el.setAttribute(k, attrs[k]);
        ov.appendChild(el); return el;
    }
    function ovPath(d, stroke, dash) {
        return ovEl('path', { d: d, fill: 'none', stroke: stroke || '#2d8b8b', 'stroke-width': 1.5 / C.view.scale, 'stroke-dasharray': dash ? (4 / C.view.scale) + ' ' + (4 / C.view.scale) : 'none' });
    }
    // 현재 페인트(면/선/굵기)로 실제 모습 미리보기 — 그려지는 과정이 그대로 보이도록 (pt로 덮어쓰기 가능)
    function ovPaintPreview(d, fillOpacity, pt) {
        var P = pt || paint;
        if (P.fill) ovEl('path', { d: d, fill: P.fill, 'fill-opacity': fillOpacity == null ? 0.9 : fillOpacity, stroke: 'none' });
        if (P.stroke && P.width > 0) ovEl('path', { d: d, fill: 'none', stroke: P.stroke, 'stroke-width': P.width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    }
    function ovAnchor(wx, wy, idx, on) {
        var s = 8 / C.view.scale;
        var r = ovEl('rect', { x: wx - s / 2, y: wy - s / 2, width: s, height: s, fill: on ? '#2d8b8b' : '#fff', stroke: '#2d8b8b', 'stroke-width': 1.2 / C.view.scale });
        r.style.pointerEvents = 'auto'; r.style.cursor = 'default';
        if (idx != null) r.dataset.vecAnchor = idx;
        return r;
    }
    // 오브젝트 횡단 선택 제어점(박스 모서리·타 패스 앵커) — 채워진 사각형, 드래그로 이동 가능
    function ovCp(wx, wy, key) {
        var s = 8 / C.view.scale;
        var r = ovEl('rect', { x: wx - s / 2, y: wy - s / 2, width: s, height: s, fill: '#2d8b8b', stroke: '#2d8b8b', 'stroke-width': 1.2 / C.view.scale });
        r.style.pointerEvents = 'auto'; r.style.cursor = 'move';
        r.dataset.vecCp = key;
        return r;
    }
    function ovHandle(ax, ay, hx, hy, spec) {
        ovEl('line', { x1: ax, y1: ay, x2: hx, y2: hy, stroke: '#2d8b8b', 'stroke-width': 1 / C.view.scale });
        var c = ovEl('circle', { cx: hx, cy: hy, r: 3.5 / C.view.scale, fill: '#fff', stroke: '#2d8b8b', 'stroke-width': 1.2 / C.view.scale });
        c.style.pointerEvents = 'auto'; c.style.cursor = 'default';
        c.dataset.vecHandle = spec;
    }

    // ───────── 페인트 상태 (면/선) ─────────
    var paint = { fill: '#ffffff', stroke: '#000000', width: 2, active: 'fill' }; // null = 없음
    var paintUI = {};
    // computed rgb(a) → #hex (완전 투명이면 null = 없음). 선택 노드의 실제 색을 스와치에 반영하는 데 사용.
    function rgbToHexOrNull(s) {
        var m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null;
        var p = m[1].split(',').map(function (x) { return parseFloat(x); });
        if (p.length > 3 && p[3] === 0) return null;
        function h(v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }
        return '#' + h(p[0]) + h(p[1]) + h(p[2]);
    }
    // 색 드래그 중 전체 render 없이 해당 노드 DOM만 즉시 갱신 (버벅임 방지). 다크모드 자동 보정 반영.
    function liveNodeColor(n, slot, val) {
        var el = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"]'); if (!el) return;
        var v = (C.themeColor && val != null) ? C.themeColor(val) : val;
        if (slot === 'fill') el.style.background = (val == null ? 'transparent' : v);
        else if (slot === 'stroke') el.style.borderColor = (val == null ? 'transparent' : v);
        else if (slot === 'textColor') { var t = el.querySelector('.cnode__body, .cnode__grouplabel'); if (t) t.style.color = v; }
    }
    function buildPaint() {
        var box = document.getElementById('canvasPaint'); if (!box) return;
        box.innerHTML =
            '<div class="paint-duo">' +
            '<button type="button" class="paint-sw paint-sw--fill" title="면 색 — 클릭=활성, 더블클릭=색 선택"></button>' +
            '<button type="button" class="paint-sw paint-sw--stroke" title="선 색 — 클릭=활성, 더블클릭=색 선택"></button>' +
            '<input type="color" class="paint-pick" style="position:absolute;left:0;top:0;width:30px;height:30px;opacity:0;pointer-events:none;border:0;padding:0;">' +
            '</div>' +
            '<div class="paint-ops">' +
            '<button type="button" data-pop="swap" title="면↔선 색 맞바꿈 (Shift+X)">⇄</button>' +
            '<button type="button" data-pop="default" title="기본 색 (D)">D</button>' +
            '<button type="button" data-pop="none" title="활성 색 없음 (/)">∅</button>' +
            '</div>' +
            '<label class="paint-w">굵기<input type="number" min="0" step="0.5"></label>';
        paintUI.fill = box.querySelector('.paint-sw--fill');
        paintUI.stroke = box.querySelector('.paint-sw--stroke');
        paintUI.width = box.querySelector('.paint-w input');
        paintUI.pick = box.querySelector('.paint-pick');
        ['fill', 'stroke'].forEach(function (slot) {
            paintUI[slot].addEventListener('click', function () { paint.active = slot; drawPaint(); });
            paintUI[slot].addEventListener('dblclick', function () { paint.active = slot; openPick(); });
        });
        box.querySelector('[data-pop="swap"]').addEventListener('click', swapPaint);
        box.querySelector('[data-pop="default"]').addEventListener('click', defaultPaint);
        box.querySelector('[data-pop="none"]').addEventListener('click', noneActive);
        paintUI.width.addEventListener('change', function () { setPaint('width', Math.max(0, +paintUI.width.value || 0)); });
        paintUI.pick.addEventListener('input', function () { setPaint(paint.active, paintUI.pick.value, true); });
        paintUI.pick.addEventListener('change', function () { setPaint(paint.active, paintUI.pick.value, false); });
        drawPaint();
    }
    // 피커 입력을 항상 활성 스와치 위에 겹쳐 둔다 — 클릭 시점에 옮기면 첫 클릭에 (0,0)에 뜬다
    function placePick() {
        var sw = paintUI[paint.active], pick = paintUI.pick;
        if (!sw || !pick) return;
        pick.style.left = sw.offsetLeft + 'px'; pick.style.top = sw.offsetTop + 'px';
        pick.style.width = sw.offsetWidth + 'px'; pick.style.height = sw.offsetHeight + 'px';
    }
    function openPick() {
        var pick = paintUI.pick;
        pick.value = /^#[0-9a-f]{6}$/i.test(paint[paint.active] || '') ? paint[paint.active] : '#000000';
        pick.click();
    }
    function drawPaint() {
        if (!paintUI.fill) return;
        ['fill', 'stroke'].forEach(function (slot) {
            var el = paintUI[slot], c = paint[slot];
            el.classList.toggle('is-none', c == null);
            el.classList.toggle('is-active', paint.active === slot);
            el.style.background = c == null ? '' : c;
        });
        if (document.activeElement !== paintUI.width) paintUI.width.value = paint.width;
        placePick();
    }
    // 페인트 변경 → 선택 객체에 즉시 적용
    function setPaint(slot, val, live) {
        if (slot === 'width') paint.width = val; else paint[slot] = val;
        var sel = C.selList(); // 그룹 포함 (그룹 면/선/굵기 편집 지원)
        if (sel.length) {
            var prop = slot === 'width' ? 'strokeWidth' : slot;
            sel.forEach(function (n) { n[prop] = val; if (live && slot !== 'width') liveNodeColor(n, slot, val); });
            if (!live) { C.markDirty(); C.render(); } // live(드래그 중)=DOM만, commit(놓을 때)=커밋+렌더
        }
        drawPaint();
    }
    function defaultPaint() { setPaint('fill', '#ffffff'); setPaint('stroke', '#000000'); }
    function swapPaint() { var f = paint.fill; setPaint('fill', paint.stroke); setPaint('stroke', f); }
    function noneActive() { setPaint(paint.active, null); }
    buildPaint();

    // ───────── 도구 전환 ─────────
    var mode = 'select';
    function setMode(m) {
        if (mode === m) return;
        endPen(true); exitDirect();
        mode = m;
        stage.classList.toggle('mode-pen', m === 'pen');
        stage.classList.toggle('mode-shape', m === 'rect' || m === 'ellipse');
        stage.classList.toggle('mode-direct', m === 'direct');
        updateToolBtns();
        if (m === 'select') drawSelUI();
        else if (m === 'pen' || m === 'direct') adoptSelected(); // 선택돼 있던 패스는 즉시 앵커 편집 대상
    }
    // 선택된 패스가 하나면 앵커 편집 대상으로 삼고 앵커를 표시
    function adoptSelected() {
        var sp = C.selList().filter(function (n) { return n.type === 'path'; });
        if (sp.length === 1) { ds.node = sp[0]; ds.sel = -1; ds.cps = {}; drawAnchors(); }
    }
    function updateToolBtns() {
        document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.tool === mode); });
    }
    document.querySelectorAll('[data-tool]').forEach(function (b) {
        b.addEventListener('click', function () { setMode(b.dataset.tool); });
    });
    updateToolBtns();

    // ───────── 펜 도구 ─────────
    var pen = null;          // { pts: [월드좌표 점], keep?: {id,fill,stroke,width}, orig?: 원본 노드 }
    var penDragging = false;
    // 펜 모드에서 그리기 시작 전: 편집 대상 패스(ds.node)와 일러스트레이터식 상호작용
    function penEdit(ev, w) {
        var t = ev.target;
        if (t.dataset && t.dataset.vecAnchor != null && ds.node) {
            var ai = +t.dataset.vecAnchor, n = ds.node;
            if (ev.altKey) { altAnchorDown(ai, ev); return 'handled'; }       // Alt = 변환(핸들 뽑기/삭제)
            if (!n.closed && (ai === 0 || ai === n.points.length - 1)) return resumePen(ai); // 열린 끝점 = 이어 그리기
            removeAnchor(n, ai); return 'handled';                            // 펜- : 앵커 삭제
        }
        if (t.dataset && t.dataset.vecHandle && ds.node) {
            if (ev.altKey) removeHandle(t.dataset.vecHandle); else dragHandle(t.dataset.vecHandle, ev);
            return 'handled';
        }
        if (ds.node) {
            var hit = segHit(ds.node, w);
            if (hit) { var ni = insertAnchor(ds.node, hit); livePath(); dragAnchor(ni, ev); return 'handled'; } // 펜+ : 앵커 추가
        }
        return null;
    }
    // 열린 패스의 끝점에서 이어 그리기 — 점들을 월드 좌표로 펴서 펜 상태로 전환
    function resumePen(endIdx) {
        var n = ds.node, k = p2w(n);
        var pts = n.points.map(function (p) {
            return { x: n.x + p.x * k.x, y: n.y + p.y * k.y, ix: p.ix * k.x, iy: p.iy * k.y, ox: p.ox * k.x, oy: p.oy * k.y, sm: !!p.sm };
        });
        if (endIdx === 0) { // 시작점에서 이어 그리면 진행 방향을 뒤집는다 (in/out 핸들 맞교환)
            pts.reverse();
            pts.forEach(function (p) { var tx = p.ix, ty = p.iy; p.ix = p.ox; p.iy = p.oy; p.ox = tx; p.oy = ty; });
        }
        var keep = {
            id: n.id,
            fill: 'fill' in n ? n.fill : paint.fill,
            stroke: 'stroke' in n ? n.stroke : paint.stroke,
            width: n.strokeWidth != null ? n.strokeWidth : paint.width
        };
        C.nodes = C.nodes.filter(function (x) { return x.id !== n.id; });
        exitDirect();
        pen = { pts: pts, keep: keep, orig: n }; // 취소(Esc) 시 orig 복원
        C.render();
        drawPen(null);
        return 'resume';
    }
    function restoreOrig(orig) {
        if (!orig) return;
        C.nodes.push(orig);
        C.render();
    }
    function penDown(ev) {
        var w = C.screenToWorld(ev.clientX, ev.clientY);
        var resumed = false;
        if (!pen) {
            var r = penEdit(ev, w);
            if (r === 'handled') return;
            resumed = r === 'resume';
            if (!resumed) pen = { pts: [] };
        }
        var pts = pen.pts;
        var closeHit = !resumed && pts.length > 1 && Math.hypot(w.x - pts[0].x, w.y - pts[0].y) < 10 / C.view.scale;
        var p = closeHit ? pts[0] : resumed ? pts[pts.length - 1] : { x: w.x, y: w.y, ix: 0, iy: 0, ox: 0, oy: 0, sm: false };
        if (!closeHit && !resumed) pts.push(p);
        var moved = false;
        penDragging = true;
        function mv(e) {
            var m = C.screenToWorld(e.clientX, e.clientY);
            var dx = m.x - p.x, dy = m.y - p.y;
            if (!moved && Math.hypot(dx, dy) * C.view.scale > 3) moved = true;
            if (moved) { p.sm = true; p.ox = dx; p.oy = dy; p.ix = -dx; p.iy = -dy; }
            drawPen(null);
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            penDragging = false;
            if (closeHit) { finishPen(true); return; }
            drawPen(null);
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        drawPen(null);
    }
    function drawPen(cur) {
        clearOv();
        if (!pen || !pen.pts.length) return;
        var pts = pen.pts;
        var d = pathD(pts, false);
        if (cur) d += seg(pts[pts.length - 1], { x: cur.x, y: cur.y, ix: 0, iy: 0 });
        ovPaintPreview(d, 0.3, pen.keep);  // 실제 면/선으로 미리보기 (이어 그리기는 원본 색 유지)
        ovPath(d, '#2d8b8b', true);      // 작업선
        var last = pts[pts.length - 1];
        if (last.sm) {
            ovHandle(last.x, last.y, last.x + last.ix, last.y + last.iy, '');
            ovHandle(last.x, last.y, last.x + last.ox, last.y + last.oy, '');
        }
        pts.forEach(function (p, i) { ovAnchor(p.x, p.y, null, i === pts.length - 1); });
    }
    function finishPen(closed) {
        var pts = pen && pen.pts, keep = pen && pen.keep, orig = pen && pen.orig;
        pen = null; clearOv();
        if (!pts || pts.length < 2) { restoreOrig(orig); return; }
        createPathNode(pts, closed, keep);
    }
    function endPen(commit) {
        if (!pen) return;
        var pts = pen.pts, keep = pen.keep, orig = pen.orig;
        pen = null; clearOv();
        if (commit && pts.length > 1) createPathNode(pts, false, keep);
        else restoreOrig(orig);
    }
    function createPathNode(pts, closed, keep) {
        var minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
        pts.forEach(function (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        var w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
        var rel = pts.map(function (p) { return { x: p.x - minX, y: p.y - minY, ix: p.ix, iy: p.iy, ox: p.ox, oy: p.oy, sm: !!p.sm }; });
        var n = {
            id: keep ? keep.id : C.uid('n'), type: 'path', x: minX, y: minY, width: w, height: h, vw: w, vh: h,
            points: rel, closed: !!closed,
            fill: keep ? keep.fill : paint.fill, stroke: keep ? keep.stroke : paint.stroke,
            strokeWidth: keep ? keep.width : paint.width
        };
        C.nodes.push(n);
        C.markDirty(); C.render(); C.selectOne(n.id);
        if (mode === 'pen' || mode === 'direct') { ds.node = n; ds.sel = -1; ds.cps = {}; drawAnchors(); } // 완료 즉시 앵커 편집 가능
    }

    // ───────── 도형 도구 (사각형/원) ─────────
    function shapeDown(ev) {
        var kind = mode, a = C.screenToWorld(ev.clientX, ev.clientY);
        function mk(e) {
            var b = C.screenToWorld(e.clientX, e.clientY);
            var w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
            if (e.shiftKey) { var s = Math.max(w, h); w = h = s; }
            var x0 = b.x < a.x ? a.x - w : a.x, y0 = b.y < a.y ? a.y - h : a.y;
            return { x: x0, y: y0, w: w, h: h };
        }
        function mv(e) {
            var r = mk(e); clearOv();
            var d = shapeOutline(kind, r);
            ovPaintPreview(d);           // 실제 면/선/굵기로 라이브 미리보기
            ovPath(d, '#2d8b8b', true);
        }
        function up(e) {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            clearOv();
            var r = mk(e); if (r.w < 2 || r.h < 2) return;
            var n = shapeNode(kind, r);
            C.nodes.push(n);
            C.markDirty(); C.render(); C.selectOne(n.id);
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function shapeOutline(kind, r) {
        var n = shapeNode(kind, r);
        return pathD(n.points.map(function (p) { return { x: p.x + r.x, y: p.y + r.y, ix: p.ix, iy: p.iy, ox: p.ox, oy: p.oy }; }), true);
    }
    function pt(x, y) { return { x: x, y: y, ix: 0, iy: 0, ox: 0, oy: 0, sm: false }; }
    function shapeNode(kind, r) {
        var pts;
        if (kind === 'rect') {
            pts = [pt(0, 0), pt(r.w, 0), pt(r.w, r.h), pt(0, r.h)];
        } else {
            var k = 0.5522847, cx = r.w / 2, cy = r.h / 2, hx = cx * k, hy = cy * k;
            pts = [
                { x: cx, y: 0, ix: -hx, iy: 0, ox: hx, oy: 0, sm: true },
                { x: r.w, y: cy, ix: 0, iy: -hy, ox: 0, oy: hy, sm: true },
                { x: cx, y: r.h, ix: hx, iy: 0, ox: -hx, oy: 0, sm: true },
                { x: 0, y: cy, ix: 0, iy: hy, ox: 0, oy: -hy, sm: true }
            ];
        }
        return {
            id: C.uid('n'), type: 'path', x: r.x, y: r.y, width: r.w, height: r.h, vw: r.w, vh: r.h,
            points: pts, closed: true, fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.width
        };
    }

    // ───────── 회전 (선택 도구, 단일 선택 시 위쪽 핸들) ─────────
    function rotDeg(n) { return +n.rotate || 0; }
    function drawSelUI(tempDeg) {
        if (mode !== 'select') return;
        clearOv();
        var ids = Object.keys(C.selNodes);
        if (ids.length !== 1) return;
        var n = C.nodeById(ids[0]);
        if (!n || n.type === 'group') return;
        var w = n.width || 250, h = n.height || 60;
        var cx = n.x + w / 2, cy = n.y + h / 2;
        var a = (tempDeg != null ? tempDeg : rotDeg(n)) * Math.PI / 180;
        var dist = h / 2 + 26 / C.view.scale;
        var hx = cx + Math.sin(a) * dist, hy = cy - Math.cos(a) * dist;
        var tx = cx + Math.sin(a) * (h / 2), ty = cy - Math.cos(a) * (h / 2);
        ovEl('line', { x1: tx, y1: ty, x2: hx, y2: hy, stroke: '#2d8b8b', 'stroke-width': 1 / C.view.scale });
        var c = ovEl('circle', { cx: hx, cy: hy, r: 5 / C.view.scale, fill: '#fff', stroke: '#2d8b8b', 'stroke-width': 1.4 / C.view.scale });
        c.style.pointerEvents = 'auto'; c.style.cursor = 'grab';
        c.dataset.vecRotate = n.id;
        // 코너 라운드 핸들 (카드 노드만 — 패스는 앵커가 담당)
        if (n.type !== 'path') drawRadiusHandle(n, a, cx, cy, w, h);
    }
    // ── 코너 라운드 (일러스트레이터식: 좌상단 코너 점을 드래그해 반경 조절) ──
    function drawRadiusHandle(n, a, cx, cy, w, h) {
        var maxr = Math.min(w, h) / 2;
        var rad = Math.max(0, Math.min(maxr, +n.radius || 0));
        var inset = Math.max(rad, 16 / C.view.scale);   // r=0이어도 잡히도록 최소 표시 거리
        var lx = -w / 2 + inset, ly = -h / 2 + inset;    // 좌상단 코너에서 안쪽 대각선
        var ca = Math.cos(a), sa = Math.sin(a);
        var hx = cx + lx * ca - ly * sa, hy = cy + lx * sa + ly * ca;
        var c = ovEl('circle', { cx: hx, cy: hy, r: 4.5 / C.view.scale, fill: '#fff', stroke: '#e0913a', 'stroke-width': 1.6 / C.view.scale });
        c.style.pointerEvents = 'auto'; c.style.cursor = 'nwse-resize';
        c.dataset.vecRadius = n.id;
    }
    function radiusDrag(n, ev) {
        var w = n.width || 250, h = n.height || 60, cx = n.x + w / 2, cy = n.y + h / 2;
        var a = rotDeg(n) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        var maxr = Math.min(w, h) / 2;
        var el = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"]');
        function mv(e) {
            var m = C.screenToWorld(e.clientX, e.clientY), dx = m.x - cx, dy = m.y - cy;
            var lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;   // 월드 → 노드 로컬 (역회전)
            var ix = lx + w / 2, iy = ly + h / 2;                  // 좌상단 코너로부터 안쪽 거리
            var r = Math.max(0, Math.min(maxr, (ix + iy) / 2));
            n.radius = Math.round(r);
            if (el) el.style.borderRadius = n.radius + 'px';
            drawSelUI();
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            if (!n.radius) delete n.radius;                        // 0이면 속성 제거(기본 사각형)
            C.markDirty(); C.render(); drawSelUI();
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function rotateDrag(n, ev) {
        var w = n.width || 250, h = n.height || 60;
        var cx = n.x + w / 2, cy = n.y + h / 2;
        var m0 = C.screenToWorld(ev.clientX, ev.clientY);
        var a0 = Math.atan2(m0.x - cx, -(m0.y - cy)) * 180 / Math.PI;
        var r0 = rotDeg(n), cur = r0;
        var el = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"]');
        function mv(e) {
            var m = C.screenToWorld(e.clientX, e.clientY);
            var a1 = Math.atan2(m.x - cx, -(m.y - cy)) * 180 / Math.PI;
            cur = r0 + (a1 - a0);
            if (e.shiftKey) cur = Math.round(cur / 15) * 15;   // Shift = 15도 스냅
            cur = ((cur % 360) + 360) % 360;
            if (el) { el.style.transform = cur ? 'rotate(' + cur + 'deg)' : ''; el.style.transformOrigin = '50% 50%'; }
            drawSelUI(cur);
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            cur = Math.round(cur * 10) / 10;
            if (n.type === 'path') { bakeRotation(n, cur - r0); } // 패스는 점에 굽기 (직접선택과 일치)
            else if (cur) n.rotate = cur; else delete n.rotate;
            C.markDirty(); C.render(); drawSelUI();
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    // 패스 회전을 앵커/핸들 좌표에 직접 적용 (CSS 회전 대신)
    function bakeRotation(n, deg) {
        if (!deg) return;
        var rad = deg * Math.PI / 180, ca = Math.cos(rad), sa = Math.sin(rad);
        var k = p2w(n);
        var cx = (n.vw || 1) / 2 * k.x, cy = (n.vh || 1) / 2 * k.y;
        n.points.forEach(function (p) {
            var x = p.x * k.x - cx, y = p.y * k.y - cy;
            var ix = p.ix * k.x, iy = p.iy * k.y, ox = p.ox * k.x, oy = p.oy * k.y;
            p.x = (x * ca - y * sa) + cx; p.y = (x * sa + y * ca) + cy;
            p.ix = ix * ca - iy * sa; p.iy = ix * sa + iy * ca;
            p.ox = ox * ca - oy * sa; p.oy = ox * sa + oy * ca;
        });
        n.vw = Math.max(1, n.width || 1); n.vh = Math.max(1, n.height || 1);
        rebbox(n);
        var el = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"]');
        if (el) el.style.transform = '';
    }

    // ───────── 레이어 순서 ─────────
    function reorder(kind) {
        var sel = C.selNodes, ns = C.nodes;
        var picked = ns.filter(function (n) { return sel[n.id]; });
        if (!picked.length) { C.toast('순서를 바꿀 노드를 선택하세요'); return; }
        var arr;
        if (kind === 'front') arr = ns.filter(function (n) { return !sel[n.id]; }).concat(picked);
        else if (kind === 'back') arr = picked.concat(ns.filter(function (n) { return !sel[n.id]; }));
        else {
            arr = ns.slice();
            if (kind === 'fwd') { for (var i = arr.length - 2; i >= 0; i--) if (sel[arr[i].id] && !sel[arr[i + 1].id]) { var t = arr[i]; arr[i] = arr[i + 1]; arr[i + 1] = t; } }
            else { for (var j = 1; j < arr.length; j++) if (sel[arr[j].id] && !sel[arr[j - 1].id]) { var t2 = arr[j]; arr[j] = arr[j - 1]; arr[j - 1] = t2; } }
        }
        C.nodes = arr;
        C.markDirty(); C.render();
    }

    // ───────── 직접 선택 (앵커 편집) ─────────
    // node/sel = 활성 패스의 앵커 핸들 편집용, cps = 오브젝트 횡단 제어점 선택집합(키 = id|kind)
    var ds = { node: null, sel: -1, cps: {} };
    function exitDirect() { ds.node = null; ds.sel = -1; ds.cps = {}; clearOv(); }
    function cpKey(id, kind) { return id + '|' + kind; }
    // 제어점: 박스(패스 아님)는 네 모서리(tl/tr/bl/br), 패스는 앵커(index). 그룹은 박스처럼 프레임 조정 가능, 아트보드(16:9 고정)·잠금은 제외.
    function cpList(n) {
        if (n.locked || n.type === 'artboard') return [];
        if (n.type === 'path') {
            var k = p2w(n);
            return n.points.map(function (p, i) { return { id: n.id, kind: i, x: n.x + p.x * k.x, y: n.y + p.y * k.y }; });
        }
        var w = n.width || 250, h = n.height || 60;
        return [
            { id: n.id, kind: 'tl', x: n.x, y: n.y }, { id: n.id, kind: 'tr', x: n.x + w, y: n.y },
            { id: n.id, kind: 'bl', x: n.x, y: n.y + h }, { id: n.id, kind: 'br', x: n.x + w, y: n.y + h }
        ];
    }
    function cpPos(n, kind) {
        if (!n) return null;
        if (n.type === 'path') { if (typeof kind !== 'number' || !n.points[kind]) return null; var k = p2w(n), p = n.points[kind]; return { x: n.x + p.x * k.x, y: n.y + p.y * k.y }; }
        var w = n.width || 250, h = n.height || 60;
        if (kind === 'tl') return { x: n.x, y: n.y };
        if (kind === 'tr') return { x: n.x + w, y: n.y };
        if (kind === 'bl') return { x: n.x, y: n.y + h };
        if (kind === 'br') return { x: n.x + w, y: n.y + h };
        return null;
    }
    function anchorSelected(i) { return !!ds.node && !!ds.cps[cpKey(ds.node.id, i)]; }
    function selectAnchor(i) { ds.cps = {}; ds.cps[cpKey(ds.node.id, i)] = { id: ds.node.id, kind: i }; ds.sel = i; }
    function toggleAnchorSel(i) {
        var key = cpKey(ds.node.id, i);
        if (ds.cps[key]) { delete ds.cps[key]; if (ds.sel === i) ds.sel = -1; }
        else { ds.cps[key] = { id: ds.node.id, kind: i }; ds.sel = i; }
        drawAnchors();
    }
    function livePath() {
        var n = ds.node; if (!n) return;
        var el = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"] path');
        if (el) el.setAttribute('d', pathD(n.points, n.closed));
    }
    function drawAnchors() {
        clearOv();
        var n = ds.node;
        if (n && n.type === 'path') {
            var k = p2w(n);
            n.points.forEach(function (p, i) {
                var wx = n.x + p.x * k.x, wy = n.y + p.y * k.y;
                if (i === ds.sel) {
                    if (p.ix || p.iy) ovHandle(wx, wy, n.x + (p.x + p.ix) * k.x, n.y + (p.y + p.iy) * k.y, i + ':in');
                    if (p.ox || p.oy) ovHandle(wx, wy, n.x + (p.x + p.ox) * k.x, n.y + (p.y + p.oy) * k.y, i + ':out');
                }
                ovAnchor(wx, wy, i, i === ds.sel || anchorSelected(i));
            });
        }
        // 활성 패스 밖의 선택 제어점(박스 모서리·다른 패스 앵커)은 드래그 가능한 채움 사각형으로
        Object.keys(ds.cps).forEach(function (key) {
            var cp = ds.cps[key];
            if (n && n.type === 'path' && cp.id === n.id) return; // 위에서 이미 그림
            var pos = cpPos(C.nodeById(cp.id), cp.kind);
            if (pos) ovCp(pos.x, pos.y, key);
        });
    }
    // 앵커 이동/삭제 후 바운딩 박스 재계산 (점들을 0 원점으로 이동)
    function rebbox(n) {
        var pts = n.points; if (!pts.length) return;
        var k = p2w(n);
        var minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
        pts.forEach(function (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        pts.forEach(function (p) { p.x -= minX; p.y -= minY; });
        n.x += minX * k.x; n.y += minY * k.y;
        n.width = Math.max(1, (maxX - minX) * k.x); n.height = Math.max(1, (maxY - minY) * k.y);
        n.vw = Math.max(1, maxX - minX); n.vh = Math.max(1, maxY - minY);
    }
    function directDown(ev) {
        var t = ev.target;
        if (t.dataset && t.dataset.vecCp) {                     // 횡단 제어점(박스 모서리·타 패스 앵커) 드래그
            if (ev.shiftKey) { if (ds.cps[t.dataset.vecCp]) { delete ds.cps[t.dataset.vecCp]; syncDsAfterCps(); drawAnchors(); } return; } // Shift+클릭 = 선택 제외
            dragCPs(ev); return;
        }
        if (t.dataset && t.dataset.vecAnchor != null && ds.node) {
            var ai = +t.dataset.vecAnchor;
            if (ev.altKey) { altAnchorDown(ai, ev); return; }   // Alt+드래그=핸들 생성, 그대로 떼면=앵커 삭제
            if (ev.shiftKey) { toggleAnchorSel(ai); return; }   // Shift=다중 선택 토글 (이동 X)
            if (!anchorSelected(ai)) selectAnchor(ai);          // 선택 안 된 앵커 클릭=단독 선택
            ds.sel = ai;
            dragAnchor(ai, ev);                                 // 드래그=선택된 앵커 전체 이동(변형)
            return;
        }
        if (t.dataset && t.dataset.vecHandle && ds.node) {
            if (ev.altKey) { removeHandle(t.dataset.vecHandle); return; }  // Alt+클릭=한쪽 핸들 삭제
            dragHandle(t.dataset.vecHandle, ev); return;
        }
        // 라인(엣지) 클릭 선택 — 직접선택툴로 연결선 선택(Shift=다중 토글) → Delete로 삭제
        var edgeEl = t.closest ? t.closest('.cedge') : null;
        if (edgeEl && edgeEl.dataset && edgeEl.dataset.id) { exitDirect(); C.selectEdge(edgeEl.dataset.id, ev.shiftKey); return; }
        var wpt = C.screenToWorld(ev.clientX, ev.clientY);
        var ne = t.closest ? t.closest('.cnode') : null;
        if (ne) {
            var n = C.nodeById(ne.dataset.id);
            if (n && n.type === 'path' && !n.locked && !ev.shiftKey) {   // Shift는 아래 마퀴(추가 선택)로 흘려보낸다
                ds.node = n; ds.sel = -1; ds.cps = {}; C.selectOne(n.id);
                if (ev.altKey) {  // Alt+클릭(선분) = 모양을 유지하며 앵커 추가, 바로 드래그 가능
                    var hit = segHit(n, wpt);
                    if (hit) { var ni = insertAnchor(n, hit); livePath(); dragAnchor(ni, ev); return; }
                }
                drawAnchors();
                dragNodeBody(n, ev); // 패스 몸체 드래그 = 오브젝트 전체 이동
                return;
            }
        }
        // DOM이 못 잡은 얇은 선도 기하 판정(8px 허용오차)으로 집는다 — 면 없는 패스 편집의 핵심 (Shift면 건너뛰고 마퀴로)
        var ghit = ev.shiftKey ? null : pathHitAll(wpt);
        if (ghit) {
            ds.node = ghit.n; ds.sel = -1; ds.cps = {}; C.selectOne(ghit.n.id);
            if (ev.altKey) { var ni2 = insertAnchor(ghit.n, ghit); livePath(); dragAnchor(ni2, ev); return; }
            drawAnchors();
            dragNodeBody(ghit.n, ev);
            return;
        }
        cpMarquee(ev); // 빈 곳/박스 위에서 드래그 = 오브젝트 횡단 제어점 마퀴 (클릭만 하면 선택 해제)
    }
    // ds.cps 집합으로부터 활성 패스(단일 패스면)·강조 객체(C.selNodes)를 재계산
    function syncDsAfterCps() {
        var ids = {};
        Object.keys(ds.cps).forEach(function (key) { ids[ds.cps[key].id] = true; });
        var idList = Object.keys(ids);
        var only = idList.length === 1 ? C.nodeById(idList[0]) : null;
        ds.node = (only && only.type === 'path') ? only : null; ds.sel = -1;
        C.selNodes = {}; idList.forEach(function (id) { C.selNodes[id] = true; }); C.refreshSel();
    }
    // 드래그 박스로 모든 오브젝트의 제어점(박스 모서리·패스 앵커)을 선택. Shift = 기존 선택에 추가(합집합).
    function cpMarquee(ev) {
        var add = ev.shiftKey;
        var s = C.screenToWorld(ev.clientX, ev.clientY);
        var rect = null, moved = false;
        var box = ovEl('rect', { x: s.x, y: s.y, width: 0, height: 0, fill: 'rgba(45,139,139,0.12)', stroke: '#2d8b8b', 'stroke-width': 1 / C.view.scale, 'stroke-dasharray': (3 / C.view.scale) + ' ' + (3 / C.view.scale) });
        function mv(e) {
            if (!moved && Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) > 3) moved = true;
            var w = C.screenToWorld(e.clientX, e.clientY);
            var x0 = Math.min(s.x, w.x), y0 = Math.min(s.y, w.y), bw = Math.abs(w.x - s.x), bh = Math.abs(w.y - s.y);
            rect = { x: x0, y: y0, w: bw, h: bh };
            box.setAttribute('x', x0); box.setAttribute('y', y0); box.setAttribute('width', bw); box.setAttribute('height', bh);
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            if (!moved || !rect) {
                if (add) { drawAnchors(); }                          // Shift+클릭 = 현재 선택 유지
                else { exitDirect(); C.clearSel(); C.refreshSel(); } // 단순 클릭 = 선택 해제
                return;
            }
            if (!add) ds.cps = {};                                   // Shift 아니면 새로 선택, Shift면 합집합
            C.nodes.forEach(function (n) {
                cpList(n).forEach(function (cp) {
                    if (cp.x >= rect.x && cp.x <= rect.x + rect.w && cp.y >= rect.y && cp.y <= rect.y + rect.h) { ds.cps[cpKey(cp.id, cp.kind)] = { id: cp.id, kind: cp.kind }; }
                });
            });
            // 제어점이 하나도 안 잡히면 영역을 지나는 라인(엣지)을 모두 선택 (드래그로 라인 다중 선택, Shift=추가)
            if (!Object.keys(ds.cps).length) {
                var eh = C.edgesInRect(rect);
                if (eh.length) { exitDirect(); C.selectEdges(eh, add); return; }
            }
            syncDsAfterCps();   // 선택 제어점이 한 패스에만 속하면 그 패스를 활성화(핸들/삭제 편집 가능)
            drawAnchors();
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    // 모든 패스를 위에서부터 기하 판정 — {n, i, t} 반환
    function pathHitAll(w) {
        for (var i = C.nodes.length - 1; i >= 0; i--) {
            var n = C.nodes[i];
            if (n.type !== 'path' || n.locked) continue;
            var hit = segHit(n, w);
            if (hit) return { n: n, i: hit.i, t: hit.t };
        }
        return null;
    }
    // 세그먼트의 베지어 점 (패스 좌표)
    function bezPt(a, b, t) {
        var mt = 1 - t, w0 = mt * mt * mt, w1 = 3 * mt * mt * t, w2 = 3 * mt * t * t, w3 = t * t * t;
        return {
            x: w0 * a.x + w1 * (a.x + a.ox) + w2 * (b.x + b.ix) + w3 * b.x,
            y: w0 * a.y + w1 * (a.y + a.oy) + w2 * (b.y + b.iy) + w3 * b.y
        };
    }
    // 클릭 지점에서 가장 가까운 세그먼트·t 찾기 (월드 좌표 기준 허용오차 8px/줌)
    function segHit(n, w) {
        var pts = n.points, len = pts.length, k = p2w(n);
        var segs = n.closed ? len : len - 1;
        var tol = 8 / C.view.scale, best = null;
        for (var i = 0; i < segs; i++) {
            var a = pts[i], b = pts[(i + 1) % len];
            for (var s = 1; s < 32; s++) {
                var t = s / 32, q = bezPt(a, b, t);
                var d = Math.hypot(n.x + q.x * k.x - w.x, n.y + q.y * k.y - w.y);
                if (d < tol) { tol = d; best = { i: i, t: t }; }
            }
        }
        return best;
    }
    // 드 카스텔조 분할 — 곡선 모양을 그대로 유지하며 앵커 삽입, 새 앵커 인덱스 반환
    function insertAnchor(n, hit) {
        var pts = n.points, len = pts.length;
        var a = pts[hit.i], b = pts[(hit.i + 1) % len], t = hit.t;
        function lp(p, q) { return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }
        var P0 = { x: a.x, y: a.y }, C1 = { x: a.x + a.ox, y: a.y + a.oy }, C2 = { x: b.x + b.ix, y: b.y + b.iy }, P3 = { x: b.x, y: b.y };
        var Q0 = lp(P0, C1), Q1 = lp(C1, C2), Q2 = lp(C2, P3);
        var R0 = lp(Q0, Q1), R1 = lp(Q1, Q2), S = lp(R0, R1);
        a.ox = Q0.x - a.x; a.oy = Q0.y - a.y;
        b.ix = Q2.x - b.x; b.iy = Q2.y - b.y;
        var np = { x: S.x, y: S.y, ix: R0.x - S.x, iy: R0.y - S.y, ox: R1.x - S.x, oy: R1.y - S.y, sm: true };
        pts.splice(hit.i + 1, 0, np);
        ds.sel = hit.i + 1;
        ds.cps = {}; ds.cps[cpKey(n.id, hit.i + 1)] = { id: n.id, kind: hit.i + 1 }; // 삽입으로 인덱스가 밀리므로 새 앵커로 초기화
        return hit.i + 1;
    }
    // Alt+앵커: 드래그하면 대칭 핸들을 새로 뽑고(뾰족점→곡선), 움직임 없이 떼면 앵커 삭제
    function altAnchorDown(i, ev) {
        var n = ds.node, p = n.points[i], k = w2p(n);
        ds.sel = i; drawAnchors();
        var sx = ev.clientX, sy = ev.clientY, moved = false;
        function mv(e) {
            if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 3) moved = true;
            if (!moved) return;
            var w = C.screenToWorld(e.clientX, e.clientY);
            var hx = (w.x - n.x) * k.x - p.x, hy = (w.y - n.y) * k.y - p.y;
            p.ox = hx; p.oy = hy; p.ix = -hx; p.iy = -hy; p.sm = true;
            livePath(); drawAnchors();
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            if (!moved) { removeAnchor(n, i); return; }
            C.markDirty(); C.render(); drawAnchors();
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    // 한쪽 핸들만 제거 (Alt+핸들 클릭)
    function removeHandle(spec) {
        var parts = spec.split(':'), i = +parts[0], side = parts[1];
        var n = ds.node, p = n.points[i];
        if (side === 'out') { p.ox = 0; p.oy = 0; } else { p.ix = 0; p.iy = 0; }
        p.sm = false;
        ds.sel = i;
        C.markDirty(); C.render(); drawAnchors();
    }
    function dragNodeBody(n, ev) {
        var sx0 = ev.clientX, sy0 = ev.clientY, ox = n.x, oy = n.y, moved = false;
        var el = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"]');
        function mv(e) {
            var dx = (e.clientX - sx0) / C.view.scale, dy = (e.clientY - sy0) / C.view.scale;
            if (!moved && Math.hypot(e.clientX - sx0, e.clientY - sy0) > 2) moved = true;
            if (!moved) return;
            n.x = ox + dx; n.y = oy + dy;
            if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
            C.renderEdges(); drawAnchors();
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            if (moved) { C.markDirty(); C.render(); drawAnchors(); }
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function dragAnchor(i, ev) {
        var n = ds.node;
        ds.sel = i;
        if (!anchorSelected(i)) { ds.cps = {}; ds.cps[cpKey(n.id, i)] = { id: n.id, kind: i }; }
        drawAnchors();
        dragCPs(ev); // 선택된 제어점(이 패스의 앵커 + 다른 오브젝트)을 함께 이동/변형
    }
    function livePathOf(n) {
        var el = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"] path');
        if (el) el.setAttribute('d', pathD(n.points, n.closed));
    }
    // 박스 모서리 드래그/넛지: 선택된 변을 시작값(o*) 기준 delta만큼 리사이즈(양변 다 선택=통째 이동)
    function applyBoxDrag(sn, dx, dy) {
        var n = sn.n;
        if (sn.left && sn.right) n.x = sn.x + dx;
        else if (sn.right) { n.width = Math.max(8, sn.w + dx); n.x = sn.x; }
        else if (sn.left) { var nw = sn.w - dx; if (nw < 8) nw = 8; n.x = sn.x + (sn.w - nw); n.width = nw; }
        if (sn.top && sn.bot) n.y = sn.y + dy;
        else if (sn.bot) { n.height = Math.max(8, sn.h + dy); n.y = sn.y; }
        else if (sn.top) { var nh = sn.h - dy; if (nh < 8) nh = 8; n.y = sn.y + (sn.h - nh); n.height = nh; }
        var el = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"]');
        if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; el.style.width = n.width + 'px'; el.style.height = n.height + 'px'; }
    }
    // 선택 제어점들을 노드별로 묶어 스냅샷 (패스=앵커 원좌표, 박스=원래 사각형+선택 변)
    function snapCPs() {
        var byNode = {};
        Object.keys(ds.cps).forEach(function (key) { var cp = ds.cps[key]; (byNode[cp.id] = byNode[cp.id] || { kinds: [] }).kinds.push(cp.kind); });
        return Object.keys(byNode).map(function (id) {
            var n = C.nodeById(id); if (!n) return null; var kinds = byNode[id].kinds;
            if (n.type === 'path') return { n: n, path: true, k: w2p(n), orig: kinds.filter(function (i) { return typeof i === 'number' && n.points[i]; }).map(function (i) { return { i: i, x: n.points[i].x, y: n.points[i].y }; }) };
            return { n: n, path: false, x: n.x, y: n.y, w: n.width || 250, h: n.height || 60,
                left: kinds.indexOf('tl') >= 0 || kinds.indexOf('bl') >= 0, right: kinds.indexOf('tr') >= 0 || kinds.indexOf('br') >= 0,
                top: kinds.indexOf('tl') >= 0 || kinds.indexOf('tr') >= 0, bot: kinds.indexOf('bl') >= 0 || kinds.indexOf('br') >= 0 };
        }).filter(Boolean);
    }
    // 선택된 제어점(앵커/모서리)을 드래그로 이동 → 선택 안 된 앵커는 고정, 연결 선분만 따라 움직인다
    function dragCPs(ev) {
        var snaps = snapCPs(); if (!snaps.length) return;
        var s = C.screenToWorld(ev.clientX, ev.clientY);
        function mv(e) {
            var w = C.screenToWorld(e.clientX, e.clientY), dx = w.x - s.x, dy = w.y - s.y;
            snaps.forEach(function (sn) {
                if (sn.path) { sn.orig.forEach(function (o) { var p = sn.n.points[o.i]; p.x = o.x + dx * sn.k.x; p.y = o.y + dy * sn.k.y; }); livePathOf(sn.n); }
                else applyBoxDrag(sn, dx, dy);
            });
            C.renderEdges(); drawAnchors();
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            snaps.forEach(function (sn) { if (sn.path) rebbox(sn.n); });
            C.markDirty(); C.render(); drawAnchors();
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    // 방향키로 선택 제어점을 dx,dy(월드)만큼 이동
    function nudgeBoxEdges(n, kinds, dx, dy) {
        var left = kinds.indexOf('tl') >= 0 || kinds.indexOf('bl') >= 0, right = kinds.indexOf('tr') >= 0 || kinds.indexOf('br') >= 0;
        var top = kinds.indexOf('tl') >= 0 || kinds.indexOf('tr') >= 0, bot = kinds.indexOf('bl') >= 0 || kinds.indexOf('br') >= 0;
        if (dx) { if (left && right) n.x += dx; else if (right) n.width = Math.max(8, (n.width || 250) + dx); else if (left) { var nw = (n.width || 250) - dx; if (nw >= 8) { n.x += dx; n.width = nw; } } }
        if (dy) { if (top && bot) n.y += dy; else if (bot) n.height = Math.max(8, (n.height || 60) + dy); else if (top) { var nh = (n.height || 60) - dy; if (nh >= 8) { n.y += dy; n.height = nh; } } }
    }
    function nudgeCPs(dx, dy) {
        var keys = Object.keys(ds.cps); if (!keys.length) return false;
        var byNode = {};
        keys.forEach(function (key) { var cp = ds.cps[key]; (byNode[cp.id] = byNode[cp.id] || { kinds: [] }).kinds.push(cp.kind); });
        Object.keys(byNode).forEach(function (id) {
            var n = C.nodeById(id); if (!n) return; var kinds = byNode[id].kinds;
            if (n.type === 'path') { var k = w2p(n); kinds.forEach(function (i) { var p = n.points[i]; if (p) { p.x += dx * k.x; p.y += dy * k.y; } }); rebbox(n); }
            else nudgeBoxEdges(n, kinds, dx, dy);
        });
        C.markDirty(); C.render(); drawAnchors();
        return true;
    }
    function dragHandle(spec, ev) {
        var parts = spec.split(':'), i = +parts[0], side = parts[1];
        var n = ds.node, p = n.points[i], k = w2p(n);
        function mv(e) {
            var w = C.screenToWorld(e.clientX, e.clientY);
            var hx = (w.x - n.x) * k.x - p.x, hy = (w.y - n.y) * k.y - p.y;
            if (e.altKey) p.sm = false; // Alt = 핸들 분리(코너화)
            if (side === 'out') { p.ox = hx; p.oy = hy; if (p.sm) { p.ix = -hx; p.iy = -hy; } }
            else { p.ix = hx; p.iy = hy; if (p.sm) { p.ox = -hx; p.oy = -hy; } }
            livePath(); drawAnchors();
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            C.markDirty(); C.render(); drawAnchors();
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function toggleAnchorType(i) {
        var n = ds.node; if (!n) return;
        var p = n.points[i], len = n.points.length;
        if (p.ix || p.iy || p.ox || p.oy) { p.ix = p.iy = p.ox = p.oy = 0; p.sm = false; }
        else {
            var prev = n.points[(i - 1 + len) % len], next = n.points[(i + 1) % len];
            var dx = (next.x - prev.x) / 4, dy = (next.y - prev.y) / 4;
            p.ox = dx; p.oy = dy; p.ix = -dx; p.iy = -dy; p.sm = true;
        }
        ds.sel = i;
        C.markDirty(); C.render(); drawAnchors();
    }
    function removeAnchor(n, i) {
        n.points.splice(i, 1);
        if (ds.node === n) ds.sel = -1;
        if (n.points.length < 2) {
            C.nodes = C.nodes.filter(function (x) { return x.id !== n.id; });
            C.edges = C.edges.filter(function (ed) { return ed.fromNode !== n.id && ed.toNode !== n.id; });
            if (ds.node === n) exitDirect();
        } else rebbox(n);
        C.markDirty(); C.render();
        if (ds.node) drawAnchors();
    }
    function deleteAnchor() {
        var n = ds.node; if (!n || n.type !== 'path') return false;
        var idxs = Object.keys(ds.cps).map(function (kk) { return ds.cps[kk]; })
            .filter(function (cp) { return cp.id === n.id && typeof cp.kind === 'number' && cp.kind < n.points.length; })
            .map(function (cp) { return cp.kind; });
        if (!idxs.length) { if (ds.sel < 0) return false; idxs = [ds.sel]; }
        if (idxs.length === 1) { removeAnchor(n, idxs[0]); return true; }
        idxs.sort(function (a, b) { return b - a; }); // 높은 인덱스부터 제거
        if (n.points.length - idxs.length < 2) {       // 2점 미만으로 남으면 패스 자체 삭제
            C.nodes = C.nodes.filter(function (x) { return x.id !== n.id; });
            C.edges = C.edges.filter(function (ed) { return ed.fromNode !== n.id && ed.toNode !== n.id; });
            exitDirect(); C.markDirty(); C.render(); return true;
        }
        idxs.forEach(function (j) { n.points.splice(j, 1); });
        ds.cps = {}; ds.sel = -1;
        rebbox(n); C.markDirty(); C.render(); drawAnchors();
        return true;
    }
    // 직접선택 모드 + 제어점 2개 이상 선택 시, 노드가 아닌 '선택 제어점'을 정렬
    function cpAlignActive() { return mode === 'direct' && Object.keys(ds.cps).length >= 2; }
    function alignCPs(am) {
        var keys = Object.keys(ds.cps);
        if (keys.length < 2) { C.toast('제어점을 2개 이상 선택하세요'); return; }
        var items = keys.map(function (key) { var cp = ds.cps[key], n = C.nodeById(cp.id), pos = cpPos(n, cp.kind); return (n && pos) ? { id: cp.id, kind: cp.kind, n: n, x: pos.x, y: pos.y } : null; }).filter(Boolean);
        if (items.length < 2) return;
        var minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
        items.forEach(function (c) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); });
        var horiz = (am === 'left' || am === 'right' || am === 'centerH');
        var target = am === 'left' ? minX : am === 'right' ? maxX : am === 'centerH' ? (minX + maxX) / 2 : am === 'top' ? minY : am === 'bottom' ? maxY : (minY + maxY) / 2;
        var byNode = {};
        items.forEach(function (c) { (byNode[c.id] = byNode[c.id] || { n: c.n, kinds: [] }).kinds.push(c.kind); });
        Object.keys(byNode).forEach(function (id) {
            var n = byNode[id].n, kinds = byNode[id].kinds;
            if (n.type === 'path') alignPathAnchors(n, kinds, horiz, target);
            else alignBoxEdges(n, kinds, am, horiz, target);
        });
        C.markDirty(); C.render(); drawAnchors();
    }
    // 패스 앵커: 선택 앵커의 월드 x(또는 y)를 target 선으로 이동 (핸들은 상대 오프셋이라 함께 따라감)
    function alignPathAnchors(n, kinds, horiz, target) {
        var k = w2p(n);
        kinds.forEach(function (i) { var p = n.points[i]; if (!p) return; if (horiz) p.x = (target - n.x) * k.x; else p.y = (target - n.y) * k.y; });
        rebbox(n);
    }
    // 박스 모서리: 선택된 변을 target으로 리사이즈. 한 변만 선택 → 그 변 이동, 양변 다 선택 → 박스 통째 이동
    function alignBoxEdges(n, kinds, am, horiz, target) {
        var w = n.width || 250, h = n.height || 60, MIN = 8;
        if (horiz) {
            var left = kinds.indexOf('tl') >= 0 || kinds.indexOf('bl') >= 0;
            var right = kinds.indexOf('tr') >= 0 || kinds.indexOf('br') >= 0;
            if (left && right) { n.x = (am === 'left') ? target : (am === 'right') ? target - w : target - w / 2; }
            else if (right) { n.width = Math.max(MIN, target - n.x); }
            else if (left) { var nx = Math.min(n.x + w - MIN, target); n.width = (n.x + w) - nx; n.x = nx; }
        } else {
            var top = kinds.indexOf('tl') >= 0 || kinds.indexOf('tr') >= 0;
            var bot = kinds.indexOf('bl') >= 0 || kinds.indexOf('br') >= 0;
            if (top && bot) { n.y = (am === 'top') ? target : (am === 'bottom') ? target - h : target - h / 2; }
            else if (bot) { n.height = Math.max(MIN, target - n.y); }
            else if (top) { var ny = Math.min(n.y + h - MIN, target); n.height = (n.y + h) - ny; n.y = ny; }
        }
    }
    C.setAlignInterceptor(function (am) { if (cpAlignActive()) { alignCPs(am); return true; } return false; });

    // ───────── 이벤트 연결 ─────────
    var UI_SEL = '.canvas-inspector, .canvas-help, .crop-layer, .canvas-topbar, .canvas-rail';
    stage.addEventListener('mousedown', function (ev) {
        if (cropping()) return;
        if (ev.button !== 0) return;                            // 가운데/오른쪽 버튼 = 코어(팬)
        if (stage.classList.contains('is-pan')) return;         // Space 팬 = 코어
        // 회전 핸들 (선택 도구에서도 동작)
        if (ev.target.dataset && ev.target.dataset.vecRotate) {
            var rn = C.nodeById(ev.target.dataset.vecRotate);
            if (rn) { ev.stopPropagation(); ev.preventDefault(); rotateDrag(rn, ev); return; }
        }
        // 코너 라운드 핸들 (선택 도구에서도 동작)
        if (ev.target.dataset && ev.target.dataset.vecRadius) {
            var radn = C.nodeById(ev.target.dataset.vecRadius);
            if (radn) { ev.stopPropagation(); ev.preventDefault(); radiusDrag(radn, ev); return; }
        }
        if (mode === 'select') return;
        if (ev.target.closest && ev.target.closest(UI_SEL)) return;
        if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT') return; // 편집 중 입력칸 클릭은 통과
        ev.stopPropagation(); ev.preventDefault();
        try { stage.focus({ preventScroll: true }); } catch (x) {}
        if (mode === 'pen') penDown(ev);
        else if (mode === 'rect' || mode === 'ellipse') shapeDown(ev);
        else if (mode === 'direct') directDown(ev);
    }, true);
    // 선택 도구에서 드래그/조작이 끝나면 회전 핸들 위치 갱신
    document.addEventListener('mouseup', function () {
        if (mode === 'select' && !cropping()) setTimeout(drawSelUI, 0);
    });
    stage.addEventListener('dblclick', function (ev) {
        if (mode === 'select' || cropping()) return;
        if (ev.target.closest && ev.target.closest(UI_SEL)) return;
        ev.stopImmediatePropagation(); ev.preventDefault();
        if (mode === 'pen' && pen) { if (pen.pts.length > 1) pen.pts.pop(); finishPen(false); }
        else if ((mode === 'direct' || mode === 'pen') && ev.target.dataset && ev.target.dataset.vecAnchor != null) toggleAnchorType(+ev.target.dataset.vecAnchor);
    }, true);
    stage.addEventListener('mousemove', function (ev) {
        if (mode === 'pen' && pen && pen.pts.length && !penDragging) drawPen(C.screenToWorld(ev.clientX, ev.clientY));
    });
    stage.addEventListener('wheel', function (ev) { // 줌(Ctrl/⌘+휠) 후에만 오버레이 크기 갱신 (팬은 오버레이가 월드와 함께 이동)
        if (!(ev.ctrlKey || ev.metaKey)) return;
        if (mode === 'direct' && (ds.node || Object.keys(ds.cps).length)) drawAnchors();
        else if (mode === 'pen') { if (pen) drawPen(null); else if (ds.node) drawAnchors(); }
        else if (mode === 'select') drawSelUI();
    }, { passive: true });

    document.addEventListener('keydown', function (e) {
        var tg = e.target.tagName;
        if (tg === 'TEXTAREA' || tg === 'INPUT' || e.target.isContentEditable) return;
        if (cropping()) return;
        var k = e.key;
        // 직접선택: 제어점이 선택돼 있으면 방향키로 그 앵커/모서리만 이동(형태 변형) — 노드 통째 이동 아님
        if (mode === 'direct' && Object.keys(ds.cps).length && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
            e.preventDefault(); e.stopImmediatePropagation();
            var st = e.shiftKey ? 10 : 1;
            nudgeCPs(k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0);
            return;
        }
        if (mode === 'pen' && pen) {
            if (k === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); endPen(true); return; }
            if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endPen(false); return; }
            if (k === 'Backspace' || k === 'Delete') {
                e.preventDefault(); e.stopImmediatePropagation();
                pen.pts.pop();
                if (!pen.pts.length) { var og = pen.orig; pen = null; clearOv(); restoreOrig(og); } else drawPen(null);
                return;
            }
        }
        if (mode === 'pen' && !pen && k === 'Escape' && ds.node) {
            e.preventDefault(); e.stopImmediatePropagation();
            exitDirect(); C.clearSel(); C.refreshSel(); return; // 펜 모드에서 편집 대상 해제
        }
        if (mode === 'direct' && (k === 'Delete' || k === 'Backspace')) {
            if (deleteAnchor()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        }
        if (mode === 'direct' && k === 'Escape') { e.preventDefault(); exitDirect(); return; }
        // 레이어 순서: Alt(또는 Ctrl)+]/[ 한 칸, Shift 추가 = 맨앞/맨뒤
        if ((e.ctrlKey || e.metaKey || e.altKey) && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
            e.preventDefault(); e.stopImmediatePropagation();
            var fwd = e.code === 'BracketRight';
            reorder(e.shiftKey ? (fwd ? 'front' : 'back') : (fwd ? 'fwd' : 'bwd'));
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // 정렬 단축키: q 위·u 아래·l 왼쪽·r 오른쪽·h 세로중앙·c 가로중앙 (2개+ 선택 또는 컨테이너 1개 선택 시 — 아니면 l 등은 도구 단축키로)
        var am = { q: 'top', u: 'bottom', l: 'left', r: 'right', h: 'centerV', c: 'centerH' }[(k || '').toLowerCase()];
        var asl = C.selList();
        var singleContainer = asl.length === 1 && (asl[0].type === 'group' || asl[0].type === 'artboard');
        if (am && (cpAlignActive() || asl.length >= 2 || singleContainer)) {
            e.preventDefault(); e.stopImmediatePropagation();
            C.alignSel(am); // 직접선택+앵커면 인터셉터가 앵커 정렬로, 아니면 노드 정렬
            return;
        }
        if (k === 'v' || k === 'V') setMode('select');
        else if (k === 'a' || k === 'A') setMode('direct');
        else if (k === 'p' || k === 'P') setMode('pen');
        else if (k === 'm' || k === 'M') setMode('rect');
        else if (k === 'l' || k === 'L') setMode('ellipse');
        else if (k === 'd' || k === 'D') defaultPaint();
        else if (k === 'X') swapPaint();
        else if (k === 'x') { paint.active = paint.active === 'fill' ? 'stroke' : 'fill'; drawPaint(); }
        else if (k === '/') noneActive();
        else return;
        e.preventDefault();
    }, true);

    // ───────── 인스펙터 (면/선/굵기/글자/순서 — 코어의 액션 행 앞에 배치) ─────────
    var PAL = ['#000000', '#ffffff', '#e0566c', '#e0913a', '#dcc04a', '#3aa394', '#4a8fdc', '#9b6bdc'];
    var insp = C.inspectorEl();
    var actsRow = insp.querySelector('.ci-acts');
    function addRow(r) { insp.insertBefore(r, actsRow); return r; }
    function mkRow(label) {
        var r = document.createElement('div'); r.className = 'ci-row';
        r.innerHTML = '<span class="ci-label">' + label + '</span>';
        return r;
    }
    function swRow(label, onpick) {
        var r = mkRow(label);
        PAL.forEach(function (c) {
            var b = document.createElement('button'); b.className = 'ci-sw'; b.style.background = c; b.title = c;
            b.onclick = function () { onpick(c); }; r.appendChild(b);
        });
        var none = document.createElement('button'); none.className = 'ci-sw ci-sw--none'; none.title = '없음'; none.textContent = '×';
        none.onclick = function () { onpick(null); }; r.appendChild(none);
        var inp = document.createElement('input'); inp.type = 'color'; inp.className = 'ci-custom'; inp.title = '직접 선택';
        inp.addEventListener('input', function () { onpick(inp.value, true); });   // 드래그 중: DOM만
        inp.addEventListener('change', function () { onpick(inp.value, false); }); // 놓을 때: 커밋
        r.appendChild(inp);
        return r;
    }
    function applyFS(slot, c, live) {
        paint[slot] = c;
        C.selList().forEach(function (n) { n[slot] = c; if (live) liveNodeColor(n, slot, c); }); // 그룹 포함
        if (!live) { C.markDirty(); C.render(); }
        drawPaint();
    }
    var fillRow = addRow(swRow('면', function (c, live) { applyFS('fill', c, live); }));
    var strokeRow = addRow(swRow('선', function (c, live) { applyFS('stroke', c, live); }));

    var widthRow = addRow(mkRow('굵기'));
    var widthInp = document.createElement('input'); widthInp.type = 'number'; widthInp.min = '0'; widthInp.step = '0.5'; widthInp.className = 'ci-num'; widthInp.title = '선 굵기 (px)';
    widthInp.addEventListener('change', function () { setPaint('width', Math.max(0, +widthInp.value || 0)); });
    widthRow.appendChild(widthInp);

    // 투명도: 노드(껍데기=배경·테두리)와 내용(글자·이미지)을 따로. 슬라이더 오른쪽=불투명.
    function mkOpacityRow(label, prop, title) {
        var row = addRow(mkRow(label));
        var inp = document.createElement('input'); inp.type = 'range'; inp.min = '0'; inp.max = '100'; inp.step = '5'; inp.className = 'ci-range'; inp.title = title;
        var val = document.createElement('span'); val.className = 'ci-rangeval';
        function apply(v, commit) {
            var op = v >= 100 ? null : Math.max(0, Math.min(1, v / 100));
            C.selList().forEach(function (n) { if (op == null) delete n[prop]; else n[prop] = op; });
            val.textContent = v + '%';
            C.render(); // 껍데기/내용 분리 적용은 렌더 경로에서 처리
            if (commit) C.markDirty();
        }
        inp.addEventListener('input', function () { apply(+inp.value, false); });
        inp.addEventListener('change', function () { apply(+inp.value, true); });
        row.appendChild(inp); row.appendChild(val);
        return { row: row, inp: inp, val: val, prop: prop };
    }
    var shellOp = mkOpacityRow('노드', 'opacity', '노드 껍데기(배경·테두리) 투명도 — 오른쪽=불투명');
    var contentOp = mkOpacityRow('내용', 'contentOpacity', '내용(글자·이미지) 투명도 — 오른쪽=불투명');
    function syncOpacityRow(o, sel) {
        if (!sel.length) return;
        var v = sel[0][o.prop] == null ? 100 : Math.round(sel[0][o.prop] * 100);
        if (document.activeElement !== o.inp) o.inp.value = v;
        o.val.textContent = v + '%';
    }

    // 아이콘 — 정렬은 길이가 다른 정렬선, 순서는 삼각형(한 칸)·굵은 화살표+바(맨앞/맨뒤)
    var ALIGN_ICON = {
        left:   '<svg viewBox="0 0 16 16"><path d="M2 4h12M2 8h7.5M2 12h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
        center: '<svg viewBox="0 0 16 16"><path d="M2 4h12M4.25 8h7.5M3 12h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
        right:  '<svg viewBox="0 0 16 16"><path d="M2 4h12M6.5 8h7.5M4 12h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>'
    };
    var ORDER_ICON = {
        bwd:   '<svg viewBox="0 0 16 16"><path d="M8 11.5 3.5 5.5h9z" fill="currentColor"/></svg>',
        fwd:   '<svg viewBox="0 0 16 16"><path d="M8 4.5 12.5 10.5h-9z" fill="currentColor"/></svg>',
        back:  '<svg viewBox="0 0 16 16"><path d="M8 2.3v6.4M5.2 5.9 8 8.7l2.8-2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.4 12.4h9.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        front: '<svg viewBox="0 0 16 16"><path d="M3.4 3.6h9.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 13.7V7.3M5.2 10.1 8 7.3l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    // 글자: 색 + 정렬 (텍스트 노드 선택 시에만 표시)
    var textRow = addRow(mkRow('글자'));
    var tcol = document.createElement('input'); tcol.type = 'color'; tcol.className = 'ci-custom'; tcol.title = '글자 색';
    function applyTextColor(v, live) {
        C.selList().forEach(function (n) { if (!n.type || n.type === 'text' || n.type === 'group') { n.textColor = v; if (live) liveNodeColor(n, 'textColor', v); } });
        if (!live) { C.markDirty(); C.render(); }
    }
    tcol.addEventListener('input', function () { applyTextColor(tcol.value, true); });   // 드래그 중: DOM만(렌더 X) → 버벅임 해소
    tcol.addEventListener('change', function () { applyTextColor(tcol.value, false); }); // 놓을 때: 커밋
    textRow.appendChild(tcol);
    ['left', 'center', 'right'].forEach(function (al) {
        var b = document.createElement('button'); b.className = 'ci-act ci-ico ci-align'; b.dataset.al = al;
        b.title = { left: '왼쪽 정렬', center: '가운데 정렬', right: '오른쪽 정렬' }[al]; b.innerHTML = ALIGN_ICON[al];
        b.onclick = function () {
            C.selList().forEach(function (n) { if (!n.type || n.type === 'text' || n.type === 'group') { if (al === 'left') delete n.align; else n.align = al; } });
            C.markDirty(); C.render();
        };
        textRow.appendChild(b);
    });
    // 서식: 볼드 / 밑줄 / 취소선 — 편집 중이면 선택 글자, 아니면 노드 전체(토글)
    [['bold', 'B', '볼드 (Ctrl+B / 드래그한 글자 또는 노드 전체)'], ['underline', 'U', '밑줄 (Ctrl+U)'], ['strike', 'S', '취소선 (Ctrl+Shift+S)']].forEach(function (o) {
        var b = document.createElement('button'); b.className = 'ci-act ci-fmt ci-fmt--' + o[0]; b.dataset.fmt = o[0]; b.textContent = o[1]; b.title = o[2];
        b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 편집 중 textarea 포커스 유지
        b.onclick = function () { C.applyFormat(o[0]); };
        textRow.appendChild(b);
    });

    // 크기: − [숫자] + (텍스트 노드·그룹 제목 선택 시 표시)
    var sizeRow = addRow(mkRow('크기'));
    function isSizable(n) { return !n.type || n.type === 'text' || n.type === 'group'; }
    function bumpFont(delta) {
        C.selList().forEach(function (n) { if (isSizable(n)) { n.fontSize = Math.max(8, Math.min(120, (n.fontSize || (n.type === 'group' ? 18 : 14)) + delta)); } });
        C.markDirty(); C.render();
    }
    var fsMinus = document.createElement('button'); fsMinus.className = 'ci-step'; fsMinus.textContent = '−'; fsMinus.title = '작게'; fsMinus.onclick = function () { bumpFont(-2); };
    var fontInp = document.createElement('input'); fontInp.type = 'number'; fontInp.min = '8'; fontInp.max = '120'; fontInp.className = 'ci-num'; fontInp.placeholder = 'px'; fontInp.title = '글자 크기 (px)';
    fontInp.addEventListener('change', function () {
        var v = +fontInp.value || 0;
        C.selList().forEach(function (n) { if (isSizable(n)) { if (v > 0) n.fontSize = Math.max(8, Math.min(120, v)); else delete n.fontSize; } });
        C.markDirty(); C.render();
    });
    var fsPlus = document.createElement('button'); fsPlus.className = 'ci-step'; fsPlus.textContent = '+'; fsPlus.title = '크게'; fsPlus.onclick = function () { bumpFont(2); };
    sizeRow.appendChild(fsMinus); sizeRow.appendChild(fontInp); sizeRow.appendChild(fsPlus);

    // 여백: − [숫자] + (내부 패딩 — 텍스트 노드·그룹 제목에 적용, 비우면 기본값)
    function isPaddable(n) { return !n.type || n.type === 'text' || n.type === 'group'; }
    var DEFAULT_PAD = 12;
    var padRow = addRow(mkRow('여백'));
    function bumpPad(delta) {
        C.selList().forEach(function (n) { if (isPaddable(n)) { var cur = n.padding != null ? n.padding : DEFAULT_PAD; n.padding = Math.max(0, Math.min(80, cur + delta)); } });
        C.markDirty(); C.render();
    }
    var pdMinus = document.createElement('button'); pdMinus.className = 'ci-step'; pdMinus.textContent = '−'; pdMinus.title = '여백 줄이기'; pdMinus.onclick = function () { bumpPad(-2); };
    var padInp = document.createElement('input'); padInp.type = 'number'; padInp.min = '0'; padInp.max = '80'; padInp.className = 'ci-num'; padInp.placeholder = 'px'; padInp.title = '내부 여백 (px)';
    padInp.addEventListener('change', function () {
        var v = padInp.value === '' ? -1 : (+padInp.value);
        C.selList().forEach(function (n) { if (isPaddable(n)) { if (v >= 0) n.padding = Math.max(0, Math.min(80, v)); else delete n.padding; } });
        C.markDirty(); C.render();
    });
    var pdPlus = document.createElement('button'); pdPlus.className = 'ci-step'; pdPlus.textContent = '+'; pdPlus.title = '여백 늘리기'; pdPlus.onclick = function () { bumpPad(2); };
    padRow.appendChild(pdMinus); padRow.appendChild(padInp); padRow.appendChild(pdPlus);

    // 링크: 표시 이름 + 주소 (링크 노드 하나만 선택 시 표시)
    function onlyLink() { var s = C.selList(); return (s.length === 1 && s[0].type === 'link') ? s[0] : null; }
    var linkNameRow = addRow(mkRow('이름'));
    var linkNameInp = document.createElement('input'); linkNameInp.type = 'text'; linkNameInp.className = 'ci-text'; linkNameInp.placeholder = '표시 이름 (비우면 주소)';
    linkNameInp.addEventListener('input', function () { var n = onlyLink(); if (!n) return; if (linkNameInp.value) n.label = linkNameInp.value; else delete n.label; C.markDirty(); C.render(); });
    linkNameRow.appendChild(linkNameInp);
    var linkUrlRow = addRow(mkRow('주소'));
    var linkUrlInp = document.createElement('input'); linkUrlInp.type = 'text'; linkUrlInp.className = 'ci-text'; linkUrlInp.placeholder = 'https:// 또는 YouTube';
    linkUrlInp.addEventListener('input', function () { var n = onlyLink(); if (!n) return; n.url = linkUrlInp.value; C.markDirty(); C.render(); });
    linkUrlRow.appendChild(linkUrlInp);

    // 그룹: 이름(텍스트) — 그룹 하나만 선택 시 표시
    function onlyGroup() { var s = C.selList(); return (s.length === 1 && s[0].type === 'group') ? s[0] : null; }
    var groupNameRow = addRow(mkRow('이름'));
    var groupNameInp = document.createElement('input'); groupNameInp.type = 'text'; groupNameInp.className = 'ci-text'; groupNameInp.placeholder = '그룹 이름';
    groupNameInp.addEventListener('input', function () { var g = onlyGroup(); if (!g) return; g.label = groupNameInp.value; C.markDirty(); C.render(); });
    groupNameRow.appendChild(groupNameInp);

    // 아트보드: 이름 / 번호(순서) / 전환효과 — 아트보드 하나만 선택 시 표시
    function onlyArtboard() { var s = C.selList(); return (s.length === 1 && s[0].type === 'artboard') ? s[0] : null; }
    var abNameRow = addRow(mkRow('이름'));
    var abNameInp = document.createElement('input'); abNameInp.type = 'text'; abNameInp.className = 'ci-text'; abNameInp.placeholder = '아트보드 이름';
    abNameInp.addEventListener('input', function () { var a = onlyArtboard(); if (!a) return; a.name = abNameInp.value; C.markDirty(); C.render(); });
    abNameRow.appendChild(abNameInp);

    var abIdxRow = addRow(mkRow('번호'));
    function moveArtboard(ab, dir) {
        var abs = C.nodes.filter(function (n) { return n.type === 'artboard'; }).sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
        var i = abs.indexOf(ab), j = i + dir; if (j < 0 || j >= abs.length) return;
        var t = ab.index || 0; ab.index = abs[j].index || 0; abs[j].index = t; C.markDirty(); C.render();
    }
    var abIdxDown = document.createElement('button'); abIdxDown.className = 'ci-step'; abIdxDown.textContent = '↑'; abIdxDown.title = '순서 앞으로'; abIdxDown.onclick = function () { var a = onlyArtboard(); if (a) moveArtboard(a, -1); };
    var abIdxInp = document.createElement('input'); abIdxInp.type = 'number'; abIdxInp.min = '1'; abIdxInp.className = 'ci-num'; abIdxInp.title = '슬라이드 번호';
    abIdxInp.addEventListener('change', function () { var a = onlyArtboard(); if (!a) return; a.index = Math.max(1, +abIdxInp.value || 1); C.markDirty(); C.render(); });
    var abIdxUp = document.createElement('button'); abIdxUp.className = 'ci-step'; abIdxUp.textContent = '↓'; abIdxUp.title = '순서 뒤로'; abIdxUp.onclick = function () { var a = onlyArtboard(); if (a) moveArtboard(a, 1); };
    abIdxRow.appendChild(abIdxDown); abIdxRow.appendChild(abIdxInp); abIdxRow.appendChild(abIdxUp);

    // 배경색: 슬라이드쇼에서도 그대로 적용됨 (기본 흰색)
    var abBgRow = addRow(mkRow('배경'));
    var abBgInp = document.createElement('input'); abBgInp.type = 'color'; abBgInp.className = 'ci-custom'; abBgInp.title = '슬라이드 배경색';
    abBgInp.addEventListener('input', function () { var a = onlyArtboard(); if (!a) return; a.bg = abBgInp.value; C.markDirty(); C.render(); });
    var abBgWhite = document.createElement('button'); abBgWhite.className = 'ci-step'; abBgWhite.textContent = '⌫'; abBgWhite.title = '흰색으로 초기화';
    abBgWhite.onclick = function () { var a = onlyArtboard(); if (!a) return; delete a.bg; C.markDirty(); C.render(); };
    abBgRow.appendChild(abBgInp); abBgRow.appendChild(abBgWhite);

    var abTransRow = addRow(mkRow('전환'));
    var abTransSel = document.createElement('select'); abTransSel.className = 'ci-select'; abTransSel.title = '슬라이드 전환 효과';
    [['none', '없음'], ['fade', '페이드'], ['slide', '밀기']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; abTransSel.appendChild(op);
    });
    abTransSel.addEventListener('change', function () { var a = onlyArtboard(); if (!a) return; a.transition = abTransSel.value; C.markDirty(); });
    abTransRow.appendChild(abTransSel);

    // 파일: 표시 이름 변경 (파일 노드 하나만 선택 시 표시 — 실제 업로드 파일은 그대로, 표시명만 바뀜)
    function onlyFile() { var s = C.selList(); return (s.length === 1 && s[0].type === 'file') ? s[0] : null; }
    var fileNameRow = addRow(mkRow('파일명'));
    var fileNameInp = document.createElement('input'); fileNameInp.type = 'text'; fileNameInp.className = 'ci-text'; fileNameInp.placeholder = '표시할 파일 이름';
    fileNameInp.addEventListener('input', function () { var f = onlyFile(); if (!f) return; if (fileNameInp.value) f.name = fileNameInp.value; else delete f.name; C.markDirty(); C.render(); });
    fileNameRow.appendChild(fileNameInp);

    // 순서: 맨뒤 / 뒤로 / 앞으로 / 맨앞 (삼각형 = 한 칸, 굵은 화살표+바 = 맨앞/맨뒤)
    var orderRow = addRow(mkRow('순서'));
    [['back', '맨뒤로 (Alt+Shift+[)'], ['bwd', '뒤로 (Alt+[)'], ['fwd', '앞으로 (Alt+])'], ['front', '맨앞으로 (Alt+Shift+])']].forEach(function (o) {
        var b = document.createElement('button'); b.className = 'ci-act ci-ico'; b.innerHTML = ORDER_ICON[o[0]]; b.title = o[1];
        b.onclick = function () { reorder(o[0]); }; orderRow.appendChild(b);
    });

    // 렌더/선택 변경 시: 페인트 동기화 + 행 표시 + 직접선택 오버레이 갱신
    C.onRender(function () {
        var sel = C.selList(); // 그룹 포함 (면/선/굵기 동기화)
        if (sel.length) {
            var n0 = sel[0];
            // 선택 노드의 실제 색을 스와치에 반영: 명시 fill/stroke 우선, 없으면 화면에 보이는 색(computed)
            var el0 = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n0.id) + '"]');
            var cs0 = el0 ? getComputedStyle(el0) : null;
            paint.fill = ('fill' in n0) ? n0.fill : (cs0 ? rgbToHexOrNull(cs0.backgroundColor) : paint.fill);
            paint.stroke = ('stroke' in n0) ? n0.stroke : (cs0 ? rgbToHexOrNull(cs0.borderTopColor) : paint.stroke);
            if (n0.strokeWidth != null) paint.width = n0.strokeWidth;
        }
        drawPaint();
        syncOpacityRow(shellOp, sel); syncOpacityRow(contentOp, sel);
        var anyText = sel.some(function (n) { return !n.type || n.type === 'text'; });
        var anyGroup = sel.some(function (n) { return n.type === 'group'; });
        textRow.style.display = (anyText || anyGroup) ? '' : 'none';   // 글자색은 텍스트·그룹 모두
        sizeRow.style.display = (anyText || anyGroup) ? '' : 'none';    // 글자크기도 텍스트·그룹 모두
        var padNode = sel.filter(isPaddable)[0];
        padRow.style.display = (anyText || anyGroup) ? '' : 'none';     // 여백도 텍스트·그룹
        if (padNode && document.activeElement !== padInp) padInp.value = padNode.padding != null ? padNode.padding : '';
        var tNode = sel.filter(function (n) { return !n.type || n.type === 'text' || n.type === 'group'; })[0];     // 정렬 대상(텍스트+그룹)
        var cNode = tNode;                                                                                         // 글자색·크기 대상(텍스트+그룹)
        if (cNode && document.activeElement !== fontInp) fontInp.value = cNode.fontSize || '';
        if (cNode && cNode.textColor && /^#[0-9a-f]{6}$/i.test(cNode.textColor)) tcol.value = cNode.textColor;
        textRow.querySelectorAll('.ci-align').forEach(function (b) { b.style.display = (anyText || anyGroup) ? '' : 'none'; b.classList.toggle('is-on', !!tNode && (tNode.align || 'left') === b.dataset.al); });
        textRow.querySelectorAll('.ci-fmt').forEach(function (b) { b.classList.toggle('is-on', !!tNode && !!tNode[b.dataset.fmt]); });
        var lk = onlyLink();
        linkNameRow.style.display = lk ? '' : 'none';
        linkUrlRow.style.display = lk ? '' : 'none';
        if (lk) {
            if (document.activeElement !== linkNameInp) linkNameInp.value = lk.label || '';
            if (document.activeElement !== linkUrlInp) linkUrlInp.value = lk.url || '';
        }
        var gp = onlyGroup();
        groupNameRow.style.display = gp ? '' : 'none';
        if (gp && document.activeElement !== groupNameInp) groupNameInp.value = gp.label || '';
        var ab = onlyArtboard();
        abNameRow.style.display = ab ? '' : 'none';
        abIdxRow.style.display = ab ? '' : 'none';
        abBgRow.style.display = ab ? '' : 'none';
        abTransRow.style.display = ab ? '' : 'none';
        if (ab) {
            if (document.activeElement !== abNameInp) abNameInp.value = ab.name || '';
            if (document.activeElement !== abIdxInp) abIdxInp.value = ab.index || '';
            if (document.activeElement !== abBgInp) abBgInp.value = (ab.bg && /^#[0-9a-f]{6}$/i.test(ab.bg)) ? ab.bg : '#ffffff';
            abTransSel.value = ab.transition || 'none';
        }
        // 아트보드만 선택 시 면·선·굵기 행 숨김(배경은 위 '배경'으로 조절)
        var onlyAbs = sel.length > 0 && sel.every(function (n) { return n.type === 'artboard'; });
        fillRow.style.display = onlyAbs ? 'none' : '';
        strokeRow.style.display = onlyAbs ? 'none' : '';
        widthRow.style.display = onlyAbs ? 'none' : '';
        var fl = onlyFile();
        fileNameRow.style.display = fl ? '' : 'none';
        if (fl && document.activeElement !== fileNameInp) fileNameInp.value = fl.name || '';
        if (document.activeElement !== widthInp) widthInp.value = paint.width;
        if (mode === 'select') drawSelUI(); // 회전 핸들 갱신
        if (ds.node) { // undo 등으로 객체가 교체/삭제됐으면 추적 갱신
            var cur = C.nodeById(ds.node.id);
            if (!cur || cur.type !== 'path') exitDirect();
            else if (cur !== ds.node) { ds.node = cur; ds.sel = -1; ds.cps = {}; drawAnchors(); }
        }
    });
})();
