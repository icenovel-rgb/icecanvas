/* icenovel 캔버스 이미지 크롭 — 비파괴 크롭 (원본 보존, 보이는 영역만 저장)
   진입: 이미지 노드 더블클릭 / 적용: Enter·더블클릭·바깥 클릭·✓ / 취소: Esc·× 버튼
   저장: n.crop = { x, y, w, h } (원본 대비 0~1 비율) — 렌더는 canvas.js 코어가 담당 */
(function () {
    'use strict';
    var C = window.__CANVAS_CORE__;
    if (!C || !C.admin) return;
    var IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
    function isImgFile(n) { var f = (n && n.file) || ''; return /^data:image\//i.test(f) || IMG_RE.test(f) || IMG_RE.test((n && n.name) || ''); }
    var crop = null; // { n, f:{x,y,w,h} 원본 월드 영역, b:{x,y,w,h} 크롭 박스, el, box, img, ne }

    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    function start(n) {
        var cr = n.crop || { x: 0, y: 0, w: 1, h: 1 };
        var bw = n.width || 250, bh = n.height || 60;
        var fw = bw / cr.w, fh = bh / cr.h;
        var f = { x: n.x - cr.x * fw, y: n.y - cr.y * fh, w: fw, h: fh };
        crop = { n: n, f: f, b: { x: n.x, y: n.y, w: bw, h: bh } };
        var src = n.file || '';
        var el = document.createElement('div');
        el.className = 'crop-layer';
        el.style.left = f.x + 'px'; el.style.top = f.y + 'px';
        el.style.width = f.w + 'px'; el.style.height = f.h + 'px';
        var handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(function (d) { return '<span data-cd="' + d + '"></span>'; }).join('');
        el.innerHTML =
            '<img class="crop-ghost" src="' + C.esc(src) + '" alt="" draggable="false">' +
            '<div class="crop-box"><div class="crop-clip"><img src="' + C.esc(src) + '" alt="" draggable="false"></div>' + handles + '</div>' +
            '<div class="crop-bar"><button type="button" data-cb="ok">✓ 적용</button><button type="button" data-cb="no">× 취소</button></div>';
        C.world.appendChild(el);
        crop.el = el;
        crop.box = el.querySelector('.crop-box');
        crop.img = el.querySelector('.crop-clip img');
        crop.ne = C.nodesEl.querySelector('.cnode[data-id="' + C.cssEsc(n.id) + '"]');
        if (crop.ne) crop.ne.style.visibility = 'hidden';
        C.stage.classList.add('is-cropping');
        layout();
        el.addEventListener('mousedown', boxDown);
        el.addEventListener('click', function (ev) {
            var cb = ev.target.dataset && ev.target.dataset.cb;
            if (cb === 'ok') apply(); else if (cb === 'no') cancel();
        });
        C.toast('크롭: 드래그로 영역 조절 — Enter 적용, Esc 취소');
    }
    function layout() {
        var f = crop.f, b = crop.b;
        crop.box.style.left = (b.x - f.x) + 'px'; crop.box.style.top = (b.y - f.y) + 'px';
        crop.box.style.width = b.w + 'px'; crop.box.style.height = b.h + 'px';
        var im = crop.img;
        im.style.left = (f.x - b.x) + 'px'; im.style.top = (f.y - b.y) + 'px';
        im.style.width = f.w + 'px'; im.style.height = f.h + 'px';
    }
    function boxDown(ev) {
        if (ev.button !== 0) return;
        if (ev.target.dataset && ev.target.dataset.cb) return; // 버튼은 click으로
        ev.preventDefault(); ev.stopPropagation();
        var dir = ev.target.dataset ? ev.target.dataset.cd : null;
        var f = crop.f, b0 = { x: crop.b.x, y: crop.b.y, w: crop.b.w, h: crop.b.h };
        var sx = ev.clientX, sy = ev.clientY, MIN = 12;
        function mv(e) {
            var dx = (e.clientX - sx) / C.view.scale, dy = (e.clientY - sy) / C.view.scale;
            var b = crop.b;
            if (!dir) { // 박스 이동 (원본 안으로 제한)
                b.x = clamp(b0.x + dx, f.x, f.x + f.w - b0.w);
                b.y = clamp(b0.y + dy, f.y, f.y + f.h - b0.h);
            } else {
                var x1 = b0.x, y1 = b0.y, x2 = b0.x + b0.w, y2 = b0.y + b0.h;
                if (dir.indexOf('w') >= 0) x1 = clamp(b0.x + dx, f.x, x2 - MIN);
                if (dir.indexOf('e') >= 0) x2 = clamp(b0.x + b0.w + dx, x1 + MIN, f.x + f.w);
                if (dir.indexOf('n') >= 0) y1 = clamp(b0.y + dy, f.y, y2 - MIN);
                if (dir.indexOf('s') >= 0) y2 = clamp(b0.y + b0.h + dy, y1 + MIN, f.y + f.h);
                b.x = x1; b.y = y1; b.w = x2 - x1; b.h = y2 - y1;
            }
            layout();
        }
        function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
    function apply() {
        var f = crop.f, b = crop.b, n = crop.n;
        n.crop = { x: (b.x - f.x) / f.w, y: (b.y - f.y) / f.h, w: b.w / f.w, h: b.h / f.h };
        if (n.crop.x < 1e-4 && n.crop.y < 1e-4 && n.crop.w > 0.9999 && n.crop.h > 0.9999) delete n.crop; // 원본 그대로면 해제
        n.x = b.x; n.y = b.y; n.width = b.w; n.height = b.h;
        end(); C.markDirty(); C.render();
    }
    function cancel() { end(); C.render(); }
    function end() {
        if (crop.ne) crop.ne.style.visibility = '';
        crop.el.remove(); crop = null;
        C.stage.classList.remove('is-cropping');
    }

    // 진입: 이미지 노드 더블클릭 / 크롭 중 바깥 클릭 = 적용
    C.stage.addEventListener('dblclick', function (ev) {
        if (crop) { if (!ev.target.closest('.crop-layer')) return; ev.stopImmediatePropagation(); apply(); return; }
        var ne = ev.target.closest ? ev.target.closest('.cnode--file') : null;
        if (!ne) return;
        var n = C.nodeById(ne.dataset.id);
        if (!n || !isImgFile(n)) return;
        ev.stopImmediatePropagation(); ev.preventDefault();
        start(n);
    }, true);
    C.stage.addEventListener('mousedown', function (ev) {
        if (!crop) return;
        if (ev.target.closest && ev.target.closest('.crop-layer')) return;
        ev.stopImmediatePropagation(); ev.preventDefault();
        apply();
    }, true);
    document.addEventListener('keydown', function (e) {
        if (!crop) return;
        if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); apply(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); } // 크롭 중 노드 삭제 방지
    }, true);
})();
