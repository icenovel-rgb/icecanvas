/* icenovel 캔버스 — 옵시디언 JSON Canvas 호환 뷰어/편집기 (무빌드 바닐라)
   기능: 팬·줌 / 박스 선택·다중선택 / 노드 추가·드래그·리사이즈·연결 / 점→빈곳=새 노드
        / 더블클릭 편집 / 그룹 / 색·글자색 / 다크모드 / 이미지·텍스트·.canvas 붙여넣기 / 입출력
   확장: window.__CANVAS_CORE__ API로 벡터(canvas-vector.js)·크롭(canvas-crop.js) 모듈이 연결됨 */
(function () {
    'use strict';
    var CFG = window.__CANVAS__ || { data: { nodes: [], edges: [] }, isAdmin: false, slug: 'canvas' };
    var admin = !!CFG.isAdmin;

    var stage = document.getElementById('canvasStage');
    var world = document.getElementById('canvasWorld');
    var svg = document.getElementById('canvasEdges');
    var nodesEl = document.getElementById('canvasNodes');
    var hint = document.getElementById('canvasHint');
    if (!stage) return;
    if (!admin) stage.classList.add('is-viewer'); // 방문자: 기본 이동, 더블클릭 시 복사 모드
    stage.tabIndex = 0; // 붙여넣기 포커스용
    stage.addEventListener('mousedown', function () { try { stage.focus({ preventScroll: true }); } catch (x) {} });
    // 캔버스는 transform으로 팬/줌하므로 네이티브 스크롤은 항상 0이어야 한다.
    // (확대 상태에서 화면 밖 입력칸에 focus가 걸리면 브라우저가 overflow:hidden인 stage를 스크롤시켜
    //  world·노드·인스펙터가 통째로 밀린다 → 스크롤이 생기면 즉시 0으로 되돌린다)
    stage.addEventListener('scroll', function () { if (stage.scrollLeft || stage.scrollTop) { stage.scrollLeft = 0; stage.scrollTop = 0; } });

    var nodes = (CFG.data && CFG.data.nodes) || [];
    var edges = (CFG.data && CFG.data.edges) || [];
    var view = { x: 0, y: 0, scale: 1 };
    var selNodes = {};          // id -> true
    var keyNode = null;         // 정렬 기준 노드 id (일러스트레이터식 key object — 다중선택 중 다시 클릭한 노드)
    var selEdge = null;
    var dirty = false;
    var spaceDown = false;
    var activeVid = null;       // 재생 중인 유튜브 노드 id (한 번에 하나)
    var copyNodeEl = null;
    var lastMouse = { x: 0, y: 0 };
    var canvasClipboard = null;
    var CONNECT_SNAP = 24;
    var COLLAPSE_H = 132, FOLD_MIN = 200;  // 접었을 때 높이 / 접기 버튼이 뜨는 최소 높이
    var alignInterceptor = null;           // 벡터 모듈이 직접선택 앵커 정렬을 가로채는 훅
    var past = [], future = [], present = JSON.stringify({ nodes: nodes, edges: edges });  // undo/redo

    var extRenderers = {};   // 확장 모듈이 등록하는 노드 타입 렌더러 (예: 'path')
    var renderHooks = [];    // 렌더/선택 변경 후 호출되는 확장 훅

    var PALETTE = ['#e0566c', '#e0913a', '#dcc04a', '#3aa394', '#4a8fdc', '#9b6bdc'];
    var PRESET = { '1': '#e0566c', '2': '#e0913a', '3': '#dcc04a', '4': '#3aa394', '5': '#4a8fdc', '6': '#9b6bdc' };
    var IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
    var VIDEO_RE = /\.(mp4|webm|ogg|ogv|m4v|mov)$/i;
    function isImgFile(n) { var f = (n && n.file) || ''; return /^data:image\//i.test(f) || IMG_RE.test(f) || IMG_RE.test((n && n.name) || ''); }
    function isPdfFile(n) { var f = (n && n.file) || ''; return /^data:application\/pdf/i.test(f) || /\.pdf(?:[#?]|$)/i.test(f) || /\.pdf$/i.test((n && n.name) || ''); }
    function isVideoFile(n) { var f = (n && n.file) || ''; return /^data:video\//i.test(f) || VIDEO_RE.test(f) || VIDEO_RE.test((n && n.name) || ''); }
    function fileNameOf(n, fallback) { return (n && n.name) || (((n && n.file) || '').indexOf('data:') === 0 ? fallback : ((n && n.file) || '').split('/').pop()) || fallback; }
    function ytId(u) { var m = (u || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : null; }
    // 유튜브 재생위치 기억 (브라우저 localStorage, 새로고침 후에도 유지)
    function ytKey(id) { return 'yt:' + (CFG.slug || '') + ':' + id; }
    function getVt(id) { try { return parseFloat(localStorage.getItem(ytKey(id))) || 0; } catch (e) { return 0; } }
    function setVt(id, t) { try { localStorage.setItem(ytKey(id), String(Math.floor(t))); } catch (e) {} }

    // ───────── 유틸 ─────────
    function uid(p) { return p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
    function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function colOf(c) { if (!c) return null; if (c[0] === '#') return c; return PRESET[c] || null; }
    function hexA(hex, a) {
        var h = hex.replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/"/g, '\\"'); }
    // 색(rgb/rgba) 문자열의 알파를 mult배 — 껍데기 투명도용
    function mulAlpha(css, mult) {
        var m = (css || '').match(/rgba?\(([^)]+)\)/); if (!m) return css;
        var p = m[1].split(',').map(function (s) { return s.trim(); });
        var a = p.length > 3 ? parseFloat(p[3]) : 1;
        return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + (a * mult) + ')';
    }
    function nodeById(id) { for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i]; return null; }
    function selList() { return Object.keys(selNodes).map(nodeById).filter(Boolean); }

    function applyView() {
        world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
        var z = document.getElementById('canvasZoomLevel'); if (z) z.textContent = Math.round(view.scale * 100) + '%';
    }
    function screenToWorld(sx, sy) { var r = stage.getBoundingClientRect(); return { x: (sx - r.left - view.x) / view.scale, y: (sy - r.top - view.y) / view.scale }; }

    // ───────── 텍스트 간이 렌더 ─────────
    function fmtText(t) {
        var lines = esc(t).split('\n').map(function (ln) {
            var m = ln.match(/^(#{1,3})\s+(.*)$/);
            if (m) return '<span class="cnh cnh' + m[1].length + '">' + m[2] + '</span>';
            return ln;
        });
        return lines.join('<br>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    // ───────── 기하 ─────────
    function sidePoint(n, side) {
        var x = n.x, y = n.y, w = n.width || 250, h = n.height || 60;
        if (side === 'top') return { x: x + w / 2, y: y };
        if (side === 'bottom') return { x: x + w / 2, y: y + h };
        if (side === 'left') return { x: x, y: y + h / 2 };
        return { x: x + w, y: y + h / 2 };
    }
    function nearestSide(n, px, py) {
        var cx = n.x + (n.width || 250) / 2, cy = n.y + (n.height || 60) / 2, dx = px - cx, dy = py - cy;
        if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
        return dy > 0 ? 'bottom' : 'top';
    }
    function nodeRect(n) { return { x: n.x, y: n.y, w: n.width || 250, h: n.height || 60 }; }
    function rectsHit(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function nodeCenter(n) { return { x: n.x + (n.width || 250) / 2, y: n.y + (n.height || 60) / 2 }; }
    // 그룹 소속 판정 기준점: 노드 상단 근처(중심 아님). 접기/펼치기로 높이가 변해도(상단 고정) 소속이 유지된다.
    function groupMemberPoint(n) { return { x: n.x + (n.width || 250) / 2, y: n.y + Math.min((n.height || 60) / 2, 20) }; }
    // ───────── 접기/펼치기 (긴 텍스트 노드) ─────────
    function isFoldable(n) { return (!n.type || n.type === 'text') && (!!n.collapsed || (n.height || 60) >= FOLD_MIN); }
    function setFold(n, collapse) {
        if (!n) return false;
        if (collapse) {
            if (n.collapsed || (n.height || 60) <= COLLAPSE_H) return false; // 이미 접혔거나 접을 만큼 길지 않음
            n.expandedHeight = n.height || 60; n.height = COLLAPSE_H; n.collapsed = true; return true;
        }
        if (!n.collapsed) return false;
        if (n.expandedHeight) n.height = n.expandedHeight; delete n.expandedHeight; delete n.collapsed; return true;
    }
    function toggleFold(n) {
        if (!n) return;
        if (setFold(n, !n.collapsed)) { if (admin) markDirty(); render(); }
    }
    // F: 선택한 텍스트 노드 접기↔펼치기 (펼침 우선 — 하나라도 접혀 있으면 모두 펼치고, 아니면 모두 접음)
    function foldSelection() {
        var list = selList().filter(function (n) { return !n.type || n.type === 'text'; });
        if (!list.length) return;
        var anyCollapsed = list.some(function (n) { return n.collapsed; });
        var changed = false;
        list.forEach(function (n) { if (setFold(n, !anyCollapsed)) changed = true; });
        if (changed) { markDirty(); render(); }
    }

    // ───────── 렌더 ─────────
    function render() {
        nodesEl.innerHTML = '';
        // 그룹 먼저(뒤로)
        var ordered = nodes.slice().sort(function (a, b) { return (a.type === 'group' ? 0 : 1) - (b.type === 'group' ? 0 : 1); });
        ordered.forEach(function (n) {
            var d = document.createElement('div');
            d.className = 'cnode cnode--' + (n.type || 'text') + (selNodes[n.id] ? ' is-sel' : '') + (keyNode === n.id ? ' is-key' : '');
            d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
            d.style.width = (n.width || 250) + 'px'; d.style.height = (n.height || 60) + 'px';
            var ext = n.type && extRenderers[n.type];
            var col = colOf(n.color);
            if (col && !ext) { d.style.borderColor = col; d.style.background = hexA(col, 0.10); }
            if (!ext) {
                // 면/선/굵기 (벡터 페인트 시스템과 동일 모델, null = 없음)
                if ('fill' in n) d.style.background = (n.fill == null ? 'transparent' : n.fill);
                if ('stroke' in n) d.style.borderColor = (n.stroke == null ? 'transparent' : n.stroke);
                if (n.strokeWidth != null) d.style.borderWidth = n.strokeWidth + 'px';
                if ('fill' in n && n.fill == null) d.classList.add('cnode--noshadow'); // 면 없음 = 그림자도 없음
            }
            if (n.rotate) { d.style.transform = 'rotate(' + (+n.rotate || 0) + 'deg)'; d.style.transformOrigin = '50% 50%'; }
            if (!ext && n.radius) d.style.borderRadius = (+n.radius || 0) + 'px'; // 코너 라운드 (없으면 기본 사각형)
            if (n.contentOpacity != null) d.style.setProperty('--cnt-op', n.contentOpacity); // 내용(글자·이미지) 투명도
            d.dataset.id = n.id;
            var inner = '';
            if (ext) {
                d.classList.add('cnode--ext');
                inner = ext(n, d) || '';
            } else if (n.type === 'link') {
                var yid = ytId(n.url || '');
                if (yid) {
                    d.classList.add('cnode--media');
                    if (activeVid === n.id) {
                        inner = '<iframe class="cnode__ytframe" id="cnvytframe" src="https://www.youtube.com/embed/' + yid + '?enablejsapi=1&autoplay=1&playsinline=1&rel=0&start=' + (Math.floor(getVt(n.id)) || 0) + '" title="YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>';
                    } else {
                        inner = '<div class="cnode__ytposter"><img src="https://i.ytimg.com/vi/' + yid + '/hqdefault.jpg" alt="" draggable="false"><button class="cnode__ytplay" type="button" title="Play" aria-label="Play">&#9658;</button></div>';
                    }
                } else {
                    inner = '<div class="cnode__body"><a href="' + esc(n.url || '') + '" target="_blank" rel="noopener" draggable="false" class="cnode__link">' + esc(n.label || n.url || '') + '</a></div>';
                }
            } else if (n.type === 'file') {
                if (isImgFile(n)) {
                    var src = esc(n.file || ''), cr = n.crop;
                    if (cr && cr.w > 0 && cr.h > 0) {
                        // 비파괴 크롭: 원본을 키워서 보이는 영역만 노출
                        var ist = 'width:' + (100 / cr.w) + '%;height:' + (100 / cr.h) + '%;left:' + (-cr.x / cr.w * 100) + '%;top:' + (-cr.y / cr.h * 100) + '%';
                        inner = '<div class="cnode__img cnode__img--crop"><img src="' + src + '" style="' + ist + '" alt="" draggable="false"></div>';
                    } else {
                        inner = '<div class="cnode__img"><img src="' + src + '" alt="" draggable="false"></div>';
                    }
                }
                else if (isPdfFile(n)) {
                    // PDF는 인라인 뷰어 대신 브라우저 새 탭에서 연다(↗) + 다운로드(⬇)
                    d.classList.add('cnode--filebox');
                    var phref = esc(n.file || '');
                    var pdisp = fileNameOf(n, 'PDF');
                    inner = '<div class="cnode__filebox">' +
                        '<span class="cnode__fileicon" aria-hidden="true">📄</span>' +
                        '<span class="cnode__filename" title="' + esc(pdisp) + '">' + esc(pdisp) + '</span>' +
                        '<a class="cnode__dl" href="' + phref + '" target="_blank" rel="noopener" draggable="false" title="브라우저에서 열기" aria-label="브라우저에서 열기">↗</a>' +
                        '<a class="cnode__dl" href="' + phref + '" download="' + esc(pdisp) + '" title="다운로드" rel="noopener" draggable="false" aria-label="다운로드">⬇</a>' +
                        '</div>';
                }
                else if (isVideoFile(n)) {
                    d.classList.add('cnode--video');
                    var vsrc = esc(n.file || '');
                    var vname = fileNameOf(n, '\uB3D9\uC601\uC0C1');
                    inner = '<div class="cnode__pdfbar" title="드래그하여 이동">🎬 ' + esc(vname) + '</div>' +
                        '<video class="cnode__video" src="' + vsrc + '" controls preload="metadata" playsinline></video>';
                }
                else {
                    d.classList.add('cnode--filebox');
                    var fhref = esc(n.file || '');
                    var fdisp = fileNameOf(n, '\uD30C\uC77C');
                    inner = '<div class="cnode__filebox">' +
                        '<span class="cnode__fileicon" aria-hidden="true">📄</span>' +
                        '<span class="cnode__filename" title="' + esc(fdisp) + '">' + esc(fdisp) + '</span>' +
                        '<a class="cnode__dl" href="' + fhref + '" download="' + esc(fdisp) + '" title="다운로드" rel="noopener" draggable="false" aria-label="다운로드">⬇</a>' +
                        '</div>';
                }
            } else if (n.type === 'group') {
                d.classList.add('cnode--group');
                var gst = (n.textColor ? 'color:' + esc(n.textColor) + ';' : '') + (n.fontSize ? 'font-size:' + (+n.fontSize || 18) + 'px;' : '');
                inner = '<div class="cnode__grouplabel"' + (gst ? ' style="' + gst + '"' : '') + '>' + esc(n.label || '') + '</div>';
            } else {
                var stl = (n.textColor ? 'color:' + esc(n.textColor) + ';' : '') +
                    (n.align ? 'text-align:' + esc(n.align) + ';' : '') +
                    (n.fontSize ? 'font-size:' + (+n.fontSize || 14) + 'px;' : '');
                var st = stl ? ' style="' + stl + '"' : '';
                inner = '<div class="cnode__body"' + st + '>' + fmtText(n.text || '') + '</div>';
            }
            if (isFoldable(n)) {
                if (n.collapsed) d.classList.add('cnode--collapsed');
                inner += '<button type="button" class="cnode__fold" title="접기/펼치기">' + (n.collapsed ? '▸' : '▾') + '</button>';
            }
            if (admin) {
                if (n.type !== 'group') {
                    inner += '<span class="chandle chandle--r" data-side="right"></span><span class="chandle chandle--l" data-side="left"></span>' +
                        '<span class="chandle chandle--t" data-side="top"></span><span class="chandle chandle--b" data-side="bottom"></span>';
                }
                inner += '<span class="cres cres--n" data-dir="n"></span><span class="cres cres--s" data-dir="s"></span>' +
                    '<span class="cres cres--e" data-dir="e"></span><span class="cres cres--w" data-dir="w"></span>' +
                    '<span class="cres cres--nw" data-dir="nw"></span><span class="cres cres--ne" data-dir="ne"></span>' +
                    '<span class="cres cres--sw" data-dir="sw"></span><span class="cres cres--se" data-dir="se"></span>';
            }
            d.innerHTML = inner;
            nodesEl.appendChild(d);
        });
        // 껍데기(노드) 투명도: 배경·테두리 색의 알파만 낮춘다 (내용은 영향 없음 — 위 --cnt-op로 별도 처리)
        nodes.forEach(function (n) {
            if (n.opacity == null) return;
            var el = nodesEl.querySelector('.cnode[data-id="' + cssEsc(n.id) + '"]'); if (!el) return;
            var cs = getComputedStyle(el);
            el.style.background = mulAlpha(cs.backgroundColor, n.opacity);
            el.style.borderColor = mulAlpha(cs.borderTopColor, n.opacity);
        });
        renderEdges();
        updateInspector();
        if (activeVid) ytConnect();
    }
    // 재생 중인 iframe에 시간보고 요청(핸드셰이크) → message로 currentTime 수신해 저장
    function ytConnect() {
        var f = document.getElementById('cnvytframe'); if (!f) return;
        function hs() { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'cnvyt', channel: 'widget' }), 'https://www.youtube.com'); } catch (e) {} }
        f.addEventListener('load', hs); setTimeout(hs, 600); setTimeout(hs, 1500);
    }
    function renderEdges() {
        var parts = '';
        edges.forEach(function (e) {
            var a = nodeById(e.fromNode), b = nodeById(e.toNode); if (!a || !b) return;
            var p1 = sidePoint(a, e.fromSide || 'right'), p2 = sidePoint(b, e.toSide || 'left');
            var col = colOf(e.color) || '#7c8a95', sel = selEdge === e.id;
            parts += '<path d="' + bezierPath(p1, p2, e.fromSide || 'right', e.toSide || 'left') + '" fill="none" stroke="' + (sel ? '#2d8b8b' : col) + '" stroke-width="' + (sel ? 3.5 : 2.5) + '" data-id="' + e.id + '" class="cedge" marker-end="url(#carrow)"/>';
            if (e.label) parts += '<text x="' + (p1.x + p2.x) / 2 + '" y="' + ((p1.y + p2.y) / 2 - 6) + '" class="celabel" text-anchor="middle">' + esc(e.label) + '</text>';
        });
        svg.innerHTML = '<defs><marker id="carrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="#7c8a95"/></marker></defs>' + parts;
    }
    function flagDirty() { dirty = true; var b = document.getElementById('canvasSaveBtn'); if (b) b.classList.add('is-dirty'); try { localStorage.setItem('icecanvas.autosave.v2', JSON.stringify({ title: CFG.title, slug: CFG.slug, nodes: nodes, edges: edges, updatedAt: new Date().toISOString() })); } catch (x) {} }
    function snapState() { return JSON.stringify({ nodes: nodes, edges: edges }); }
    function markDirty() { if (!admin) return; past.push(present); if (past.length > 100) past.shift(); present = snapState(); future = []; flagDirty(); }
    function applyState(s) { var o; try { o = JSON.parse(s); } catch (e) { return; } nodes = o.nodes || []; edges = o.edges || []; clearSel(); render(); flagDirty(); }
    function undo() { if (!past.length) { toast('되돌릴 항목 없음'); return; } future.push(present); present = past.pop(); applyState(present); }
    function redo() { if (!future.length) { toast('다시 실행할 항목 없음'); return; } past.push(present); present = future.pop(); applyState(present); }

    // ───────── 선택 ─────────
    function clearSel() { selNodes = {}; keyNode = null; selEdge = null; }
    // 선택은 DOM을 다시 그리지 않고 클래스만 토글 (더블클릭 편집 보존)
    function refreshSel() {
        if (keyNode && !selNodes[keyNode]) keyNode = null; // 선택에서 빠진 기준 노드는 해제
        nodesEl.querySelectorAll('.cnode').forEach(function (el) { el.classList.toggle('is-sel', !!selNodes[el.dataset.id]); el.classList.toggle('is-key', keyNode === el.dataset.id); });
        renderEdges(); updateInspector();
    }
    function selectOne(id, add) { if (!add) selNodes = {}; selEdge = null; selNodes[id] = true; refreshSel(); }
    function clearViewerCopy() {
        if (copyNodeEl) copyNodeEl.classList.remove('is-copyable');
        copyNodeEl = null;
        try { window.getSelection().removeAllRanges(); } catch (x) {}
    }
    function enableViewerCopy(nodeEl) {
        clearViewerCopy();
        var body = nodeEl.querySelector('.cnode__body, .cnode__file');
        if (!body) return;
        copyNodeEl = nodeEl;
        nodeEl.classList.add('is-copyable');
        try {
            var rg = document.createRange();
            rg.selectNodeContents(body);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(rg);
        } catch (x) {}
        toast('텍스트가 선택되었습니다. Ctrl+C로 복사하세요.');
    }

    // ───────── 팬 / 줌 / 마퀴 ─────────
    function startPan(ev) {
        var sx = ev.clientX, sy = ev.clientY, vx = view.x, vy = view.y;
        stage.classList.add('is-panning');
        function mv(e) { view.x = vx + (e.clientX - sx); view.y = vy + (e.clientY - sy); applyView(); }
        function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); stage.classList.remove('is-panning'); }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    stage.addEventListener('mousedown', function (ev) {
        if (ev.target !== stage && ev.target !== world && ev.target !== svg) return;
        if (activeVid) { activeVid = null; render(); }  // 빈 곳 클릭 = 영상 닫기 (PDF는 열어둔 채 유지, 바의 ✕로 접음)
        if (!admin || spaceDown || ev.button === 1) startPan(ev); else marquee(ev);
    });
    // 드래그 중 커서가 iframe(PDF·유튜브) 위를 지나면 iframe이 mouseup을 삼켜 드래그가 안 풀린다 → 차단
    stage.addEventListener('mousedown', function () { stage.classList.add('is-interacting'); }, true);
    document.addEventListener('mouseup', function () { stage.classList.remove('is-interacting'); }, true);
    window.addEventListener('blur', function () { stage.classList.remove('is-interacting'); });
    function setActiveVid(id) { activeVid = id; render(); }
    nodesEl.addEventListener('click', function (ev) {
        var ne = ev.target.closest('.cnode'); var n = ne && nodeById(ne.dataset.id);
        if (!n) return;
        if (ev.target.closest('.cnode__ytplay, .cnode__ytposter')) setActiveVid(n.id);
    });
    document.addEventListener('click', function (ev) {
        var dl = ev.target.closest('.cnode__dl[download]');
        if (dl && window.ICECanvasNative && window.ICECanvasNative.saveAttachment) {
            var href = dl.getAttribute('href') || '';
            if (href.indexOf('data:') === 0) {
                ev.preventDefault();
                ev.stopPropagation();
                window.ICECanvasNative.saveAttachment(href, dl.getAttribute('download') || 'attachment')
                    .then(function (path) { if (path) toast('파일을 저장했습니다'); })
                    .catch(function () { toast('파일 저장에 실패했습니다'); });
                return;
            }
        }

        var a = ev.target.closest('a');
        if (a) {
            var href = a.getAttribute('href') || '';
            if (/^https?:\/\//i.test(href)) {
                if (window.ICECanvasNative && window.ICECanvasNative.openInBrowser) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    window.ICECanvasNative.openInBrowser(href)
                        .catch(function (err) { console.error('Failed to open link:', err); });
                }
            }
        }
    }, true);
    var ZMIN = 0.05, ZMAX = 5;
    function zoomAt(mx, my, factor) {
        var ns = Math.min(ZMAX, Math.max(ZMIN, view.scale * factor));
        view.x = mx - (mx - view.x) * (ns / view.scale); view.y = my - (my - view.y) * (ns / view.scale); view.scale = ns; applyView();
    }
    function zoomBy(factor) { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, factor); }
    function panBy(dx, dy) {
        view.x += dx; view.y += dy; applyView();
    }
    stage.addEventListener('wheel', function (ev) {
        ev.preventDefault();
        var r = stage.getBoundingClientRect();
        var f = ev.deltaMode === 1 ? 16 : 1; // 라인 단위 휠 보정(픽셀 환산)
        if (ev.ctrlKey || ev.metaKey) {      // Ctrl/⌘ + 휠 = 확대/축소 (맥 트랙패드 핀치 포함)
            zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.pow(1.0015, -ev.deltaY * f));
        } else {                             // 일반 휠 / 투핑거 스와이프 = 스크롤(팬)
            panBy(-ev.deltaX * f, -ev.deltaY * f);
        }
    }, { passive: false });

    function marquee(ev) {
        clearSel(); refreshSel(); // 전체 렌더 대신 선택 표시만 갱신 (iframe 재로딩 방지)
        var box = document.createElement('div'); box.className = 'canvas-marquee'; stage.appendChild(box);
        var r = stage.getBoundingClientRect(), x0 = ev.clientX - r.left, y0 = ev.clientY - r.top;
        var w0 = screenToWorld(ev.clientX, ev.clientY);
        function mv(e) {
            var x1 = e.clientX - r.left, y1 = e.clientY - r.top;
            box.style.left = Math.min(x0, x1) + 'px'; box.style.top = Math.min(y0, y1) + 'px';
            box.style.width = Math.abs(x1 - x0) + 'px'; box.style.height = Math.abs(y1 - y0) + 'px';
        }
        function up(e) {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); box.remove();
            var w1 = screenToWorld(e.clientX, e.clientY);
            var rect = { x: Math.min(w0.x, w1.x), y: Math.min(w0.y, w1.y), w: Math.abs(w1.x - w0.x), h: Math.abs(w1.y - w0.y) };
            if (rect.w < 4 && rect.h < 4) return;
            nodes.forEach(function (n) { if (n.type !== 'group' && rectsHit(nodeRect(n), rect)) selNodes[n.id] = true; });
            refreshSel();
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }

    // ───────── 노드 상호작용 ─────────
    nodesEl.addEventListener('mousedown', function (ev) {
        var nodeEl = ev.target.closest('.cnode'); if (!nodeEl) return;
        // 더블클릭 편집 중인 입력 필드(제목/본문/링크) 클릭·드래그 = 텍스트 선택·커서 이동만, 노드는 움직이지 않음
        if (ev.target.closest('.cnode__edit, .cnode__editline') || ev.target.isContentEditable) { ev.stopPropagation(); return; }
        if (spaceDown || ev.button === 1) { ev.preventDefault(); startPan(ev); return; }  // 스페이스/가운데버튼 = 화면 이동
        if (ev.target.closest('.cnode__ytplay, .cnode__video')) return;  // ▶/영상 컨트롤 = 드래그 X (영상 노드 이동은 상단 바·테두리로)
        if (ev.target.closest('.cnode__fold')) { ev.preventDefault(); ev.stopPropagation(); toggleFold(nodeById(nodeEl.dataset.id)); return; }
        if (!admin) {
            if (copyNodeEl === nodeEl && ev.target.closest('.cnode__body, .cnode__file')) return; // 복사 모드: 텍스트 선택 허용
            if (ev.target.closest('a')) return;
            var vn = nodeById(nodeEl.dataset.id);
            if (!vn) { ev.preventDefault(); startPan(ev); return; }
            if (!selNodes[vn.id]) { selNodes = {}; selEdge = null; selNodes[vn.id] = true; refreshSel(); }
            ev.preventDefault(); ev.stopPropagation();
            startDrag(vn, ev); // 방문자: 노드 이동(비영구 — 새로고침 시 관리자 배치로 복원)
            return;
        }
        var n = nodeById(nodeEl.dataset.id); if (!n) return;
        if (ev.target.closest('.chandle')) { ev.stopPropagation(); startConnect(n, ev.target.closest('.chandle').dataset.side, ev); return; }
        if (ev.target.closest('.cres')) { ev.stopPropagation(); startResize(n, ev, ev.target.closest('.cres').dataset.dir); return; }
        if (ev.target.closest('a')) return;
        if (ev.shiftKey) { if (selNodes[n.id]) delete selNodes[n.id]; else selNodes[n.id] = true; selEdge = null; refreshSel(); return; }
        if (!selNodes[n.id]) { selNodes = {}; selEdge = null; selNodes[n.id] = true; refreshSel(); }
        ev.stopPropagation(); startDrag(n, ev);
    });
    nodesEl.addEventListener('dblclick', function (ev) {
        var nodeEl = ev.target.closest('.cnode'); if (!nodeEl) return;
        if (!admin) { enableViewerCopy(nodeEl); return; }
        var n = nodeById(nodeEl.dataset.id); if (!n) return;
        if (n.type === 'group') editGroupLabel(n, nodeEl);
        else if (n.type === 'link') editLink(n, nodeEl);
        else if (!n.type || n.type === 'text') editText(n, nodeEl);
    });
    svg.addEventListener('mousedown', function (ev) { var p = ev.target.closest('.cedge'); if (p) { ev.stopPropagation(); selNodes = {}; selEdge = p.dataset.id; refreshSel(); } });

    var SVGNS = 'http://www.w3.org/2000/svg';
    function snap1(edges3, targets, T) {
        for (var i = 0; i < targets.length; i++) for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++)
            if (Math.abs(edges3[a] - targets[i][b]) < T) return { delta: targets[i][b] - edges3[a], guide: targets[i][b] };
        return null;
    }
    function drawGuides(gx, gy) {
        if (gx != null) { var l = document.createElementNS(SVGNS, 'line'); l.setAttribute('x1', gx); l.setAttribute('y1', -1e5); l.setAttribute('x2', gx); l.setAttribute('y2', 1e5); l.setAttribute('class', 'cguide'); svg.appendChild(l); }
        if (gy != null) { var l2 = document.createElementNS(SVGNS, 'line'); l2.setAttribute('x1', -1e5); l2.setAttribute('y1', gy); l2.setAttribute('x2', 1e5); l2.setAttribute('y2', gy); l2.setAttribute('class', 'cguide'); svg.appendChild(l2); }
    }
    function bezierPath(p1, p2, fromSide, toSide) {
        var dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
        var c1x = p1.x + (fromSide === 'left' ? -dx : fromSide === 'right' ? dx : 0), c1y = p1.y + (fromSide === 'top' ? -dx : fromSide === 'bottom' ? dx : 0);
        var c2x = p2.x + (toSide === 'left' ? -dx : toSide === 'right' ? dx : 0), c2y = p2.y + (toSide === 'top' ? -dx : toSide === 'bottom' ? dx : 0);
        return 'M' + p1.x + ',' + p1.y + ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + p2.x + ',' + p2.y;
    }
    function closestConnectTarget(from, p) {
        var best = null, bestD = CONNECT_SNAP / view.scale;
        nodes.forEach(function (n) {
            if (n === from || n.type === 'group') return;
            ['left', 'right', 'top', 'bottom'].forEach(function (side) {
                var sp = sidePoint(n, side), d = Math.hypot(sp.x - p.x, sp.y - p.y);
                if (d < bestD) { bestD = d; best = { node: n, side: side, point: sp }; }
            });
        });
        return best;
    }
    function setConnectHot(id) {
        nodesEl.querySelectorAll('.cnode').forEach(function (el) { el.classList.toggle('is-connect-hot', !!id && el.dataset.id === id); });
    }
    function collectGroupContents(group, out) {
        var gr = nodeRect(group);
        nodes.forEach(function (o) {
            if (o === group || out[o.id]) return;
            var c = groupMemberPoint(o);
            if (c.x > gr.x && c.x < gr.x + gr.w && c.y > gr.y && c.y < gr.y + gr.h) {
                out[o.id] = o;
                if (o.type === 'group') collectGroupContents(o, out);
            }
        });
    }
    function moveNodeCascade(n, dx, dy, moved) {
        if (!n || moved[n.id]) return;
        moved[n.id] = true;
        // 그룹은 옮기기 전에 자식을 먼저 수집한다 — 멀리 이동(정렬)하면 옮겨진 사각형 밖으로 자식이 빠져 수집에 실패한다
        var inside = null;
        if (n.type === 'group') { inside = {}; collectGroupContents(n, inside); }
        n.x += dx; n.y += dy;
        if (inside) Object.keys(inside).forEach(function (id) { moveNodeCascade(inside[id], dx, dy, moved); });
    }
    function startDrag(n, ev) {
        var movers = selNodes[n.id] ? selList() : [n];
        for (var gi = 0; gi < movers.length; gi++) {
            var m = movers[gi];
            if (m.type === 'group') {
                var gr = nodeRect(m);
                nodes.forEach(function (o) {
                    if (o === m || movers.indexOf(o) >= 0) return;
                    var c = groupMemberPoint(o);
                    if (c.x > gr.x && c.x < gr.x + gr.w && c.y > gr.y && c.y < gr.y + gr.h) movers.push(o);
                });
            }
        }
        var single = (movers.length === 1 && movers[0].type !== 'group') ? movers[0] : null;
        var others = single ? nodes.filter(function (o) { return o !== single && o.type !== 'group'; }) : [];
        var sx = ev.clientX, sy = ev.clientY, orig = movers.map(function (m) { return { m: m, x: m.x, y: m.y }; });
        var moved = false, wasMulti = Object.keys(selNodes).length >= 2;
        function mv(e) {
            if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) <= 3) return; // 임계 이하 = 클릭(이동 아님)
            moved = true;
            var ddx = (e.clientX - sx) / view.scale, ddy = (e.clientY - sy) / view.scale, gx = null, gy = null;
            if (e.shiftKey) {  // Shift = 수평/수직/45° 대각으로만 이동 (스냅 가이드는 생략)
                var adx = Math.abs(ddx), ady = Math.abs(ddy);
                if (adx > ady * 2) ddy = 0;
                else if (ady > adx * 2) ddx = 0;
                else { var mg = Math.max(adx, ady); ddx = (ddx < 0 ? -mg : mg); ddy = (ddy < 0 ? -mg : mg); }
            }
            if (single) {
                var nx = orig[0].x + ddx, ny = orig[0].y + ddy, w = single.width || 250, h = single.height || 60, T = 7 / view.scale;
                if (!e.shiftKey) {
                    var xt = others.map(function (m) { var mw = m.width || 250; return [m.x, m.x + mw / 2, m.x + mw]; });
                    var yt = others.map(function (m) { var mh = m.height || 60; return [m.y, m.y + mh / 2, m.y + mh]; });
                    var sX = snap1([nx, nx + w / 2, nx + w], xt, T); if (sX) { nx += sX.delta; gx = sX.guide; }
                    var sY = snap1([ny, ny + h / 2, ny + h], yt, T); if (sY) { ny += sY.delta; gy = sY.guide; }
                }
                single.x = nx; single.y = ny;
                var el = nodesEl.querySelector('.cnode[data-id="' + cssEsc(single.id) + '"]'); if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }
            } else {
                orig.forEach(function (o) { o.m.x = o.x + ddx; o.m.y = o.y + ddy; var el = nodesEl.querySelector('.cnode[data-id="' + cssEsc(o.m.id) + '"]'); if (el) { el.style.left = o.m.x + 'px'; el.style.top = o.m.y + 'px'; } });
            }
            renderEdges(); drawGuides(gx, gy);
        }
        function up() {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            if (moved) { renderEdges(); markDirty(); }
            // 이동 없이 클릭 + 다중선택이면 이 노드를 정렬 기준(key object)으로 토글
            else if (admin && wasMulti) {
                keyNode = (keyNode === n.id ? null : n.id); refreshSel();
                toast(keyNode ? '기준 노드 — 이 노드를 중심으로 정렬됩니다' : '기준 노드 해제');
            }
        }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function alignSel(mode) {
        if (alignInterceptor && alignInterceptor(mode)) return; // 직접선택 모드에서 앵커 정렬로 가로챔
        var list = selList();
        if (list.length < 2) { toast('2개 이상 선택하세요'); return; }
        // 선택된 그룹 안에 든 노드는 정렬 단위에서 제외 — 그룹이 통째로 움직이며 자식을 끌고 간다
        var selGroups = list.filter(function (n) { return n.type === 'group'; });
        var units = list.filter(function (n) {
            if (n.type === 'group') return true;
            var c = groupMemberPoint(n);
            for (var i = 0; i < selGroups.length; i++) {
                var gr = nodeRect(selGroups[i]);
                if (c.x > gr.x && c.x < gr.x + gr.w && c.y > gr.y && c.y < gr.y + gr.h) return false;
            }
            return true;
        });
        if (units.length < 2) { toast('2개 이상 선택하세요'); return; }
        var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        units.forEach(function (n) { var r = nodeRect(n); minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
        // 기준 노드(key object)가 있으면 그 노드의 변/중심을 기준선으로 — 기준 노드는 안 움직이고 나머지가 맞춰진다
        var keyN = keyNode && selNodes[keyNode] ? nodeById(keyNode) : null;
        if (keyN) { var kr = nodeRect(keyN); minX = kr.x; maxX = kr.x + kr.w; minY = kr.y; maxY = kr.y + kr.h; }
        var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        var moves = [];
        units.forEach(function (n) {
            var w = n.width || 250, h = n.height || 60;
            var nx = n.x, ny = n.y;
            if (mode === 'left') nx = minX; else if (mode === 'right') nx = maxX - w; else if (mode === 'centerH') nx = cx - w / 2;
            else if (mode === 'top') ny = minY; else if (mode === 'bottom') ny = maxY - h; else if (mode === 'centerV') ny = cy - h / 2;
            moves.push({ n: n, dx: nx - n.x, dy: ny - n.y });
        });
        var moved = {};
        moves.forEach(function (m) { moveNodeCascade(m.n, m.dx, m.dy, moved); });
        markDirty(); render();
    }
    function startResize(n, ev, dir) {
        var sx = ev.clientX, sy = ev.clientY, ox = n.x, oy = n.y, ow = n.width || 250, oh = n.height || 60;
        var isExt = !!extRenderers[n.type];
        var minW = isExt ? 8 : 80, minH = isExt ? 8 : 40;
        // 이미지·영상 노드는 항상 비율 유지
        var lockAR = (n.type === 'file' && (isImgFile(n) || isVideoFile(n)) && oh > 0) ? (ow / oh) : 0;
        var others = nodes.filter(function (o) { return o !== n && o.type !== 'group'; });
        var xt = others.map(function (m) { var mw = m.width || 250; return [m.x, m.x + mw / 2, m.x + mw]; });
        var yt = others.map(function (m) { var mh = m.height || 60; return [m.y, m.y + mh / 2, m.y + mh]; });
        function mv(e) {
            var dx = (e.clientX - sx) / view.scale, dy = (e.clientY - sy) / view.scale, nx = ox, ny = oy, nw = ow, nh = oh, T = 7 / view.scale, gx = null, gy = null;
            if (dir.indexOf('e') >= 0) nw = ow + dx;
            if (dir.indexOf('s') >= 0) nh = oh + dy;
            if (dir.indexOf('w') >= 0) { nw = ow - dx; nx = ox + dx; }
            if (dir.indexOf('n') >= 0) { nh = oh - dy; ny = oy + dy; }
            // 움직이는 변을 다른 노드의 모서리/중심에 스냅 + 가이드선
            if (dir.indexOf('e') >= 0) { var se = snap1([nx + nw, nx + nw, nx + nw], xt, T); if (se) { nw += se.delta; gx = se.guide; } }
            if (dir.indexOf('w') >= 0) { var swp = snap1([nx, nx, nx], xt, T); if (swp) { nx += swp.delta; nw -= swp.delta; gx = swp.guide; } }
            if (dir.indexOf('s') >= 0) { var ss = snap1([ny + nh, ny + nh, ny + nh], yt, T); if (ss) { nh += ss.delta; gy = ss.guide; } }
            if (dir.indexOf('n') >= 0) { var sn = snap1([ny, ny, ny], yt, T); if (sn) { ny += sn.delta; nh -= sn.delta; gy = sn.guide; } }
            if (nw < minW) { if (dir.indexOf('w') >= 0) nx -= (minW - nw); nw = minW; }
            if (nh < minH) { if (dir.indexOf('n') >= 0) ny -= (minH - nh); nh = minH; }
            var ar = lockAR || (e.shiftKey && oh > 0 ? ow / oh : 0); // Shift = 비율 유지
            if (ar) {
                if (dir === 'n' || dir === 's') { var w2 = nh * ar; nx = ox + (ow - w2) / 2; nw = w2; }
                else { var h2 = nw / ar; if (dir.indexOf('n') >= 0) ny = oy + oh - h2; nh = h2; }
                gx = null; gy = null; // 비율 고정 중엔 스냅 가이드 생략
            }
            n.x = nx; n.y = ny; n.width = nw; n.height = nh;
            var el = nodesEl.querySelector('.cnode[data-id="' + cssEsc(n.id) + '"]'); if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.width = nw + 'px'; el.style.height = nh + 'px'; }
            renderEdges(); drawGuides(gx, gy);
        }
        function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); renderEdges(); markDirty(); }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function startConnect(from, side, ev) {
        var tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tmp.setAttribute('fill', 'none'); tmp.setAttribute('stroke', '#2d8b8b'); tmp.setAttribute('stroke-width', '2.5'); tmp.setAttribute('stroke-dasharray', '5,5'); tmp.setAttribute('class', 'cconnect-preview'); svg.appendChild(tmp);
        var p1 = sidePoint(from, side);
        var start = { x: ev.clientX, y: ev.clientY }, hot = null;
        function mv(e) {
            var w = screenToWorld(e.clientX, e.clientY);
            hot = closestConnectTarget(from, w);
            setConnectHot(hot && hot.node.id);
            var p2 = hot ? hot.point : w;
            var toSide = hot ? hot.side : nearestSide({ x: w.x - 1, y: w.y - 1, width: 2, height: 2 }, p1.x, p1.y);
            tmp.setAttribute('d', bezierPath(p1, p2, side, toSide));
        }
        function up(e) {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); tmp.remove();
            setConnectHot(null);
            var el = document.elementFromPoint(e.clientX, e.clientY), tEl = el && el.closest ? el.closest('.cnode') : null;
            var w = screenToWorld(e.clientX, e.clientY);
            var target = closestConnectTarget(from, w);
            if (!target && tEl && tEl.dataset.id !== from.id) {
                var raw = nodeById(tEl.dataset.id);
                if (raw && raw.type !== 'group') target = { node: raw, side: nearestSide(raw, w.x, w.y) };
            }
            if (target) {
                edges.push({ id: uid('e'), fromNode: from.id, fromSide: side, toNode: target.node.id, toSide: target.side });
                markDirty(); render();
            } else if (!tEl && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 80) {
                // 빈 곳에 놓으면 새 노드 생성 + 연결 (새 노드는 반대편 변에서 연결)
                var opp = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[side] || 'left';
                var nw0 = 220, nh0 = 70;
                // 끌어낸 방향의 반대 변이 출발 노드를 향하도록 새 노드를 배치
                var nx0 = side === 'left' ? w.x - nw0 : side === 'right' ? w.x : Math.round(w.x - nw0 / 2);
                var ny0 = side === 'top' ? w.y - nh0 : side === 'bottom' ? w.y : Math.round(w.y - nh0 / 2);
                var nn = { id: uid('n'), type: 'text', text: '새 카드', x: Math.round(nx0), y: Math.round(ny0), width: nw0, height: nh0 };
                nodes.push(nn);
                edges.push({ id: uid('e'), fromNode: from.id, fromSide: side, toNode: nn.id, toSide: opp });
                markDirty(); render(); selectOne(nn.id);
                var el2 = nodesEl.querySelector('.cnode[data-id="' + cssEsc(nn.id) + '"]'); if (el2) editText(nn, el2);
            }
        }
        mv(ev);
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function editText(n, el) {
        var body = el.querySelector('.cnode__body'); if (!body) return;
        var ta = document.createElement('textarea'); ta.className = 'cnode__edit'; ta.value = n.text || '';
        body.innerHTML = ''; body.appendChild(ta); ta.focus({ preventScroll: true }); ta.select();
        function done() { n.text = ta.value; markDirty(); render(); }
        ta.addEventListener('blur', done);
        ta.addEventListener('keydown', function (e) { if (e.key === 'Escape') ta.blur(); e.stopPropagation(); });
    }
    function editLineInto(container, value, placeholder, onsave) {
        var inp = document.createElement('input'); inp.className = 'cnode__editline'; inp.value = value || ''; if (placeholder) inp.placeholder = placeholder;
        container.innerHTML = ''; container.appendChild(inp); inp.focus({ preventScroll: true }); inp.select();
        inp.addEventListener('blur', function () { onsave(inp.value); markDirty(); render(); });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); e.stopPropagation(); });
    }
    function editGroupLabel(n, el) { var lab = el.querySelector('.cnode__grouplabel'); if (lab) editLineInto(lab, n.label, '그룹 이름', function (v) { n.label = v; }); }
    function editLink(n, el) {
        // YouTube 임베드는 주소를 직접 편집(영상 교체), 일반 링크는 표시 이름을 편집(주소는 인스펙터에서)
        var isYt = !!ytId(n.url || '');
        if (isYt) {
            el.innerHTML = '<input class="cnode__editline" value="' + esc(n.url || '') + '" placeholder="YouTube 주소">';
            var yi = el.querySelector('input'); if (!yi) { render(); return; }
            yi.focus({ preventScroll: true }); yi.select();
            yi.addEventListener('blur', function () { n.url = yi.value; if (ytId(yi.value)) { n.width = Math.max(n.width || 220, 320); n.height = 180; } markDirty(); render(); });
            yi.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') yi.blur(); e.stopPropagation(); });
            return;
        }
        el.innerHTML = '<div class="cnode__body"><input class="cnode__editline" value="' + esc(n.label || '') + '" placeholder="표시 이름 (비우면 주소 표시)"></div>';
        var inp = el.querySelector('input'); if (!inp) { render(); return; }
        inp.focus({ preventScroll: true }); inp.select();
        inp.addEventListener('blur', function () { var v = inp.value.trim(); if (v) n.label = v; else delete n.label; markDirty(); render(); });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); e.stopPropagation(); });
    }

    // ───────── 키보드 ─────────
    document.addEventListener('keydown', function (e) {
        var tg = e.target.tagName;
        if (e.code === 'Space' && tg !== 'TEXTAREA' && tg !== 'INPUT' && !e.target.isContentEditable) { spaceDown = true; stage.classList.add('is-pan'); }
        if (tg === 'TEXTAREA' || tg === 'INPUT' || e.target.isContentEditable) return;
        var panStep = e.shiftKey ? 320 : 40;
        var pageStep = e.shiftKey ? 1560 : 780;
        var moveStep = e.shiftKey ? 80 : 8;
        var keyMove = null;
        var keyPanStep = panStep;
        if (e.key === 'ArrowLeft') keyMove = { x: -1, y: 0 };
        else if (e.key === 'ArrowRight') keyMove = { x: 1, y: 0 };
        else if (e.key === 'ArrowUp') keyMove = { x: 0, y: -1 };
        else if (e.key === 'ArrowDown') keyMove = { x: 0, y: 1 };
        else if (e.key === 'PageUp') { keyMove = { x: 0, y: -1 }; keyPanStep = pageStep; }
        else if (e.key === 'PageDown') { keyMove = { x: 0, y: 1 }; keyPanStep = pageStep; }
        if (keyMove) {
            e.preventDefault();
            if (admin && Object.keys(selNodes).length) {
                var movedByKey = {};
                selList().forEach(function (n) {
                    moveNodeCascade(n, keyMove.x * moveStep, keyMove.y * moveStep, movedByKey);
                });
                markDirty(); render();
            } else {
                panBy(-keyMove.x * keyPanStep, -keyMove.y * keyPanStep);
            }
            return;
        }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); return; }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.25); return; }
        // F: 선택 노드 접기/펼치기 (방문자도 가능 — 비영구)
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F') && Object.keys(selNodes).length) { e.preventDefault(); foldSelection(); return; }
        if (!admin) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); return; }
        if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'c' || e.key === 'C' || e.code === 'KeyC')) { e.preventDefault(); fitContent(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) { if (selectionGraph()) { e.preventDefault(); if (!document.execCommand || !document.execCommand('copy')) copySelection(); } return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selNodes = {}; selEdge = null; nodes.forEach(function (n) { selNodes[n.id] = true; }); refreshSel(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); if (selList().some(function (n) { return n.type === 'group'; })) ungroupSelection(); else groupSelection(); return; }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); if (selList().some(function (n) { return n.type === 'group'; })) ungroupSelection(); else groupSelection(); return; }
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') { e.preventDefault(); addNode('text'); return; }
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyL') { e.preventDefault(); addNode('link'); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { delSelection(); e.preventDefault(); }
        if (selEdge === null && '0123456'.indexOf(e.key) >= 0 && Object.keys(selNodes).length) { selList().forEach(function (n) { if (e.key === '0') delete n.color; else n.color = e.key; }); markDirty(); render(); }
    });
    document.addEventListener('keyup', function (e) { if (e.code === 'Space') { spaceDown = false; stage.classList.remove('is-pan'); } });
    // 노드 크기를 내용물에 맞춤 (Ctrl+Alt+C) — 텍스트·링크: 글 크기, 이미지: 원본 비율
    function fitContent() {
        var list = selList();
        if (!list.length) { toast('선택된 노드가 없습니다'); return; }
        var changed = false;
        list.forEach(function (n) {
            var el = nodesEl.querySelector('.cnode[data-id="' + cssEsc(n.id) + '"]'); if (!el) return;
            if (n.type === 'file' && isImgFile(n)) {
                var img = el.querySelector('img'); if (!img || !img.naturalWidth) return;
                var cr = n.crop, ar = cr ? (img.naturalWidth * cr.w) / (img.naturalHeight * cr.h) : img.naturalWidth / img.naturalHeight;
                n.height = Math.max(8, Math.round((n.width || 250) / ar)); changed = true;
            } else if (!n.type || n.type === 'text' || n.type === 'link') {
                var body = el.querySelector('.cnode__body'); if (!body) return;
                var wrap = document.createElement('div'); wrap.className = 'cnode';
                wrap.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;width:auto;height:auto;padding:0;border:none;overflow:visible;';
                var probe = body.cloneNode(true);
                probe.style.width = 'max-content'; probe.style.maxWidth = '600px'; probe.style.height = 'auto'; probe.style.overflow = 'visible';
                wrap.appendChild(probe); document.body.appendChild(wrap);
                var w = probe.offsetWidth, h = probe.offsetHeight; wrap.remove();
                var cs = getComputedStyle(el);
                var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
                var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
                n.width = Math.max(40, Math.ceil(w + padX + 2));
                n.height = Math.max(24, Math.ceil(h + padY + 2));
                if (n.collapsed) { delete n.collapsed; delete n.expandedHeight; } // 내용 크기로 맞췄으니 펼침
                changed = true;
            }
        });
        if (changed) { markDirty(); render(); toast('내용 크기에 맞췄습니다'); }
    }
    function delSelection() {
        if (selEdge) { edges = edges.filter(function (x) { return x.id !== selEdge; }); selEdge = null; }
        var ids = selNodes; if (Object.keys(ids).length) { nodes = nodes.filter(function (n) { return !ids[n.id]; }); edges = edges.filter(function (ed) { return !ids[ed.fromNode] && !ids[ed.toNode]; }); selNodes = {}; }
        if (activeVid && !nodeById(activeVid)) activeVid = null;
        markDirty(); render();
    }

    // ───────── 인스펙터(색/글자색/그룹/삭제) ─────────
    var inspector;
    function buildInspector() {
        inspector = document.createElement('div'); inspector.className = 'canvas-inspector'; inspector.style.display = 'none';
        // 색/굵기/글자/순서 행은 canvas-vector.js가 이 액션 행 앞에 끼워 넣는다
        var acts = document.createElement('div'); acts.className = 'ci-row ci-acts';
        function act(label, title, fn, cls) {
            var b = document.createElement('button'); b.className = 'ci-act' + (cls ? ' ' + cls : '');
            b.textContent = label; b.title = title; b.onclick = fn; acts.appendChild(b);
        }
        act('그룹', '그룹 묶기 (G)', groupSelection);
        act('해제', '그룹 해제 (G)', ungroupSelection);
        act('맞춤', '내용 크기에 맞춤 (Ctrl+Alt+C)', fitContent);
        act('삭제', '선택 삭제 (Delete)', delSelection, 'ci-act--del');
        inspector.appendChild(acts);
        stage.appendChild(inspector);
    }
    function updateInspector() {
        for (var i = 0; i < renderHooks.length; i++) try { renderHooks[i](); } catch (x) {}
        if (!admin) return; if (!inspector) buildInspector();
        inspector.style.display = Object.keys(selNodes).length ? 'block' : 'none';
    }

    // ───────── 그룹 ─────────
    function groupSelection() {
        var list = selList(); if (!list.length) return;
        var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        list.forEach(function (n) { var r = nodeRect(n); minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
        var pad = 24;
        var gid = uid('g');
        nodes.push({ id: gid, type: 'group', label: '그룹', x: minX - pad, y: minY - pad - 18, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 + 18 });
        selNodes = {}; selNodes[gid] = true; selEdge = null;  // 그룹 선택 → Ctrl+G 다시 누르면 해제
        markDirty(); render();
    }
    function ungroupSelection() {
        var removed = false;
        selList().forEach(function (n) { if (n.type === 'group') { nodes = nodes.filter(function (x) { return x.id !== n.id; }); delete selNodes[n.id]; removed = true; } });
        if (removed) { markDirty(); render(); } else { toast('해제할 그룹을 선택하세요'); }
    }

    // ───────── 추가/맞춤/저장/입출력 ─────────
    function centerWorld() { var r = stage.getBoundingClientRect(); return screenToWorld(r.left + stage.clientWidth / 2, r.top + stage.clientHeight / 2); }
    // 노드+엣지를 id 재매핑하여 화면 중앙에 삽입 (붙여넣기용 — 화살표 연결 보존)
    function insertGraph(srcNodes, srcEdges) {
        var idMap = {}, added = [];
        (srcNodes || []).forEach(function (n) { var nn = clone(n); idMap[nn.id] = uid('n'); nn.id = idMap[nn.id]; added.push(nn); });
        if (added.length) {
            var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
            added.forEach(function (n) { var w = n.width || 250, h = n.height || 60; minX = Math.min(minX, n.x || 0); minY = Math.min(minY, n.y || 0); maxX = Math.max(maxX, (n.x || 0) + w); maxY = Math.max(maxY, (n.y || 0) + h); });
            var c = centerWorld(), ox = c.x - (minX + maxX) / 2, oy = c.y - (minY + maxY) / 2;
            added.forEach(function (n) { n.x = Math.round((n.x || 0) + ox); n.y = Math.round((n.y || 0) + oy); nodes.push(n); });
        }
        (srcEdges || []).forEach(function (ed) { if (idMap[ed.fromNode] && idMap[ed.toNode]) { var ee = Object.assign({}, ed); ee.id = uid('e'); ee.fromNode = idMap[ed.fromNode]; ee.toNode = idMap[ed.toNode]; edges.push(ee); } });
        markDirty(); render();
    }
    function selectionGraph() {
        var list = selList();
        if (!list.length) return null;
        var ids = {};
        list.forEach(function (n) { ids[n.id] = true; });
        return { nodes: clone(list), edges: clone(edges.filter(function (ed) { return ids[ed.fromNode] && ids[ed.toNode]; })) };
    }
    function copySelection(e) {
        var graph = selectionGraph();
        if (!graph) return false;
        canvasClipboard = graph;
        var txt = JSON.stringify(graph);
        if (e && e.clipboardData) {
            e.clipboardData.setData('application/json', txt);
            e.clipboardData.setData('text/plain', txt);
            e.preventDefault();
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).catch(function () {});
        }
        toast('Copied ' + graph.nodes.length + ' item(s)');
        return true;
    }
    function pasteGraph(graph) {
        if (!graph || !graph.nodes || !graph.nodes.length) return false;
        insertGraph(graph.nodes, graph.edges || []);
        return true;
    }
    function addNode(type) {
        var c = centerWorld(), n = { id: uid('n'), type: type, x: Math.round(c.x - 110), y: Math.round(c.y - 40), width: 220, height: 80 };
        if (type === 'text') n.text = '새 카드';
        if (type === 'link') { n.url = ''; n.height = 70; }
        nodes.push(n); markDirty(); render(); selectOne(n.id);
        var el = nodesEl.querySelector('.cnode[data-id="' + cssEsc(n.id) + '"]');
        if (el) { if (type === 'link') editLink(n, el); else if (type === 'text') editText(n, el); }
    }
    function fit() {
        if (!nodes.length) { view = { x: stage.clientWidth / 2, y: stage.clientHeight / 2, scale: 1 }; applyView(); return; }
        var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        nodes.forEach(function (n) { var r = nodeRect(n); minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
        var pad = 80, bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2, s = Math.min(stage.clientWidth / bw, stage.clientHeight / bh, 1.5);
        view.scale = s; view.x = stage.clientWidth / 2 - (minX + (maxX - minX) / 2) * s; view.y = stage.clientHeight / 2 - (minY + (maxY - minY) / 2) * s; applyView();
    }
    var fileHandle = null;
    function canvasPayload() {
        CFG.title = (document.querySelector('.canvas-title') && document.querySelector('.canvas-title').textContent.trim()) || CFG.title || 'canvas';
        return { app: 'ICE Canvas', version: 1, title: CFG.title || 'canvas', slug: CFG.slug || 'canvas', nodes: nodes, edges: edges, updatedAt: new Date().toISOString() };
    }
    function payloadText() { return JSON.stringify(canvasPayload(), null, 2); }
    function fallbackDownload() {
        var blob = new Blob([payloadText()], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ((CFG.title || CFG.slug || 'canvas').replace(/[\\/:*?"<>|]+/g, '_') || 'canvas') + '.icv';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    async function writeHandle(handle) {
        var writable = await handle.createWritable();
        await writable.write(payloadText());
        await writable.close();
    }
    async function saveAs() {
        if (window.ICECanvasNative && window.ICECanvasNative.saveAs) {
            var nativePath = await window.ICECanvasNative.saveAs(payloadText(), CFG.title || CFG.slug || 'canvas');
            if (nativePath === null) return;
        } else
        if (window.showSaveFilePicker) {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: ((CFG.title || CFG.slug || 'canvas').replace(/[\\/:*?"<>|]+/g, '_') || 'canvas') + '.icv',
                types: [{ description: 'ICE Canvas', accept: { 'application/json': ['.icv', '.canvas'] } }]
            });
            await writeHandle(fileHandle);
        } else {
            fallbackDownload();
        }
        dirty = false;
        var btn = document.getElementById('canvasSaveBtn');
        if (btn) btn.classList.remove('is-dirty');
        try { localStorage.setItem('icecanvas.autosave.v2', JSON.stringify(canvasPayload())); } catch (x) {}
        toast('저장했습니다');
    }
    async function save() {
        try {
            if (window.ICECanvasNative && window.ICECanvasNative.save) {
                var nativePath = await window.ICECanvasNative.save(payloadText(), CFG.title || CFG.slug || 'canvas');
                if (nativePath === null) return;
            } else if (fileHandle) {
                await writeHandle(fileHandle);
            } else if (window.__ICE_HAS_STARTUP_PATH__) {
                var res = await fetch('/save-current', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payloadText() });
                if (!res.ok) throw new Error('save-current failed');
            } else {
                await saveAs();
                return;
            }
            dirty = false;
            var btn = document.getElementById('canvasSaveBtn');
            if (btn) btn.classList.remove('is-dirty');
            try { localStorage.setItem('icecanvas.autosave.v2', JSON.stringify(canvasPayload())); } catch (x) {}
            toast('저장했습니다');
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            toast('저장에 실패했습니다');
        }
    }
    function exportCanvas() { saveAs(); }
    var DONATE_URL = 'https://buymeacoffee.com/icenovel';
    function openDonate() {
        if (window.ICECanvasNative && window.ICECanvasNative.openInBrowser) {
            window.ICECanvasNative.openInBrowser(DONATE_URL)
                .catch(function (err) { console.error('Failed to open donate link:', err); });
        } else {
            window.open(DONATE_URL, '_blank', 'noopener');
        }
    }
    document.querySelectorAll('.canvas-page [data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
            var a = b.dataset.act;
            if (a === 'add-text') addNode('text');
            else if (a === 'add-link') addNode('link');
            else if (a === 'group') { if (selList().some(function (n) { return n.type === 'group'; })) ungroupSelection(); else groupSelection(); }
            else if (a === 'fit') fit();
            else if (a === 'zoom-in') zoomBy(1.25);
            else if (a === 'zoom-out') zoomBy(1 / 1.25);
            else if (a === 'zoom-reset') zoomBy(1 / view.scale);
            else if (a === 'export' || a === 'save-as') saveAs();
            else if (a === 'save') save();
            else if (a === 'open-native' && window.ICECanvasNative) window.ICECanvasNative.open();
            else if (a === 'donate') openDonate();
            else if (a === 'dark') toggleDark();
            else if (a === 'toggle-public') togglePublic();
            else if (a === 'copy-link') copyLink();
            else if (a.indexOf('align-') === 0) alignSel(a.slice(6));
        });
    });
    function visLabel(v) { return v === 2 ? '🔗 일부공개' : v === 0 ? '🔒 비공개' : '🌐 공개'; }
    function updatePublicBtn() {
        var b = document.querySelector('[data-act="toggle-public"]'); if (b) { b.textContent = visLabel(CFG.vis); b.classList.toggle('is-private', CFG.vis !== 1); }
        var cb = document.getElementById('canvasCopyLink'); if (cb) cb.style.display = (CFG.vis === 2 ? '' : 'none');
    }
    function togglePublic() { CFG.vis = (CFG.vis === 1 ? 2 : CFG.vis === 2 ? 0 : 1); updatePublicBtn(); save(); toast('공개 범위: ' + visLabel(CFG.vis) + (CFG.vis === 2 ? ' (링크 가진 사람만)' : '')); }
    function copyLink() {
        var u = location.href.split('#')[0];
        function done() { toast('링크 복사됨 — ' + u); }
        function fb() { var t = document.createElement('textarea'); t.value = u; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (x) { toast(u); } t.remove(); }
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(u).then(done, fb); } else { fb(); }
    }
    updatePublicBtn();
    var pdfIn = document.getElementById('canvasPdfIn');
    if (pdfIn) pdfIn.addEventListener('change', function () { var f = this.files[0]; if (f) uploadFileNode(f); this.value = ''; });
    var fileIn = document.getElementById('canvasFileIn');
    if (fileIn) fileIn.addEventListener('change', function () { var fs = this.files || []; for (var i = 0; i < fs.length; i++) uploadFileNode(fs[i]); this.value = ''; });

    // ───────── 드래그앤드롭 (관리자) — 파일/이미지/PDF/URL을 드롭 위치에 추가 ─────────
    if (admin) {
        var dropDepth = 0, internalDrag = false;
        // 캔버스 내부 요소(다운로드 버튼·링크·텍스트 선택)를 끈 경우 표시. 외부 파일 드롭은 dragstart가 안 떠서 false 유지.
        document.addEventListener('dragstart', function (e) { internalDrag = stage.contains(e.target); }, true);
        document.addEventListener('dragend', function () { internalDrag = false; dropDepth = 0; stage.classList.remove('is-dropping'); });
        function hasFiles(dt) { if (!dt) return false; if (dt.files && dt.files.length) return true; var t = dt.types || []; for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true; return false; }
        stage.addEventListener('dragover', function (e) { if (internalDrag) return; if (!hasFiles(e.dataTransfer) && !(e.dataTransfer && (e.dataTransfer.types || []).length)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
        stage.addEventListener('dragenter', function (e) { if (internalDrag) return; e.preventDefault(); dropDepth++; stage.classList.add('is-dropping'); });
        stage.addEventListener('dragleave', function () { dropDepth = Math.max(0, dropDepth - 1); if (!dropDepth) stage.classList.remove('is-dropping'); });
        stage.addEventListener('drop', function (e) {
            dropDepth = 0; stage.classList.remove('is-dropping');
            if (internalDrag) { internalDrag = false; return; }  // 내부 요소를 끈 것 — 새 노드 만들지 않음
            e.preventDefault();
            var dt = e.dataTransfer; if (!dt) return;
            var at = screenToWorld(e.clientX, e.clientY);
            if (dt.files && dt.files.length) {
                for (var i = 0; i < dt.files.length; i++) uploadFileNode(dt.files[i], { x: at.x + i * 24, y: at.y + i * 24 });
                return;
            }
            var uri = ''; try { uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim(); } catch (x) {}
            if (!uri) return;
            if (ytId(uri) || /^https?:\/\/\S+$/.test(uri)) {
                var yt = !!ytId(uri), lw = yt ? 320 : 240, lh = yt ? 180 : 70;
                nodes.push({ id: uid('n'), type: 'link', url: uri, x: Math.round(at.x - lw / 2), y: Math.round(at.y - lh / 2), width: lw, height: lh });
                markDirty(); render(); toast(yt ? '유튜브 추가' : '링크 추가');
            } else {
                nodes.push({ id: uid('n'), type: 'text', text: uri, x: Math.round(at.x - 110), y: Math.round(at.y - 40), width: 240, height: 100 });
                markDirty(); render(); toast('텍스트 카드 추가');
            }
        });
    }
    function loadCanvasDocument(d, message) {
        var body = d.data || d;
        if (d.title) {
            CFG.title = d.title;
            var titleEl = document.querySelector('.canvas-title');
            if (titleEl) titleEl.textContent = d.title;
        }
        nodes = body.nodes || [];
        edges = body.edges || [];
        clearSel();
        dirty = false;
        render();
        fit();
        var btn = document.getElementById('canvasSaveBtn');
        if (btn) btn.classList.remove('is-dirty');
        if (message) toast(message);
    }
    window.ICECanvasLoadDocument = loadCanvasDocument;
    var imp = document.getElementById('canvasImport');
    if (imp) imp.addEventListener('change', function () {
        var f = this.files[0]; if (!f) return; var rd = new FileReader();
        rd.onload = function () { try { loadCanvasDocument(JSON.parse(rd.result), '가져옴'); markDirty(); } catch (e) { toast('잘못된 .icv/.canvas 파일'); } };
        rd.readAsText(f);
    });

    // ───────── 붙여넣기 (이미지 / 텍스트 / .canvas JSON) ─────────
    document.addEventListener('copy', function (e) {
        if (!admin) return;
        var t = (e.target && e.target.tagName); if (t === 'TEXTAREA' || t === 'INPUT' || e.target.isContentEditable) return;
        copySelection(e);
    });

    document.addEventListener('paste', function (e) {
        if (!admin) return;
        var t = (e.target && e.target.tagName); if (t === 'TEXTAREA' || t === 'INPUT') return;
        var items = e.clipboardData && e.clipboardData.items;
        if (items) {
            for (var i = 0; i < items.length; i++) {
                if (items[i].type && (items[i].type.indexOf('image') === 0 || items[i].type === 'application/pdf')) {
                    e.preventDefault(); var file = items[i].getAsFile(); if (file) uploadFileNode(file); return;
                }
            }
        }
        var cd = e.clipboardData; var txt = '';
        if (cd) {
            txt = cd.getData('text/plain') || '';
            if (!txt) {
                (cd.types || []).forEach(function (ty) {
                    if (txt) return; var v = ''; try { v = cd.getData(ty); } catch (x) {}
                    if (!v) return;
                    if (ty === 'text/html') { var tmp = document.createElement('div'); tmp.innerHTML = v; txt = (tmp.textContent || '').trim(); }
                    else txt = v;
                });
            }
        }
        if (!txt && canvasClipboard) { e.preventDefault(); pasteGraph(canvasClipboard); return; }
        if (!txt) { toast('붙여넣을 내용이 없습니다 — 옵시디언 캔버스는 .canvas 파일을 "가져오기" 하세요'); return; }
        e.preventDefault();
        var parsed = null; try { parsed = JSON.parse(txt); } catch (x) {}
        if (parsed && (parsed.nodes || parsed.edges)) {
            insertGraph(parsed.nodes || [], parsed.edges || []);
            toast('붙여넣음 (' + (parsed.nodes || []).length + '개)');
        } else if (ytId(txt) || /^https?:\/\/\S+$/.test(txt.trim())) {
            var cc = centerWorld(), yt = !!ytId(txt), lw = yt ? 320 : 240, lh = yt ? 180 : 70;
            nodes.push({ id: uid('n'), type: 'link', url: txt.trim(), x: Math.round(cc.x - lw / 2), y: Math.round(cc.y - lh / 2), width: lw, height: lh });
            markDirty(); render(); toast(yt ? '유튜브 추가' : '링크 추가');
        } else {
            var c = centerWorld(); nodes.push({ id: uid('n'), type: 'text', text: txt, x: Math.round(c.x - 110), y: Math.round(c.y - 40), width: 240, height: 100 }); markDirty(); render(); toast('텍스트 카드 추가');
        }
    });
    // file 업로드 → file 노드 생성. at(월드좌표) 생략 시 화면 중앙. 이미지/PDF는 미리보기 노드, 그 외는 다운로드 파일 노드.
    function uploadFileNode(file, at) {
        var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
        var isImg = /^image\//.test(file.type || '') || IMG_RE.test(file.name || '');
        var isVideo = /^video\//.test(file.type || '') || VIDEO_RE.test(file.name || '');
        var maxBytes = 100 * 1024 * 1024;
        if (file.size > maxBytes) { toast('파일이 너무 큽니다. 최대 100MB (' + (file.size / 1048576).toFixed(1) + 'MB)'); return; }
        var rd = new FileReader();
        rd.onload = function () {
            var p = at || centerWorld();
            var dataUrl = rd.result;
            if (isPdf) {
                var pw = 300, ph = 64;
                nodes.push({ id: uid('n'), type: 'file', file: dataUrl, name: file.name || 'PDF', x: Math.round(p.x - pw / 2), y: Math.round(p.y - ph / 2), width: pw, height: ph });
                markDirty(); render(); toast('PDF \uCD94\uAC00\uB428');
                return;
            }
            if (isVideo) {
                var vw = 400, vh = 256;
                nodes.push({ id: uid('n'), type: 'file', file: dataUrl, name: file.name || '\uB3D9\uC601\uC0C1', x: Math.round(p.x - vw / 2), y: Math.round(p.y - vh / 2), width: vw, height: vh });
                markDirty(); render(); toast('\uC791\uC5C5 \uC644\uB8CC');
                return;
            }
            if (!isImg) {
                var fw = 260, fh = 64;
                nodes.push({ id: uid('n'), type: 'file', file: dataUrl, name: file.name || '\uD30C\uC77C', x: Math.round(p.x - fw / 2), y: Math.round(p.y - fh / 2), width: fw, height: fh });
                markDirty(); render(); toast('\uC791\uC5C5 \uC644\uB8CC');
                return;
            }
            var probe = new Image();
            probe.onload = function () {
                var maxW = 320, w = Math.min(maxW, probe.naturalWidth || maxW);
                var h = Math.round(w * ((probe.naturalHeight || 1) / (probe.naturalWidth || 1)));
                nodes.push({ id: uid('n'), type: 'file', file: dataUrl, name: file.name || '', x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), width: Math.round(w), height: h });
                markDirty(); render(); toast('\uC791\uC5C5 \uC644\uB8CC');
            };
            probe.onerror = function () { nodes.push({ id: uid('n'), type: 'file', file: dataUrl, name: file.name || '', x: Math.round(p.x - 120), y: Math.round(p.y - 90), width: 240, height: 180 }); markDirty(); render(); };
            probe.src = dataUrl;
        };
        rd.onerror = function () { toast('파일을 읽을 수 없습니다'); };
        try {
            rd.readAsDataURL(file);
        } catch (e) {
            toast('파일을 읽을 수 없습니다');
        }
    }

    function applyDark(on) { stage.classList.toggle('is-dark', on); var b = document.getElementById('canvasDark'); if (b) b.textContent = on ? '☀️' : '🌙'; }
    function toggleDark() { var on = !stage.classList.contains('is-dark'); applyDark(on); try { localStorage.setItem('canvasDark', on ? '1' : '0'); } catch (x) {} }
    applyDark((function () { try { return localStorage.getItem('canvasDark') === '1'; } catch (x) { return false; } })());

    function cleanToast(m) {
        m = String(m || '');
        if (!m) return '완료되었습니다';
        var broken = m.indexOf('�') >= 0 || m.indexOf('??') >= 0 || /[罹留吏鍮議燧截筌鈺]/.test(m);
        if (broken) {
            if (/fail|error|not|실패|없음/i.test(m)) return '작업에 실패했습니다';
            if (/PDF/i.test(m)) return 'PDF 추가됨';
            return '작업 완료';
        }
        return m;
    }
    function toast(m) { var t = document.createElement('div'); t.className = 'canvas-toast'; t.textContent = cleanToast(m); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2500); }
    window.ICECanvasToast = toast;
    document.addEventListener('mousemove', function (e) { lastMouse = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('beforeunload', function (e) { if (admin && dirty) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('message', function (e) {
        if (!activeVid || typeof e.data !== 'string' || (e.origin || '').indexOf('youtube.com') < 0) return;
        var d; try { d = JSON.parse(e.data); } catch (x) { return; }
        if (d.event === 'infoDelivery' && d.info && typeof d.info.currentTime === 'number') setVt(activeVid, d.info.currentTime);
    });
    if (hint) {
        var helpItems = admin
            ? [
                '빈 곳 드래그: 박스 선택',
                'Space + 드래그: 캔버스 이동',
                '방향키: 선택 노드 이동, 선택이 없으면 캔버스 이동',
                'Shift + 방향키: 더 크게 이동',
                'PageUp / PageDown: 위아래로 이동',
                '휠 / 트랙패드 스와이프: 스크롤, Ctrl(⌘)+휠: 확대/축소, +/- 도 확대/축소',
                'Alt+N: 새 카드, Alt+L: 링크 상자',
                '더블클릭: 카드/링크/그룹 이름 편집',
                '점 드래그: 노드 연결, 빈 곳에 놓으면 새 카드 생성',
                'Delete: 선택 삭제',
                'Ctrl+A: 전체 선택',
                'G 또는 Ctrl+G: 그룹/그룹해제',
                '정렬(2개+ 선택): Q 위·U 아래·L 왼쪽·R 오른쪽·H 세로중앙·C 가로중앙',
                '정렬 기준 노드: 여러 개 선택 후 한 노드를 다시 클릭하면 기준(진한 테두리) — 기준은 고정되고 나머지가 거기에 맞춰 정렬, 다시 클릭하면 해제',
                '그룹 정렬: 그룹이 자식과 함께 통째로 이동',
                '그룹 편집: 선택 후 인스펙터에서 이름·글자크기·면색·선색·글자색 변경',
                '긴 카드 접기: 카드 우상단 버튼 또는 F 키로 접기·펼치기',
                '이동 중 Shift: 수평·수직·45° 대각선으로만 이동',
                'V·A·P·M·L: 선택 / 직접선택 / 펜 / 사각형 / 원 도구',
                'D: 기본 색(흰 면+검은 선), X: 면↔선 전환, Shift+X: 색 맞바꿈, /: 색 없음',
                'Ctrl+Alt+C: 노드 크기를 내용물에 맞춤',
                'Shift + 크기조절: 비율 유지, 회전 핸들 + Shift: 15도 스냅',
                '코너 라운드: 노드 선택 후 좌상단 주황 점을 드래그 (기본은 사각형)',
                'Alt+] / Alt+[: 앞으로/뒤로, Shift 추가: 맨앞/맨뒤 (Ctrl도 가능)',
                '펜(P): 클릭=직선, 드래그=곡선, 첫 점 클릭=패스 닫기, Enter=완료, Esc=취소',
                '펜(P) + 선택한 패스: 선분 클릭=앵커 추가, 앵커 클릭=앵커 삭제, 열린 끝점 클릭=이어 그리기',
                '직접선택(A): 선 근처 클릭=앵커 표시, 앵커 드래그=이동, 더블클릭=직선↔곡선, Delete=앵커 삭제',
                '직접선택 정렬: 여러 박스의 모서리(또는 패스 앵커)를 드래그로 선택 → 정렬키로 그 변만 정렬 (예: 박스들 오른쪽만 드래그 후 R = 우측 너비 정렬)',
                '직접선택 변형: 선택한 앵커/모서리를 드래그 또는 방향키로 이동 → 노드 형태 변형 (선택 안 된 앵커는 고정), Shift+방향키=10px',
                '펜/직접선택 + Alt: 선분 클릭=앵커 추가, 앵커 클릭=앵커 삭제, 앵커 드래그=핸들 생성, 핸들 클릭=핸들 삭제',
                'PDF: ↗ 버튼으로 브라우저 새 탭에서 열기, ⬇로 다운로드',
                '이미지 더블클릭: 크롭 (Enter 적용, Esc 취소)',
                '파일 추가: 레일의 파일 버튼 또는 캔버스에 드래그앤드롭 (최대 10MB)',
                '파일 노드: 파일명 옆 ⬇ 버튼으로 다운로드'
            ]
            : [
                '빈 곳 드래그: 캔버스 이동',
                '노드 드래그: 위치 이동 (새로고침하면 원래대로 복원)',
                '노드 클릭 후 F: 긴 노드 접기/펼치기',
                '노드 더블클릭: 텍스트 선택 후 복사 (편집은 불가)',
                '방향키: 캔버스 이동',
                'Shift + 방향키: 더 크게 이동',
                'PageUp / PageDown: 위아래로 이동',
                '휠 / 트랙패드 스와이프: 스크롤',
                'Ctrl(⌘) + 휠: 확대/축소'
            ];
        // 모달: 상단바 '사용방법' 버튼으로 연다 (관리자·방문자 공통)
        hint.className = 'canvas-modal';
        hint.hidden = true;
        hint.innerHTML = '<div class="canvas-modal__backdrop"></div>' +
            '<div class="canvas-modal__dialog" role="dialog" aria-modal="true" aria-label="캔버스 사용방법">' +
            '<div class="canvas-modal__head"><strong>캔버스 사용방법</strong><button type="button" class="canvas-modal__close" aria-label="닫기">×</button></div>' +
            '<ul class="canvas-modal__list">' + helpItems.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul></div>';
        document.body.appendChild(hint); // 변형된 조상에 클립되지 않도록 body로
        function setHelp(open) { if (open) hint.classList.toggle('is-dark', stage.classList.contains('is-dark')); hint.hidden = !open; }
        hint.querySelector('.canvas-modal__close').addEventListener('click', function () { setHelp(false); });
        hint.querySelector('.canvas-modal__backdrop').addEventListener('click', function () { setHelp(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !hint.hidden) setHelp(false); });
        document.querySelectorAll('[data-act="help"]').forEach(function (b) { b.addEventListener('click', function () { setHelp(hint.hidden); }); });
    }
    if (!admin) document.addEventListener('mousedown', function (e) { if (copyNodeEl && !copyNodeEl.contains(e.target)) clearViewerCopy(); });

    // 캔버스 제목 인라인 수정 (관리자, 더블클릭)
    if (admin) {
        var titleEl = document.querySelector('.canvas-title');
        if (titleEl) {
            titleEl.title = '더블클릭하여 제목 수정';
            titleEl.addEventListener('dblclick', function () {
                titleEl.contentEditable = 'true'; titleEl.focus({ preventScroll: true });
                var rg = document.createRange(); rg.selectNodeContents(titleEl); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
            });
            titleEl.addEventListener('blur', function () {
                if (titleEl.contentEditable !== 'true') return;
                titleEl.contentEditable = 'false';
                var v = titleEl.textContent.trim();
                if (v && v !== CFG.title) { CFG.title = v; markDirty(); } else { titleEl.textContent = CFG.title; }
            });
            titleEl.addEventListener('keydown', function (e) { if (titleEl.isContentEditable) { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } else if (e.key === 'Escape') { titleEl.textContent = CFG.title; titleEl.blur(); } } });
        }
    }

    // ───────── 확장 모듈 API (canvas-vector.js / canvas-crop.js) ─────────
    window.__CANVAS_CORE__ = {
        cfg: CFG, admin: admin, stage: stage, world: world, svg: svg, nodesEl: nodesEl, view: view,
        get nodes() { return nodes; }, set nodes(v) { nodes = v; },
        get edges() { return edges; }, set edges(v) { edges = v; },
        get selNodes() { return selNodes; }, set selNodes(v) { selNodes = v; },
        render: render, refreshSel: refreshSel, markDirty: markDirty, renderEdges: renderEdges, editText: editText,
        screenToWorld: screenToWorld, centerWorld: centerWorld,
        selectOne: selectOne, clearSel: clearSel, selList: selList, nodeById: nodeById,
        uid: uid, esc: esc, cssEsc: cssEsc, toast: toast, nodeRect: nodeRect,
        alignSel: alignSel,
        setAlignInterceptor: function (fn) { alignInterceptor = fn; },
        registerRenderer: function (t, fn) { extRenderers[t] = fn; },
        onRender: function (fn) { renderHooks.push(fn); },
        inspectorEl: function () { if (!inspector) buildInspector(); return inspector; }
    };

    render(); fit();
})();
