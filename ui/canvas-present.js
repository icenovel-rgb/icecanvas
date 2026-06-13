/* icenovel 캔버스 — 아트보드 슬라이드쇼 (프레젠테이션 모드)
   시작: Ctrl+Shift+F5 또는 상단바 "슬라이드쇼" 버튼
   이동: → / PageDown / Space / 클릭 = 다음, ← / PageUp = 이전, Home/End = 처음/끝, ESC = 종료
   전환(아트보드별 transition): none(컷) / fade(페이드) / slide(밀기) / zoom(줌)
   방식: 별도 캡처 없이 실제 캔버스 world transform을 각 아트보드에 맞춰 이동/확대하고,
        남는 여백은 검은 레터박스 바로 가려 인접 콘텐츠를 숨긴다 */
(function () {
    'use strict';
    var C = window.__CANVAS_CORE__;
    if (!C) return;
    var stage = C.stage, world = C.world;

    var presenting = false, slides = [], idx = 0, saved = null, bars = [];

    function artboards() {
        return C.nodes.filter(function (n) { return n.type === 'artboard'; })
            .sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    }
    // 아트보드 사각형이 화면에 꽉 차도록(contain) 하는 view 계산
    function viewForRect(r) {
        var vw = stage.clientWidth, vh = stage.clientHeight;
        var s = Math.min(vw / r.w, vh / r.h);
        return { scale: s, x: vw / 2 - (r.x + r.w / 2) * s, y: vh / 2 - (r.y + r.h / 2) * s };
    }
    function makeBars() {
        removeBars();
        for (var i = 0; i < 2; i++) { var b = document.createElement('div'); b.className = 'present-bar'; stage.appendChild(b); bars.push(b); }
    }
    function removeBars() { bars.forEach(function (b) { b.remove(); }); bars = []; }
    // fit 후 남는 여백(좌우 또는 상하)을 검은 바로 덮는다
    function layoutBars(r) {
        if (bars.length < 2) return;
        var sc = C.view.scale, sw = stage.clientWidth, sh = stage.clientHeight;
        var aw = r.w * sc, ah = r.h * sc;
        var sideX = Math.max(0, Math.round((sw - aw) / 2));
        var sideY = Math.max(0, Math.round((sh - ah) / 2));
        if (sideX >= sideY) { // 좌우 바
            bars[0].style.cssText = 'position:absolute;left:0;top:0;width:' + (sideX + 1) + 'px;height:100%;background:#000;z-index:60;pointer-events:none;';
            bars[1].style.cssText = 'position:absolute;right:0;top:0;width:' + (sideX + 1) + 'px;height:100%;background:#000;z-index:60;pointer-events:none;';
        } else { // 상하 바
            bars[0].style.cssText = 'position:absolute;left:0;top:0;width:100%;height:' + (sideY + 1) + 'px;background:#000;z-index:60;pointer-events:none;';
            bars[1].style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:' + (sideY + 1) + 'px;background:#000;z-index:60;pointer-events:none;';
        }
    }
    function setView(nv) { C.view.x = nv.x; C.view.y = nv.y; C.view.scale = nv.scale; C.applyView(); }

    function gotoSlide(i, animate) {
        if (!slides.length) return;
        idx = Math.max(0, Math.min(slides.length - 1, i));
        var ab = slides[idx];
        var r = C.nodeRect(ab);
        var nv = viewForRect(r);
        var kind = ab.transition || 'none';
        if (animate && kind === 'fade') { fadeTo(nv, r); return; }
        // slide = world transform 애니메이션, none/그 외 = 즉시
        world.style.transition = (animate && kind === 'slide') ? 'transform .5s cubic-bezier(.4,0,.2,1)' : 'none';
        setView(nv);
        layoutBars(r);
    }
    function fadeTo(nv, r) {
        var ov = document.createElement('div'); ov.className = 'present-fade'; stage.appendChild(ov);
        requestAnimationFrame(function () { ov.style.opacity = '1'; });
        setTimeout(function () {
            world.style.transition = 'none';
            setView(nv); layoutBars(r);
            requestAnimationFrame(function () { ov.style.opacity = '0'; setTimeout(function () { ov.remove(); }, 320); });
        }, 300);
    }

    function enter() {
        slides = artboards();
        if (!slides.length) { C.toast('아트보드가 없습니다 — 먼저 아트보드를 추가하세요'); return; }
        presenting = true;
        saved = { x: C.view.x, y: C.view.y, scale: C.view.scale };
        try { C.clearSel(); C.render(); } catch (e) {}
        stage.classList.add('is-presenting');
        makeBars();
        if (stage.requestFullscreen) { try { stage.requestFullscreen().catch(function () {}); } catch (e) {} }
        gotoSlide(0, false);
        try { stage.focus({ preventScroll: true }); } catch (e) {}
    }
    function exit() {
        if (!presenting) return;
        presenting = false;
        stage.classList.remove('is-presenting');
        removeBars();
        world.style.transition = 'none';
        if (document.fullscreenElement) { try { document.exitFullscreen().catch(function () {}); } catch (e) {} }
        if (saved) setView(saved);
    }
    function toggle() { if (presenting) exit(); else enter(); }

    // 풀스크린 전환/리사이즈 후 화면 크기가 바뀌므로 현재 슬라이드를 다시 맞춘다
    document.addEventListener('fullscreenchange', function () {
        if (!presenting) return;
        if (!document.fullscreenElement) { exit(); return; } // 사용자가 풀스크린을 나가면 슬라이드쇼 종료
        gotoSlide(idx, false);
    });
    window.addEventListener('resize', function () { if (presenting) gotoSlide(idx, false); });

    // 키보드 — 캡처 단계에서 코어/벡터 핸들러보다 먼저 처리
    document.addEventListener('keydown', function (e) {
        var tg = e.target && e.target.tagName;
        var typing = tg === 'INPUT' || tg === 'TEXTAREA' || (e.target && e.target.isContentEditable);
        // Shift+F = 슬라이드쇼 시작/종료 (e.code로 IME·레이아웃 무관)
        if (!typing && e.code === 'KeyF' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault(); e.stopImmediatePropagation(); toggle(); return;
        }
        if (!presenting) return;
        var k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); exit(); return; }
        if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Spacebar') { e.preventDefault(); e.stopImmediatePropagation(); gotoSlide(idx + 1, true); return; }
        if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); e.stopImmediatePropagation(); gotoSlide(idx - 1, true); return; }
        if (k === 'Home') { e.preventDefault(); e.stopImmediatePropagation(); gotoSlide(0, true); return; }
        if (k === 'End') { e.preventDefault(); e.stopImmediatePropagation(); gotoSlide(slides.length - 1, true); return; }
    }, true);

    // 휠 = 슬라이드 이동 (스크롤/팬 대신) — 한 번 넘긴 뒤 잠시 잠가 과도한 연속 이동 방지
    var wheelLock = false;
    stage.addEventListener('wheel', function (e) {
        if (!presenting) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (wheelLock || Math.abs(e.deltaY) < 1) return;
        wheelLock = true; setTimeout(function () { wheelLock = false; }, 450);
        gotoSlide(idx + (e.deltaY > 0 ? 1 : -1), true);
    }, { capture: true, passive: false });

    // 클릭 = 다음 슬라이드 (PPT식)
    stage.addEventListener('click', function (e) { if (presenting && e.button === 0) gotoSlide(idx + 1, true); }, true);

    // 상단바 "슬라이드쇼" 버튼
    document.querySelectorAll('[data-act="present"]').forEach(function (b) { b.addEventListener('click', function () { toggle(); }); });
})();
