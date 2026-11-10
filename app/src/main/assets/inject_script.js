/**
 * ============================================================================
 * MyGMap Injected Helper & DOM Inspector Script (inject_script.js)
 *
 * 掛載命名空間：window.MyGMapHelper
 * 原生橋接介面：window.AndroidBridge (@JavascriptInterface MyMapJsBridge)
 *
 * 核心職責：
 * 1. 強制設定行動裝置 Viewport Meta，防止桌面版網頁縮放失控。
 * 2. 多重容錯 DOM 搜尋器 (固定 ID -> 多語系 aria-label/data-tooltip/title -> 啟發式結構搜尋)。
 * 3. 自動標記關鍵容器 (如 [data-mygmap-role="layer-panel"]) 供 inject_style.css 進行抽屜化與熱區放大。
 * 4. 偵測並回報頁面模式 (地圖列表首頁 vs 地圖編輯頁) 至 AndroidBridge.onPageModeChanged(isEditorPage)。
 * 5. 控制左側圖層抽屜 (mygmap-drawer-open / mygmap-drawer-closed) 與 CSS 逃生門 (mygmap-mobile-mode)。
 * 6. 開發者 DOM 探測模式 (Inspect Mode)：攔截點擊並回報元素詳細屬性至 AndroidBridge.onDomInspected(infoJson)。
 * 7. Phase 3 高頻編輯動作串接：
 *    - simulateClick(element)：完整派發 pointerdown -> mousedown -> pointerup -> mouseup -> click 事件序列以驅動 Google Closure Library。
 *    - toggleLayerDrawer()：切換左側圖層抽屜面板。
 *    - searchPlace(query) & clickAddToMap()：自動填入 #mapsprosearch-field 觸發搜尋，並支援一鍵點擊 #addtomap-button 加入地圖。
 *    - activateAddMarkerTool() & activatePanTool()：切換「新增標記 (插針)」與「手型選取/平移」工具。
 *    - toggleMobileCssMode()、setInspectMode(enabled)、triggerUndo()、triggerRedo()。
 * ============================================================================
 */
(function () {
    'use strict';

    var VIEWPORT_CONTENT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    var BACKDROP_ID = 'mygmap-drawer-backdrop';

    /**
     * 1. 強制新增或覆寫 <meta name="viewport">
     */
    function ensureViewportMeta() {
        try {
            var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
            if (!head) return;

            var meta = document.querySelector('meta[name="viewport"]');
            if (!meta) {
                meta = document.createElement('meta');
                meta.setAttribute('name', 'viewport');
                head.appendChild(meta);
            }
            if (meta.getAttribute('content') !== VIEWPORT_CONTENT) {
                meta.setAttribute('content', VIEWPORT_CONTENT);
            }
        } catch (err) {
            console.warn('[MyGMap] ensureViewportMeta error:', err);
        }
    }

    /**
     * 2. 多重容錯 DOM 匹配規則定義 (支援固定 ID、繁中/英文語意屬性與啟發式搜尋)
     */
    var DOM_TARGETS = {
        searchInput: {
            roleAttr: 'search-input',
            ids: ['mapsprosearch-field'],
            labels: ['搜尋地圖', '搜尋', 'Search map', 'Search'],
            selectors: [
                'input#mapsprosearch-field',
                'input[type="text"][aria-label*="搜尋"]',
                'input[type="text"][aria-label*="Search"]'
            ]
        },
        searchButton: {
            roleAttr: 'search-button',
            ids: ['mapsprosearch-button'],
            labels: ['搜尋', 'Search'],
            selectors: [
                '#mapsprosearch-button',
                '[role="button"][aria-label*="搜尋"]',
                '[role="button"][aria-label*="Search"]'
            ]
        },
        addToMapButton: {
            roleAttr: 'add-to-map-button',
            ids: ['addtomap-button'],
            labels: ['新增至地圖', 'Add to map'],
            selectors: [
                '#addtomap-button',
                '[role="button"][aria-label*="新增至地圖"]',
                '[role="button"][aria-label*="Add to map"]'
            ],
            heuristic: function () {
                var candidates = document.querySelectorAll('[role="button"], button, div.goog-inline-block, a');
                for (var i = 0; i < candidates.length; i++) {
                    var el = candidates[i];
                    if (!isElementUsable(el)) continue;
                    var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (
                        txt === '新增至地圖' ||
                        txt === '+ 新增至地圖' ||
                        txt === 'Add to map' ||
                        txt === '+ Add to map'
                    ) {
                        return el;
                    }
                }
                return null;
            }
        },
        layerPanel: {
            roleAttr: 'layer-panel',
            ids: ['featurelist-pane'],
            labels: ['圖層面板', 'Feature list', 'Layers'],
            selectors: [
                '#featurelist-pane',
                '.hz-featurelist-panel'
            ],
            heuristic: function () {
                return findLayerPanelByHeuristic();
            }
        },
        selectTool: {
            roleAttr: 'tool-select',
            ids: [],
            labels: ['選取項目', 'Select items', '平移', 'Pan', '手型'],
            selectors: [
                '[role="button"][aria-label*="選取項目"]',
                '[role="button"][aria-label*="Select items"]',
                '[data-tooltip*="選取項目"]',
                '[data-tooltip*="Select items"]'
            ]
        },
        addMarkerTool: {
            roleAttr: 'tool-add-marker',
            ids: [],
            labels: ['新增標記', 'Add marker', '新增地標', 'Add place'],
            selectors: [
                '[role="button"][aria-label*="新增標記"]',
                '[role="button"][aria-label*="Add marker"]',
                '[data-tooltip*="新增標記"]',
                '[data-tooltip*="Add marker"]'
            ]
        },
        drawLineTool: {
            roleAttr: 'tool-draw-line',
            ids: [],
            labels: ['繪製線條', 'Draw a line', '新增線條或形狀', 'Add line or shape'],
            selectors: []
        },
        directionsTool: {
            roleAttr: 'tool-directions',
            ids: [],
            labels: ['新增路線', 'Add directions', '路線'],
            selectors: []
        },
        measureTool: {
            roleAttr: 'tool-measure',
            ids: [],
            labels: ['測量距離和面積', 'Measure distances and areas', '測量距離'],
            selectors: []
        },
        undoTool: {
            roleAttr: 'tool-undo',
            ids: [],
            labels: ['復原', 'Undo'],
            selectors: [
                '[role="button"][aria-label*="復原"]',
                '[role="button"][aria-label*="Undo"]',
                '[data-tooltip*="復原"]',
                '[data-tooltip*="Undo"]'
            ]
        },
        redoTool: {
            roleAttr: 'tool-redo',
            ids: [],
            labels: ['重做', 'Redo'],
            selectors: [
                '[role="button"][aria-label*="重做"]',
                '[role="button"][aria-label*="Redo"]',
                '[data-tooltip*="重做"]',
                '[data-tooltip*="Redo"]'
            ]
        }
    };

    /**
     * 判斷元素是否在畫面上可見（或僅因我們的抽屜收合 class 而位於畫面左側外）
     */
    function isElementUsable(el) {
        if (!el || !el.ownerDocument) return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
    }

    /**
     * 啟發式結構搜尋：尋找畫面左側固定寬度的圖層面板容器
     * 若 #featurelist-pane 存在，優先檢查其是否有包裹標題與清單的左側固定外框容器；
     * 若無固定 ID，則掃描畫面左側寬度介於 200px~450px、高度佔視窗 40% 以上的容器。
     */
    function findLayerPanelByHeuristic() {
        var existingTagged = document.querySelector('[data-mygmap-role="layer-panel"]');
        if (existingTagged && isElementUsable(existingTagged)) {
            return existingTagged;
        }

        var featurePane = document.getElementById('featurelist-pane');
        if (featurePane) {
            var current = featurePane;
            var bestPanel = featurePane;
            var depth = 0;
            while (current && current.parentElement && current.parentElement !== document.body && depth < 5) {
                var parent = current.parentElement;
                var rect = parent.getBoundingClientRect();
                if (rect.width > 0 && rect.width <= 460 && rect.height >= window.innerHeight * 0.35) {
                    bestPanel = parent;
                    current = parent;
                    depth++;
                } else {
                    break;
                }
            }
            return bestPanel;
        }

        var containers = document.querySelectorAll('div, aside, section');
        var viewportHeight = window.innerHeight || 600;
        var viewportWidth = window.innerWidth || 360;

        for (var i = 0; i < containers.length; i++) {
            var candidate = containers[i];
            if (candidate.id === 'map-canvas' || candidate.id === 'lyra-canvas' || candidate.id === BACKDROP_ID) {
                continue;
            }
            var cStyle = window.getComputedStyle(candidate);
            if (cStyle.display === 'none' || cStyle.visibility === 'hidden') continue;
            if (cStyle.position !== 'fixed' && cStyle.position !== 'absolute') continue;

            var cRect = candidate.getBoundingClientRect();
            var isLeftAligned = cRect.left >= -460 && cRect.left <= 36;
            var isPanelWidth = cRect.width >= 200 && cRect.width <= Math.min(450, viewportWidth * 0.92);
            var isTallEnough = cRect.height >= viewportHeight * 0.42;

            if (isLeftAligned && isPanelWidth && isTallEnough) {
                var buttonsCount = candidate.querySelectorAll('[role="button"], [role="checkbox"], input').length;
                if (buttonsCount >= 2) {
                    return candidate;
                }
            }
        }
        return null;
    }

    /**
     * 根據語意標籤清單 (繁中/英文) 搜尋符合 aria-label / data-tooltip / title / placeholder 的元素
     */
    function findBySemanticLabels(labels) {
        if (!labels || !labels.length) return null;
        var attrNames = ['aria-label', 'data-tooltip', 'title', 'placeholder'];

        for (var i = 0; i < labels.length; i++) {
            var keyword = labels[i];
            if (!keyword) continue;
            var escaped = keyword.replace(/"/g, '\\"');
            for (var j = 0; j < attrNames.length; j++) {
                var attr = attrNames[j];
                var selector = '[' + attr + '*="' + escaped + '"]';
                try {
                    var matches = document.querySelectorAll(selector);
                    for (var k = 0; k < matches.length; k++) {
                        if (isElementUsable(matches[k])) {
                            return matches[k];
                        }
                    }
                } catch (_e) {
                    // 忽略無效 selector
                }
            }
        }
        return null;
    }

    /**
     * 統一的多重容錯 DOM 搜尋函式
     * @param {string|object} strategyOrKey - 可傳入 DOM_TARGETS 的 key (如 'addMarkerTool') 或自訂策略物件
     * @returns {HTMLElement|null}
     */
    function findElement(strategyOrKey) {
        var strategy = typeof strategyOrKey === 'string'
            ? DOM_TARGETS[strategyOrKey]
            : strategyOrKey;

        if (!strategy) return null;

        // 對 layerPanel 特別優先檢查是否能往上提升至完整左側面板容器
        if (strategyOrKey === 'layerPanel' && typeof strategy.heuristic === 'function') {
            var panelEl = strategy.heuristic();
            if (panelEl) {
                if (strategy.roleAttr) {
                    panelEl.setAttribute('data-mygmap-role', strategy.roleAttr);
                }
                return panelEl;
            }
        }

        // Priority 1: 固定 ID 精確匹配
        if (Array.isArray(strategy.ids)) {
            for (var i = 0; i < strategy.ids.length; i++) {
                var byId = document.getElementById(strategy.ids[i]);
                if (byId && isElementUsable(byId)) {
                    if (strategy.roleAttr) {
                        byId.setAttribute('data-mygmap-role', strategy.roleAttr);
                    }
                    return byId;
                }
            }
        }

        // Priority 2: 語意屬性匹配 (aria-label / data-tooltip / title / placeholder)
        if (Array.isArray(strategy.labels) && strategy.labels.length > 0) {
            var byLabel = findBySemanticLabels(strategy.labels);
            if (byLabel) {
                if (strategy.roleAttr) {
                    byLabel.setAttribute('data-mygmap-role', strategy.roleAttr);
                }
                return byLabel;
            }
        }

        // Priority 3: 備援 CSS Selectors
        if (Array.isArray(strategy.selectors)) {
            for (var s = 0; s < strategy.selectors.length; s++) {
                try {
                    var bySel = document.querySelector(strategy.selectors[s]);
                    if (bySel && isElementUsable(bySel)) {
                        if (strategy.roleAttr) {
                            bySel.setAttribute('data-mygmap-role', strategy.roleAttr);
                        }
                        return bySel;
                    }
                } catch (_e) {
                    // ignore
                }
            }
        }

        // Priority 4: 結構啟發式搜尋 (Heuristic Fallback)
        if (typeof strategy.heuristic === 'function') {
            var byHeuristic = strategy.heuristic();
            if (byHeuristic && isElementUsable(byHeuristic)) {
                if (strategy.roleAttr) {
                    byHeuristic.setAttribute('data-mygmap-role', strategy.roleAttr);
                }
                return byHeuristic;
            }
        }

        return null;
    }

    /**
     * 掃描全頁 DOM 並標記 data-mygmap-role，供 inject_style.css 套用行動版抽屜與觸控放大樣式
     */
    function scanAndTagDom() {
        var foundSummary = {};
        var keys = Object.keys(DOM_TARGETS);

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var el = findElement(key);
            foundSummary[key] = Boolean(el);

            // 若找到新增標記或選取工具，順便將其父層工具列標記為 editor-toolbar
            if (el && (key === 'addMarkerTool' || key === 'selectTool' || key === 'drawLineTool')) {
                var toolbar = el.closest('[role="toolbar"]') || el.parentElement;
                if (toolbar && toolbar !== document.body) {
                    toolbar.setAttribute('data-mygmap-role', 'editor-toolbar');
                }
            }
        }

        // 標記地圖主畫布以套用多點觸控與手勢隔離樣式
        var mapCanvas = document.getElementById('map-canvas') || document.getElementById('lyra-canvas');
        if (mapCanvas) {
            mapCanvas.setAttribute('data-mygmap-role', 'map-canvas');
        }

        return foundSummary;
    }

    /**
     * 3. 偵測目前頁面是否為「地圖編輯頁 (Editor Page)」還是「地圖列表首頁 (Home List Page)」
     */
    function detectIsEditorPage() {
        var pathname = (window.location && window.location.pathname) ? window.location.pathname : '';
        var search = (window.location && window.location.search) ? window.location.search : '';

        var urlIndicatesEditor =
            /\/maps\/d\/(?:u\/\d+\/)?(?:edit|viewer)/i.test(pathname) ||
            /[?&]mid=[^&]+/i.test(search);

        var hasEditorDom = Boolean(
            document.getElementById('featurelist-pane') ||
            document.getElementById('mapsprosearch-field') ||
            document.querySelector('[data-mygmap-role="layer-panel"]') ||
            findBySemanticLabels(['新增標記', 'Add marker'])
        );

        if (hasEditorDom) {
            return true;
        }
        return urlIndicatesEditor;
    }

    /**
     * 4. 建立或取得抽屜展開時的背景遮罩 (#mygmap-drawer-backdrop)
     *    支援點擊或向左滑動關閉抽屜，並阻擋底層地圖觸控事件穿透。
     */
    function ensureDrawerBackdrop() {
        if (!document.body) return null;
        var backdrop = document.getElementById(BACKDROP_ID);
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = BACKDROP_ID;
            backdrop.setAttribute('aria-hidden', 'true');
            backdrop.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (window.MyGMapHelper) {
                    window.MyGMapHelper.setDrawerOpen(false);
                }
            }, false);

            var touchStartX = null;
            backdrop.addEventListener('touchstart', function (e) {
                if (e.touches && e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                }
            }, { passive: true });
            backdrop.addEventListener('touchend', function (e) {
                if (touchStartX !== null && e.changedTouches && e.changedTouches.length === 1) {
                    var deltaX = e.changedTouches[0].clientX - touchStartX;
                    if (deltaX < -24 && window.MyGMapHelper) {
                        window.MyGMapHelper.setDrawerOpen(false);
                    }
                }
                touchStartX = null;
            }, { passive: true });

            document.body.appendChild(backdrop);
        }
        return backdrop;
    }

    /**
     * 5. 檢查並維持内部狀態物件
     */
    var helperState = (window.MyGMapHelper && window.MyGMapHelper._state) ? window.MyGMapHelper._state : {
        mobileMode: true,
        drawerOpen: false,
        inspectMode: false,
        activeTool: 'pan',
        lastReportedEditorMode: null,
        initialized: false
    };

    /**
     * 套用 body class 狀態 (mygmap-mobile-mode, mygmap-drawer-open / mygmap-drawer-closed, mygmap-inspect-mode)
     */
    function applyBodyClasses() {
        if (!document.body) return;
        ensureDrawerBackdrop();

        if (helperState.mobileMode) {
            document.body.classList.add('mygmap-mobile-mode');
        } else {
            document.body.classList.remove('mygmap-mobile-mode');
        }

        if (helperState.drawerOpen) {
            document.body.classList.add('mygmap-drawer-open');
            document.body.classList.remove('mygmap-drawer-closed');
        } else {
            document.body.classList.add('mygmap-drawer-closed');
            document.body.classList.remove('mygmap-drawer-open');
        }

        if (helperState.inspectMode) {
            document.body.classList.add('mygmap-inspect-mode');
        } else {
            document.body.classList.remove('mygmap-inspect-mode');
        }
    }

    /**
     * 通知 Android 端目前是否為地圖編輯頁
     */
    function reportPageModeIfNeeded(forceReport) {
        var isEditor = detectIsEditorPage();
        if (forceReport || helperState.lastReportedEditorMode !== isEditor) {
            helperState.lastReportedEditorMode = isEditor;
            try {
                if (window.AndroidBridge && typeof window.AndroidBridge.onPageModeChanged === 'function') {
                    window.AndroidBridge.onPageModeChanged(Boolean(isEditor));
                }
            } catch (err) {
                console.warn('[MyGMap] AndroidBridge.onPageModeChanged error:', err);
            }
        }
        return isEditor;
    }

    /**
     * 通知 Android 端抽屜開關狀態變更
     */
    function reportDrawerState() {
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onDrawerStateChanged === 'function') {
                window.AndroidBridge.onDrawerStateChanged(Boolean(helperState.drawerOpen));
            }
        } catch (err) {
            console.warn('[MyGMap] AndroidBridge.onDrawerStateChanged error:', err);
        }
    }

    /**
     * 通知 Android 端手機排版/原始桌面排版模式變更
     */
    function reportMobileModeState() {
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onMobileModeChanged === 'function') {
                window.AndroidBridge.onMobileModeChanged(Boolean(helperState.mobileMode));
            }
        } catch (err) {
            console.warn('[MyGMap] AndroidBridge.onMobileModeChanged error:', err);
        }
    }

    /**
     * 通知 Android 端開發者 DOM 探測模式狀態變更
     */
    function reportInspectModeState() {
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onInspectModeChanged === 'function') {
                window.AndroidBridge.onInspectModeChanged(Boolean(helperState.inspectMode));
            }
        } catch (err) {
            console.warn('[MyGMap] AndroidBridge.onInspectModeChanged error:', err);
        }
    }

    /**
     * 通知 Android 端目前啟用的編輯工具 ('pan' | 'addMarker')
     */
    function reportActiveToolState() {
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onActiveToolChanged === 'function') {
                window.AndroidBridge.onActiveToolChanged(String(helperState.activeTool || 'pan'));
            }
        } catch (err) {
            console.warn('[MyGMap] AndroidBridge.onActiveToolChanged error:', err);
        }
    }

    /**
     * 6. 開發者 DOM 探測模式 (Inspect Mode) 元素解析與點擊攔截
     */
    function pickBestInspectTarget(rawTarget) {
        if (!rawTarget || rawTarget.nodeType !== 1) return rawTarget;
        var curr = rawTarget;
        var depth = 0;
        while (curr && curr !== document.body && depth < 4) {
            var hasMeaningfulAttr =
                curr.id ||
                curr.getAttribute('aria-label') ||
                curr.getAttribute('data-tooltip') ||
                curr.getAttribute('title') ||
                curr.getAttribute('data-mygmap-role') ||
                curr.getAttribute('role') === 'button' ||
                curr.tagName === 'BUTTON' ||
                curr.tagName === 'INPUT' ||
                curr.tagName === 'A';
            if (hasMeaningfulAttr) {
                return curr;
            }
            curr = curr.parentElement;
            depth++;
        }
        return rawTarget;
    }

    function buildSuggestedSelector(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) {
            return '#' + el.id;
        }
        var mygmapRole = el.getAttribute('data-mygmap-role');
        if (mygmapRole) {
            return '[data-mygmap-role="' + mygmapRole + '"]';
        }
        var ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
            return '[aria-label*="' + ariaLabel.replace(/"/g, '\\"') + '"]';
        }
        var dataTooltip = el.getAttribute('data-tooltip');
        if (dataTooltip) {
            return '[data-tooltip*="' + dataTooltip.replace(/"/g, '\\"') + '"]';
        }
        var title = el.getAttribute('title');
        if (title) {
            return '[title*="' + title.replace(/"/g, '\\"') + '"]';
        }
        var tag = (el.tagName || 'div').toLowerCase();
        var cls = (typeof el.className === 'string' ? el.className.trim() : '');
        if (cls) {
            var firstTwoClasses = cls.split(/\s+/).slice(0, 2).join('.');
            if (firstTwoClasses) {
                return tag + '.' + firstTwoClasses;
            }
        }
        return tag;
    }

    function clearPreviousInspectedHighlight() {
        var prev = document.querySelectorAll('[data-mygmap-inspected="true"]');
        for (var i = 0; i < prev.length; i++) {
            prev[i].removeAttribute('data-mygmap-inspected');
        }
    }

    function handleDocumentInspectClick(event) {
        if (!helperState.inspectMode) return;

        var rawEl = event.target;
        if (!rawEl || rawEl.id === BACKDROP_ID) return;

        // 攔截原本的網頁按鈕行為，避免探測時誤觸刪除或跳頁
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }

        var targetEl = pickBestInspectTarget(rawEl);
        clearPreviousInspectedHighlight();
        if (targetEl && targetEl.setAttribute) {
            targetEl.setAttribute('data-mygmap-inspected', 'true');
        }

        var rect = targetEl.getBoundingClientRect ? targetEl.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        var classStr = typeof targetEl.className === 'string'
            ? targetEl.className.trim()
            : (targetEl.getAttribute && targetEl.getAttribute('class')) || '';
        var textSnippet = ((targetEl.innerText || targetEl.textContent || '') + '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);

        var info = {
            tagName: (targetEl.tagName || '').toUpperCase(),
            id: targetEl.id || '',
            className: classStr,
            ariaLabel: (targetEl.getAttribute && targetEl.getAttribute('aria-label')) || '',
            dataTooltip: (targetEl.getAttribute && targetEl.getAttribute('data-tooltip')) || '',
            title: (targetEl.getAttribute && targetEl.getAttribute('title')) || '',
            role: (targetEl.getAttribute && targetEl.getAttribute('role')) || '',
            dataMygmapRole: (targetEl.getAttribute && targetEl.getAttribute('data-mygmap-role')) || '',
            text: textSnippet,
            selector: buildSuggestedSelector(targetEl),
            rect: {
                x: Math.round(rect.left || 0),
                y: Math.round(rect.top || 0),
                width: Math.round(rect.width || 0),
                height: Math.round(rect.height || 0)
            },
            pageUrl: window.location ? window.location.href : ''
        };

        var infoJson = JSON.stringify(info);
        console.info('[MyGMap Inspect]', infoJson);

        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onDomInspected === 'function') {
                window.AndroidBridge.onDomInspected(infoJson);
            }
        } catch (err) {
            console.error('[MyGMap] AndroidBridge.onDomInspected error:', err);
        }
    }

    /**
     * 7. 強化版 Google Closure Library 模擬點擊序列 (simulateClick)
     * 依序派發完整的指標與滑鼠事件序列：
     * pointerdown -> mousedown -> pointerup -> mouseup -> click
     * 皆設定 bubbles: true, cancelable: true, view: window，確保頂部工具列與「新增至地圖」100% 可被觸發。
     */
    function simulateClick(el) {
        if (!el) return false;
        try {
            if (typeof el.focus === 'function') {
                el.focus();
            }
            var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
            var clientX = rect.left + (rect.width || 10) / 2;
            var clientY = rect.top + (rect.height || 10) / 2;
            var eventSequence = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

            for (var i = 0; i < eventSequence.length; i++) {
                var type = eventSequence[i];
                var isPointer = type.indexOf('pointer') === 0;
                var isDown = type.indexOf('down') !== -1;
                var evtInit = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: clientX,
                    clientY: clientY,
                    button: 0,
                    buttons: isDown ? 1 : 0
                };

                var evt;
                if (isPointer && typeof window.PointerEvent === 'function') {
                    evtInit.pointerId = 1;
                    evtInit.pointerType = 'mouse';
                    evtInit.isPrimary = true;
                    evt = new PointerEvent(type, evtInit);
                } else {
                    evt = new MouseEvent(type, evtInit);
                }
                el.dispatchEvent(evt);
            }
            return true;
        } catch (e) {
            try {
                el.click();
                return true;
            } catch (_e2) {
                return false;
            }
        }
    }

    // 向下相容別名
    var simulateClosureClick = simulateClick;

    /**
     * 設定輸入框文字並派發完整 input / change 事件
     */
    function setInputValueAndNotify(inputEl, text) {
        if (!inputEl) return false;
        try {
            inputEl.focus();
            var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
            var descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
            if (descriptor && typeof descriptor.set === 'function') {
                descriptor.set.call(inputEl, text);
            } else {
                inputEl.value = text;
            }
            inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            return true;
        } catch (err) {
            console.warn('[MyGMap] setInputValueAndNotify error:', err);
            try {
                inputEl.value = text;
                return true;
            } catch (_e) {
                return false;
            }
        }
    }

    /**
     * 對指定元素派發 Enter 鍵事件序列 (keydown -> keypress -> keyup)
     */
    function dispatchEnterKey(targetEl) {
        if (!targetEl) return;
        var keyTypes = ['keydown', 'keypress', 'keyup'];
        for (var i = 0; i < keyTypes.length; i++) {
            try {
                var keyEvt = new KeyboardEvent(keyTypes[i], {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                targetEl.dispatchEvent(keyEvt);
            } catch (_e) {
                // ignore
            }
        }
    }

    /**
     * 派發鍵盤快捷鍵 (供 Undo Ctrl+Z / Redo Ctrl+Y 備援使用)
     */
    function dispatchCtrlShortcut(keyChar, keyCodeNum) {
        var target = document.activeElement || document.body || document.documentElement;
        if (!target) return false;
        try {
            var codeStr = 'Key' + keyChar.toUpperCase();
            var downEvt = new KeyboardEvent('keydown', {
                key: keyChar.toLowerCase(),
                code: codeStr,
                keyCode: keyCodeNum,
                which: keyCodeNum,
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
                view: window
            });
            var upEvt = new KeyboardEvent('keyup', {
                key: keyChar.toLowerCase(),
                code: codeStr,
                keyCode: keyCodeNum,
                which: keyCodeNum,
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
                view: window
            });
            target.dispatchEvent(downEvt);
            target.dispatchEvent(upEvt);
            return true;
        } catch (err) {
            console.warn('[MyGMap] dispatchCtrlShortcut error:', err);
            return false;
        }
    }

    /**
     * ========================================================================
     * 8. Phase 4：殺手級行動功能 ——「📍 一鍵新增目前 GPS 位置」自動化打卡狀態機
     *    addGpsPinToMap(lat, lng, title, description)
     * ========================================================================
     */

    /**
     * 透過 AndroidBridge.onGpsPinStatus(json) 回報自動化打卡進度與最終結果
     */
    function reportGpsPinStatus(payload) {
        var safePayload = {
            step: String(payload.step || 'UNKNOWN'),
            message: String(payload.message || ''),
            subMessage: String(payload.subMessage || ''),
            isCompleted: Boolean(payload.isCompleted),
            isError: Boolean(payload.isError),
            fallbackUsed: Boolean(payload.fallbackUsed),
            pinAdded: Boolean(payload.pinAdded),
            title: String(payload.title || ''),
            description: String(payload.description || ''),
            clipboardText: String(payload.clipboardText || '')
        };
        var jsonStr = JSON.stringify(safePayload);
        console.info('[MyGMap GPS Pin]', jsonStr);
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onGpsPinStatus === 'function') {
                window.AndroidBridge.onGpsPinStatus(jsonStr);
            }
        } catch (err) {
            console.warn('[MyGMap] AndroidBridge.onGpsPinStatus error:', err);
        }
    }

    /**
     * 取消並清理正在執行中的自動化打卡任務 (MutationObserver 與計時器)
     */
    function cancelActiveGpsPinTask() {
        if (helperState.activeGpsPinTask) {
            try {
                if (helperState.activeGpsPinTask.observer) {
                    helperState.activeGpsPinTask.observer.disconnect();
                }
            } catch (_e1) {}
            try {
                if (helperState.activeGpsPinTask.pollTimer) {
                    clearInterval(helperState.activeGpsPinTask.pollTimer);
                }
            } catch (_e2) {}
            try {
                if (helperState.activeGpsPinTask.timeoutTimer) {
                    clearTimeout(helperState.activeGpsPinTask.timeoutTimer);
                }
            } catch (_e3) {}
            helperState.activeGpsPinTask = null;
        }
    }

    /**
     * Step 1 輔助：確保目前至少有一個作用中的圖層 (Active Layer)
     * 若尚未選取任何圖層，自動點擊左側圖層面板的第一個圖層標題區域。
     */
    function ensureActiveLayerAvailable() {
        try {
            var pane = document.getElementById('featurelist-pane') ||
                document.querySelector('[data-mygmap-role="layer-panel"]');
            if (!pane) return false;

            // 檢查是否已有處於選取狀態的圖層
            var selectedLayer = pane.querySelector(
                '[aria-selected="true"], .hz-featurelist-layer-selected, .fl-layer-selected, [class*="layer-selected"], [class*="selected-layer"]'
            );
            if (selectedLayer && isElementUsable(selectedLayer)) {
                return true;
            }

            // 尋找第一個圖層的標題或容器區域並點擊以設為作用中圖層
            var layerSelectors = [
                '[id^="layer-header-"]',
                '.hz-featurelist-layer-header',
                '.hz-featurelist-layer-title',
                '[data-layer-id]',
                '.hz-featurelist-layer',
                '[role="heading"]'
            ];
            for (var i = 0; i < layerSelectors.length; i++) {
                var candidate = pane.querySelector(layerSelectors[i]);
                if (candidate && isElementUsable(candidate)) {
                    simulateClick(candidate);
                    return true;
                }
            }

            // 若上述選擇器皆未命中，嘗試尋找第一個包含 layer 標記的區塊
            var blocks = pane.querySelectorAll('div');
            for (var j = 0; j < blocks.length; j++) {
                var b = blocks[j];
                if (!isElementUsable(b)) continue;
                var idStr = b.id || '';
                var clsStr = typeof b.className === 'string' ? b.className : '';
                if (idStr.indexOf('layer') !== -1 || clsStr.indexOf('layer') !== -1) {
                    simulateClick(b);
                    return true;
                }
            }
            return false;
        } catch (err) {
            console.warn('[MyGMap] ensureActiveLayerAvailable error:', err);
            return false;
        }
    }

    /**
     * 取得目前展開的圖釘氣泡窗 (InfoWindow) 容器
     */
    function findInfoWindowContainer() {
        var selectors = [
            '#map-infowindow-container',
            '[id*="map-infowindow"]',
            '.gm-style-iw',
            '.hz-infowindow',
            '[class*="infowindow"]'
        ];
        for (var i = 0; i < selectors.length; i++) {
            try {
                var el = document.querySelector(selectors[i]);
                if (el && isElementUsable(el)) {
                    return el;
                }
            } catch (_e) {}
        }
        return null;
    }

    /**
     * 尋找氣泡窗內的「編輯 (Edit)」鉛筆按鈕（當點擊「新增至地圖」後氣泡窗先以檢視模式呈現時，需點擊此按鈕進入編輯模式）
     */
    function findInfoWindowEditButton() {
        var directIds = [
            'map-infowindow-edit-button',
            'infowindow-edit-button'
        ];
        for (var i = 0; i < directIds.length; i++) {
            var byId = document.getElementById(directIds[i]);
            if (byId && isElementUsable(byId)) return byId;
        }

        var container = findInfoWindowContainer() || document;
        var editSelectors = [
            '[id*="infowindow"][id*="edit"]',
            '[role="button"][aria-label*="編輯"]',
            '[role="button"][aria-label*="Edit"]',
            '[data-tooltip*="編輯"]',
            '[data-tooltip*="Edit"]',
            '[title*="編輯"]',
            '[title*="Edit"]'
        ];
        for (var j = 0; j < editSelectors.length; j++) {
            try {
                var btn = container.querySelector(editSelectors[j]);
                if (btn && isElementUsable(btn)) return btn;
            } catch (_e) {}
        }
        return null;
    }

    /**
     * 解析實際可輸入文字的 DOM 節點（處理外層 wrapper div 包裹 input / textarea / contenteditable 的情況）
     */
    function resolveEditableNode(node) {
        if (!node) return null;
        var tag = (node.tagName || '').toUpperCase();
        if (
            tag === 'INPUT' ||
            tag === 'TEXTAREA' ||
            node.isContentEditable ||
            (node.getAttribute && node.getAttribute('contenteditable') === 'true')
        ) {
            return node;
        }
        if (node.querySelector) {
            var inner = node.querySelector(
                'input[type="text"], textarea, [contenteditable="true"], input:not([type="hidden"]):not([type="checkbox"])'
            );
            if (inner && isElementUsable(inner)) {
                return inner;
            }
        }
        return node;
    }

    /**
     * 判斷節點是否處於可編輯狀態
     */
    function isNodeCurrentlyEditable(node) {
        var resolved = resolveEditableNode(node);
        if (!resolved || !isElementUsable(resolved)) return false;
        var tag = (resolved.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            return !resolved.disabled && !resolved.readOnly;
        }
        if (
            resolved.isContentEditable ||
            (resolved.getAttribute && resolved.getAttribute('contenteditable') === 'true')
        ) {
            return true;
        }
        return false;
    }

    /**
     * 尋找氣泡窗內的「名稱 / 標題」欄位
     */
    function findInfoWindowTitleField() {
        var titleIds = [
            'map-infowindow-attr-名稱-value',
            'map-infowindow-attr-name-value',
            'map-infowindow-attr-Name-value',
            'map-infowindow-attr-標題-value',
            'map-infowindow-attr-title-value',
            'map-infowindow-attr-Title-value'
        ];
        for (var i = 0; i < titleIds.length; i++) {
            var byId = document.getElementById(titleIds[i]);
            if (byId && isElementUsable(byId)) {
                return resolveEditableNode(byId);
            }
        }

        // 萬用語系匹配：Google My Maps 氣泡窗第一個 [id^="map-infowindow-attr-"][id$="-value"] 固定為標題欄位
        var attrValues = document.querySelectorAll('[id^="map-infowindow-attr-"][id$="-value"]');
        for (var j = 0; j < attrValues.length; j++) {
            if (isElementUsable(attrValues[j])) {
                return resolveEditableNode(attrValues[j]);
            }
        }

        // 啟發式備援：在氣泡窗容器內尋找第一個可見的文字輸入框或 contenteditable 元素
        var container = findInfoWindowContainer();
        if (container) {
            var inputs = container.querySelectorAll(
                'input[type="text"], [contenteditable="true"], textarea'
            );
            for (var k = 0; k < inputs.length; k++) {
                var candidate = inputs[k];
                if (candidate.id === 'mapsprosearch-field') continue;
                if (isElementUsable(candidate)) {
                    return candidate;
                }
            }
        }
        return null;
    }

    /**
     * 尋找氣泡窗內的「說明 / 備註」欄位
     */
    function findInfoWindowDescField(titleNode) {
        var descIds = [
            'map-infowindow-attr-說明-value',
            'map-infowindow-attr-description-value',
            'map-infowindow-attr-Description-value',
            'map-infowindow-attr-備註-value',
            'map-infowindow-attr-notes-value',
            'map-infowindow-attr-Notes-value'
        ];
        for (var i = 0; i < descIds.length; i++) {
            var byId = document.getElementById(descIds[i]);
            if (byId && isElementUsable(byId)) {
                var resolved = resolveEditableNode(byId);
                if (resolved !== titleNode) {
                    return resolved;
                }
            }
        }

        // 萬用語系匹配：氣泡窗內第二個 [id^="map-infowindow-attr-"][id$="-value"] 欄位
        var attrValues = document.querySelectorAll('[id^="map-infowindow-attr-"][id$="-value"]');
        var usableAttrs = [];
        for (var j = 0; j < attrValues.length; j++) {
            if (isElementUsable(attrValues[j])) {
                usableAttrs.push(resolveEditableNode(attrValues[j]));
            }
        }
        for (var m = 0; m < usableAttrs.length; m++) {
            if (usableAttrs[m] !== titleNode) {
                return usableAttrs[m];
            }
        }

        // 啟發式備援：在氣泡窗容器內尋找非 titleNode 的 textarea 或第二個可編輯欄位
        var container = findInfoWindowContainer();
        if (container) {
            var editables = container.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"]'
            );
            for (var k = 0; k < editables.length; k++) {
                var candidate = editables[k];
                if (candidate.id === 'mapsprosearch-field') continue;
                if (candidate !== titleNode && isElementUsable(candidate)) {
                    return candidate;
                }
            }
        }
        return null;
    }

    /**
     * 尋找氣泡窗內的「儲存 (Save)」按鈕
     */
    function findInfoWindowSaveButton() {
        var saveIds = [
            'map-infowindow-done-editing-button',
            'map-infowindow-save-button',
            'infowindow-save-button'
        ];
        for (var i = 0; i < saveIds.length; i++) {
            var byId = document.getElementById(saveIds[i]);
            if (byId && isElementUsable(byId)) return byId;
        }

        var scope = findInfoWindowContainer() || document;
        var attrSelectors = [
            '[id*="infowindow"][id*="done"]',
            '[id*="infowindow"][id*="save"]',
            '[role="button"][aria-label*="儲存"]',
            '[role="button"][aria-label*="Save"]',
            '[data-tooltip*="儲存"]',
            '[data-tooltip*="Save"]'
        ];
        for (var j = 0; j < attrSelectors.length; j++) {
            try {
                var matched = scope.querySelector(attrSelectors[j]);
                if (matched && isElementUsable(matched)) return matched;
            } catch (_e) {}
        }

        var buttons = scope.querySelectorAll('button, [role="button"], div.goog-inline-block, div.jfk-button');
        for (var k = 0; k < buttons.length; k++) {
            var btn = buttons[k];
            if (!isElementUsable(btn)) continue;
            var txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
            if (
                txt === '儲存' ||
                txt === 'Save' ||
                txt === '完成' ||
                txt === 'Done'
            ) {
                return btn;
            }
        }
        return null;
    }

    /**
     * 將文字寫入氣泡窗的 `<input>`、`<textarea>` 或 `contenteditable="true"` 元素，並派發完整 Closure 事件
     */
    function setEditableElementValue(rawEl, text) {
        var el = resolveEditableNode(rawEl);
        if (!el) return false;
        var cleanText = (text === null || text === undefined) ? '' : String(text);

        try {
            simulateClick(el);
            if (typeof el.focus === 'function') {
                el.focus();
            }

            var tag = (el.tagName || '').toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                var proto = tag === 'TEXTAREA'
                    ? (window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype)
                    : (window.HTMLInputElement && window.HTMLInputElement.prototype);
                var descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
                if (descriptor && typeof descriptor.set === 'function') {
                    descriptor.set.call(el, cleanText);
                } else {
                    el.value = cleanText;
                }
                el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
                return true;
            }

            // 處理 contenteditable="true" 或 Closure 屬性值容器
            if (typeof document.execCommand === 'function') {
                try {
                    document.execCommand('selectAll', false, null);
                    document.execCommand('insertText', false, cleanText);
                } catch (_execErr) {}
            }
            if ((el.textContent || '').trim() !== cleanText.trim()) {
                el.textContent = cleanText;
            }
            el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
        } catch (err) {
            console.warn('[MyGMap] setEditableElementValue error:', err);
            try {
                if ('value' in el) {
                    el.value = cleanText;
                } else {
                    el.textContent = cleanText;
                }
                return true;
            } catch (_e2) {
                return false;
            }
        }
    }

    /**
     * Phase 4 核心自動化狀態機：一鍵將手機 GPS 座標加入地圖並自動填入標題與備註儲存
     *
     * @param {number} lat - 緯度
     * @param {number} lng - 經度
     * @param {string} title - 地點名稱（標題）
     * @param {string} description - 備註說明
     * @returns {boolean} 是否成功啟動狀態機
     */
    function addGpsPinToMap(lat, lng, title, description) {
        cancelActiveGpsPinTask();

        var numLat = Number(lat);
        var numLng = Number(lng);
        if (isNaN(numLat) || isNaN(numLng)) {
            reportGpsPinStatus({
                step: 'ERROR',
                message: '❌ 座標格式無效，無法執行自動打卡',
                isError: true,
                isCompleted: false
            });
            return false;
        }

        var now = new Date();
        var hh = ('0' + now.getHours()).slice(-2);
        var mm = ('0' + now.getMinutes()).slice(-2);
        var finalTitle = (title === null || title === undefined || String(title).trim() === '')
            ? ('GPS 標記 (' + hh + ':' + mm + ')')
            : String(title).trim();
        var finalDesc = (description === null || description === undefined)
            ? ''
            : String(description).trim();
        var fallbackClipboard = finalDesc ? (finalTitle + ' - ' + finalDesc) : finalTitle;
        var coordQuery = numLat.toFixed(6) + ', ' + numLng.toFixed(6);

        // 若抽屜開啟中，先收合抽屜
        if (helperState.drawerOpen && window.MyGMapHelper) {
            window.MyGMapHelper.setDrawerOpen(false);
        }

        // ====================================================================
        // Step 1：確認作用中圖層 + 將 "lat, lng" 填入 #mapsprosearch-field 並觸發搜尋
        // ====================================================================
        ensureActiveLayerAvailable();

        var searchInput = findElement('searchInput');
        if (!searchInput) {
            reportGpsPinStatus({
                step: 'ERROR',
                message: '⚠️ 找不到地圖搜尋框 (#mapsprosearch-field)，請確認已進入地圖編輯頁',
                subMessage: '已為您將「' + fallbackClipboard + '」複製到剪貼簿',
                isError: true,
                isCompleted: true,
                fallbackUsed: true,
                pinAdded: false,
                title: finalTitle,
                description: finalDesc,
                clipboardText: fallbackClipboard
            });
            return false;
        }

        reportGpsPinStatus({
            step: 'STEP_1_SEARCH',
            message: '🔍 Step 1/3：正在搜尋目前 GPS 座標 (' + coordQuery + ')…',
            subMessage: '準備加入圖釘：「' + finalTitle + '」',
            isCompleted: false,
            isError: false,
            fallbackUsed: false,
            pinAdded: false,
            title: finalTitle,
            description: finalDesc,
            clipboardText: fallbackClipboard
        });

        setInputValueAndNotify(searchInput, coordQuery);
        dispatchEnterKey(searchInput);
        var searchBtn = findElement('searchButton');
        if (searchBtn) {
            simulateClick(searchBtn);
        }

        helperState.activeTool = 'pan';
        reportActiveToolState();

        // 狀態機內部追蹤變數
        var currentPhase = 'WAIT_ADD_TO_MAP'; // 'WAIT_ADD_TO_MAP' -> 'WAIT_INFOWINDOW_EDIT' -> 'DONE'
        var phaseStartTime = Date.now();
        var editButtonClicked = false;
        var pinAddedToLayer = false;

        var taskState = {
            observer: null,
            pollTimer: null,
            timeoutTimer: null
        };
        helperState.activeGpsPinTask = taskState;

        function finishWithFallback(reasonMsg) {
            if (currentPhase === 'DONE') return;
            currentPhase = 'DONE';
            cancelActiveGpsPinTask();

            reportGpsPinStatus({
                step: 'FALLBACK_CLIPBOARD',
                message: pinAddedToLayer
                    ? '📍 圖釘已加入地圖！請直接長按氣泡窗貼上標題與備註'
                    : ('⚠️ ' + reasonMsg),
                subMessage: '📋 已自動複製到剪貼簿：「' + fallbackClipboard + '」',
                isCompleted: true,
                isError: !pinAddedToLayer,
                fallbackUsed: true,
                pinAdded: pinAddedToLayer,
                title: finalTitle,
                description: finalDesc,
                clipboardText: fallbackClipboard
            });
        }

        function evaluateStateMachine() {
            if (currentPhase === 'DONE') return;
            var elapsed = Date.now() - phaseStartTime;

            // ================================================================
            // Step 2：監聽等待 #addtomap-button 出現並呼叫 simulateClick() 加入圖層
            // ================================================================
            if (currentPhase === 'WAIT_ADD_TO_MAP') {
                // 給予搜尋請求 220ms 啟動時間，避免誤點到舊搜尋殘留按鈕
                if (elapsed < 220) return;

                var addBtn = findElement('addToMapButton');
                if (addBtn && isElementUsable(addBtn)) {
                    reportGpsPinStatus({
                        step: 'STEP_2_ADD_TO_MAP',
                        message: '➕ Step 2/3：已定位 GPS 綠十字，正在點擊「新增至地圖」…',
                        subMessage: '座標：' + coordQuery,
                        isCompleted: false,
                        isError: false,
                        fallbackUsed: false,
                        pinAdded: false,
                        title: finalTitle,
                        description: finalDesc,
                        clipboardText: fallbackClipboard
                    });

                    simulateClick(addBtn);
                    pinAddedToLayer = true;
                    currentPhase = 'WAIT_INFOWINDOW_EDIT';
                    phaseStartTime = Date.now();
                    return;
                }

                // 若超過 8.5 秒仍未出現 #addtomap-button，觸發容錯保底
                if (elapsed > 8500) {
                    finishWithFallback('等待「新增至地圖」按鈕逾時，請點選地圖綠釘後手動加入');
                }
                return;
            }

            // ================================================================
            // Step 3：等待圖釘編輯氣泡窗 (InfoWindow) 展開，自動填入標題與備註並點擊「儲存」
            // ================================================================
            if (currentPhase === 'WAIT_INFOWINDOW_EDIT') {
                if (elapsed < 200) return;

                var titleField = findInfoWindowTitleField();
                var saveBtn = findInfoWindowSaveButton();
                var isEditableNow = isNodeCurrentlyEditable(titleField) || Boolean(saveBtn);

                // 若氣泡窗已開啟但處於「檢視模式」，自動點擊氣泡窗內的「編輯 (Edit)」鉛筆按鈕進入編輯模式
                if (!isEditableNow && !editButtonClicked) {
                    var editBtn = findInfoWindowEditButton();
                    if (editBtn && isElementUsable(editBtn)) {
                        editButtonClicked = true;
                        simulateClick(editBtn);
                        return;
                    }
                }

                if (titleField && (isEditableNow || elapsed > 1200)) {
                    currentPhase = 'DONE';
                    cancelActiveGpsPinTask();

                    reportGpsPinStatus({
                        step: 'STEP_3_FILL_AND_SAVE',
                        message: '📝 Step 3/3：正在自動填入「' + finalTitle + '」與備註並儲存…',
                        subMessage: finalDesc ? ('備註：' + finalDesc) : '自動寫入氣泡窗欄位中',
                        isCompleted: false,
                        isError: false,
                        fallbackUsed: false,
                        pinAdded: true,
                        title: finalTitle,
                        description: finalDesc,
                        clipboardText: fallbackClipboard
                    });

                    var titleFilled = setEditableElementValue(titleField, finalTitle);
                    var descField = findInfoWindowDescField(titleField);
                    if (finalDesc && descField) {
                        setEditableElementValue(descField, finalDesc);
                    }

                    // 延遲 180ms 後自動點擊「儲存 (Save)」按鈕，確保 Closure Library 已接收 input 事件
                    setTimeout(function () {
                        var latestSaveBtn = findInfoWindowSaveButton();
                        var savedClicked = false;
                        if (latestSaveBtn) {
                            savedClicked = simulateClick(latestSaveBtn);
                        } else if (titleField && (titleField.tagName || '').toUpperCase() === 'INPUT') {
                            dispatchEnterKey(titleField);
                            savedClicked = true;
                        }

                        if (titleFilled) {
                            reportGpsPinStatus({
                                step: 'COMPLETED',
                                message: '✅ 已成功將「' + finalTitle + '」加入我的地圖' + (savedClicked ? '並自動儲存！' : '！'),
                                subMessage: finalDesc
                                    ? ('座標：' + coordQuery + ' • 備註：' + finalDesc)
                                    : ('座標：' + coordQuery),
                                isCompleted: true,
                                isError: false,
                                fallbackUsed: false,
                                pinAdded: true,
                                title: finalTitle,
                                description: finalDesc,
                                clipboardText: fallbackClipboard
                            });
                        } else {
                            // 若欄位寫入失敗，啟動容錯保底將「標題 - 備註」複製到剪貼簿
                            reportGpsPinStatus({
                                step: 'FALLBACK_CLIPBOARD',
                                message: '📍 圖釘已加入地圖！已將「標題 - 備註」複製到剪貼簿，可直接長按貼上',
                                subMessage: '📋 剪貼簿內容：「' + fallbackClipboard + '」',
                                isCompleted: true,
                                isError: false,
                                fallbackUsed: true,
                                pinAdded: true,
                                title: finalTitle,
                                description: finalDesc,
                                clipboardText: fallbackClipboard
                            });
                        }
                    }, 180);
                    return;
                }

                // 若 Step 3 超過 6.5 秒仍找不到氣泡窗標題輸入框，執行容錯保底設計
                if (elapsed > 6500) {
                    finishWithFallback('圖釘已加入地圖，但未偵測到編輯輸入框');
                }
            }
        }

        // 啟動 MutationObserver 即時監聽 DOM 變化，搭配 200ms 輪詢雙重保障
        if (typeof MutationObserver === 'function' && document.body) {
            var pinObserver = new MutationObserver(function () {
                evaluateStateMachine();
            });
            pinObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true
            });
            taskState.observer = pinObserver;
        }

        taskState.pollTimer = setInterval(evaluateStateMachine, 200);
        taskState.timeoutTimer = setTimeout(function () {
            if (currentPhase !== 'DONE') {
                finishWithFallback('自動化打卡流程逾時');
            }
        }, 15500);

        return true;
    }

    /**
     * ========================================================================
     * 9. Phase 5：提取目前網頁的地圖 ID (mid)、地圖中心 (ll)、選取圖釘與搜尋框座標
     *    供「🗺️ 在 Google Maps App 開啟 (導航 / 街景 / 雲端地圖)」使用
     * ========================================================================
     */
    function parseLatLngPairFromString(rawStr) {
        if (!rawStr) return null;
        var decoded = String(rawStr);
        try {
            if (decoded.indexOf('%') !== -1) {
                decoded = decodeURIComponent(decoded);
            }
        } catch (_e) {}

        var match = decoded.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
        if (!match) return null;
        var lat = parseFloat(match[1]);
        var lng = parseFloat(match[2]);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return null;
        }
        if (lat === 0 && lng === 0) return null;
        return { lat: lat, lng: lng };
    }

    function extractNavigationContext() {
        var href = (window.location && window.location.href) ? String(window.location.href) : '';
        var mid = '';
        var midMatch = href.match(/[?&]mid=([^&#\s]+)/i);
        if (midMatch && midMatch[1]) {
            try {
                mid = decodeURIComponent(midMatch[1]).trim();
            } catch (_e) {
                mid = midMatch[1].trim();
            }
        }

        // 1. 從目前網址提取 ll=lat,lng 或 @lat,lng 地圖中心座標
        var mapCenterLat = null;
        var mapCenterLng = null;
        var llParamMatch = href.match(/[?&](?:ll|sll|center)=([^&#\s]+)/i);
        if (llParamMatch && llParamMatch[1]) {
            var llPair = parseLatLngPairFromString(llParamMatch[1]);
            if (llPair) {
                mapCenterLat = llPair.lat;
                mapCenterLng = llPair.lng;
            }
        }
        if (mapCenterLat === null) {
            var atMatch = href.match(/@(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
            if (atMatch) {
                var atPair = parseLatLngPairFromString(atMatch[1] + ',' + atMatch[2]);
                if (atPair) {
                    mapCenterLat = atPair.lat;
                    mapCenterLng = atPair.lng;
                }
            }
        }

        // 2. 從目前展開的圖釘氣泡窗 (#map-infowindow-container) 提取標題與座標
        var selectedPinTitle = '';
        var selectedPinLat = null;
        var selectedPinLng = null;
        var infoContainer = findInfoWindowContainer();
        if (infoContainer && isElementUsable(infoContainer)) {
            var titleNode = findInfoWindowTitleField();
            if (titleNode) {
                var rawTitle = ('value' in titleNode && titleNode.value)
                    ? titleNode.value
                    : (titleNode.textContent || '');
                selectedPinTitle = String(rawTitle || '').replace(/\s+/g, ' ').trim();
            }
            var infoText = (infoContainer.innerText || infoContainer.textContent || '');
            var pinCoordPair = parseLatLngPairFromString(infoText);
            if (!pinCoordPair) {
                // 檢查氣泡窗內是否有指向 Google Maps 的連結包含座標
                var links = infoContainer.querySelectorAll('a[href]');
                for (var i = 0; i < links.length; i++) {
                    var linkPair = parseLatLngPairFromString(links[i].getAttribute('href') || '');
                    if (linkPair) {
                        pinCoordPair = linkPair;
                        break;
                    }
                }
            }
            if (pinCoordPair) {
                selectedPinLat = pinCoordPair.lat;
                selectedPinLng = pinCoordPair.lng;
            }
        }

        // 3. 從搜尋框 (#mapsprosearch-field) 提取目前搜尋文字或座標
        var searchBoxText = '';
        var searchBoxLat = null;
        var searchBoxLng = null;
        var searchInput = findElement('searchInput');
        if (searchInput && searchInput.value) {
            searchBoxText = String(searchInput.value).trim();
            var searchPair = parseLatLngPairFromString(searchBoxText);
            if (searchPair) {
                searchBoxLat = searchPair.lat;
                searchBoxLng = searchPair.lng;
            }
        }

        return {
            pageUrl: href,
            mid: mid,
            mapCenterLat: mapCenterLat,
            mapCenterLng: mapCenterLng,
            selectedPinTitle: selectedPinTitle,
            selectedPinLat: selectedPinLat,
            selectedPinLng: selectedPinLng,
            searchBoxText: searchBoxText,
            searchBoxLat: searchBoxLat,
            searchBoxLng: searchBoxLng
        };
    }

    /**
     * 10. 掛載與導出 window.MyGMapHelper 公開 API
     */
    window.MyGMapHelper = {
        _state: helperState,
        DOM_TARGETS: DOM_TARGETS,

        /** 強制確認並寫入行動版 Viewport */
        ensureViewportMeta: ensureViewportMeta,

        /** 多重容錯 DOM 搜尋器 */
        findElement: findElement,

        /** Closure Library 完整指標與滑鼠事件序列模擬點擊 */
        simulateClick: simulateClick,

        /** Phase 4：一鍵將手機 GPS 座標加入地圖並自動填入標題與備註儲存 */
        addGpsPinToMap: addGpsPinToMap,

        /** Phase 4：取消正在進行中的自動打卡狀態機 */
        cancelActiveGpsPinTask: cancelActiveGpsPinTask,

        /** Phase 5：提取目前網頁的 mid、選取圖釘與搜尋框座標供跳轉官方 Google Maps App 使用 */
        extractNavigationContext: extractNavigationContext,

        /** 重新掃描並標記所有關鍵 DOM 節點 */
        scanAndTagDom: function () {
            ensureViewportMeta();
            var summary = scanAndTagDom();
            applyBodyClasses();
            reportPageModeIfNeeded(false);
            return summary;
        },

        /** 偵測是否位於地圖編輯頁 */
        isEditorPage: detectIsEditorPage,

        /** 設定是否啟用手機版優化 CSS (false 即為 CSS Bypass 逃生門，恢復原始桌面排版) */
        setMobileMode: function (enabled) {
            helperState.mobileMode = Boolean(enabled);
            applyBodyClasses();
            reportMobileModeState();
            try {
                window.dispatchEvent(new Event('resize'));
            } catch (_e) {}
            return helperState.mobileMode;
        },

        /** 切換手機優化排版 / 原始桌面排版 (CSS Bypass) */
        toggleMobileMode: function () {
            return this.setMobileMode(!helperState.mobileMode);
        },

        /** Phase 3 規範別名：切換手機優化排版 / 原始桌面排版 */
        toggleMobileCssMode: function () {
            return this.toggleMobileMode();
        },

        /** 設定左側圖層抽屜開關狀態 */
        setDrawerOpen: function (open) {
            helperState.drawerOpen = Boolean(open);
            // 若展開抽屜時處於桌面原始排版，自動啟用手機版排版讓抽屜生效
            if (helperState.drawerOpen && !helperState.mobileMode) {
                helperState.mobileMode = true;
                reportMobileModeState();
            }
            scanAndTagDom();
            applyBodyClasses();
            reportDrawerState();
            return helperState.drawerOpen;
        },

        /** 切換左側圖層抽屜開關 */
        toggleDrawer: function () {
            return this.setDrawerOpen(!helperState.drawerOpen);
        },

        /** Phase 3 規範方法：展開或收合左側圖層抽屜面板 */
        toggleLayerDrawer: function () {
            return this.toggleDrawer();
        },

        /** 設定是否啟用開發者 DOM 探測模式 (Inspect Mode) */
        setInspectMode: function (enabled) {
            helperState.inspectMode = Boolean(enabled);
            if (!helperState.inspectMode) {
                clearPreviousInspectedHighlight();
            }
            applyBodyClasses();
            reportInspectModeState();
            return helperState.inspectMode;
        },

        /** 切換開發者 DOM 探測模式 */
        toggleInspectMode: function () {
            return this.setInspectMode(!helperState.inspectMode);
        },

        /** 觸發指定編輯工具或按鈕 */
        triggerAction: function (targetKey) {
            var el = findElement(targetKey);
            if (!el) {
                console.warn('[MyGMap] triggerAction element not found for key:', targetKey);
                return false;
            }
            // 若點擊工具列按鈕時左側抽屜是開著的，自動收合抽屜方便使用者操作地圖
            if (helperState.drawerOpen && targetKey !== 'layerPanel') {
                this.setDrawerOpen(false);
            }
            return simulateClick(el);
        },

        /**
         * Phase 3 規範方法：啟動「新增標記 (插針)」工具
         */
        activateAddMarkerTool: function () {
            var ok = this.triggerAction('addMarkerTool');
            if (ok) {
                helperState.activeTool = 'addMarker';
                reportActiveToolState();
            }
            return ok;
        },

        /**
         * Phase 3 規範方法：切換回「手型選取/平移模式」工具
         */
        activatePanTool: function () {
            var ok = this.triggerAction('selectTool');
            helperState.activeTool = 'pan';
            reportActiveToolState();
            return ok;
        },

        /**
         * Phase 3 規範方法：將關鍵字填入 #mapsprosearch-field 並觸發地圖搜尋
         */
        searchPlace: function (query) {
            var cleanQuery = (query === null || query === undefined) ? '' : String(query).trim();
            if (!cleanQuery) return false;

            if (helperState.drawerOpen) {
                this.setDrawerOpen(false);
            }

            var inputEl = findElement('searchInput');
            if (!inputEl) {
                console.warn('[MyGMap] searchPlace: #mapsprosearch-field not found');
                return false;
            }

            setInputValueAndNotify(inputEl, cleanQuery);
            dispatchEnterKey(inputEl);

            var searchBtn = findElement('searchButton');
            if (searchBtn) {
                simulateClick(searchBtn);
            }

            // 搜尋後工具自動回到手型選取狀態
            helperState.activeTool = 'pan';
            reportActiveToolState();
            return true;
        },

        /**
         * Phase 3 規範方法：一鍵點擊搜尋結果的「新增至地圖 (#addtomap-button)」按鈕
         */
        clickAddToMap: function () {
            if (helperState.drawerOpen) {
                this.setDrawerOpen(false);
            }
            var addBtn = findElement('addToMapButton');
            if (!addBtn) {
                console.warn('[MyGMap] clickAddToMap: #addtomap-button not found or not visible');
                return false;
            }
            return simulateClick(addBtn);
        },

        /**
         * Phase 3 規範方法：觸發網頁「復原 (Undo)」
         */
        triggerUndo: function () {
            if (helperState.drawerOpen) {
                this.setDrawerOpen(false);
            }
            var undoEl = findElement('undoTool');
            if (undoEl && simulateClick(undoEl)) {
                return true;
            }
            return dispatchCtrlShortcut('z', 90);
        },

        /**
         * Phase 3 規範方法：觸發網頁「重做 (Redo)」
         */
        triggerRedo: function () {
            if (helperState.drawerOpen) {
                this.setDrawerOpen(false);
            }
            var redoEl = findElement('redoTool');
            if (redoEl && simulateClick(redoEl)) {
                return true;
            }
            return dispatchCtrlShortcut('y', 89);
        },

        /** 同步 Android 端傳入的完整狀態並強制回報目前頁面模式 */
        syncFromAndroid: function (options) {
            if (options && typeof options === 'object') {
                if (typeof options.mobileMode === 'boolean') {
                    helperState.mobileMode = options.mobileMode;
                }
                if (typeof options.drawerOpen === 'boolean') {
                    helperState.drawerOpen = options.drawerOpen;
                }
                if (typeof options.inspectMode === 'boolean') {
                    helperState.inspectMode = options.inspectMode;
                    if (!helperState.inspectMode) {
                        clearPreviousInspectedHighlight();
                    }
                }
            }
            ensureViewportMeta();
            var domSummary = scanAndTagDom();
            applyBodyClasses();
            var isEditor = reportPageModeIfNeeded(true);
            reportDrawerState();
            reportMobileModeState();
            reportInspectModeState();
            reportActiveToolState();
            return {
                isEditorPage: isEditor,
                mobileMode: helperState.mobileMode,
                drawerOpen: helperState.drawerOpen,
                inspectMode: helperState.inspectMode,
                activeTool: helperState.activeTool,
                domSummary: domSummary
            };
        }
    };

    /**
     * 9. 初次載入時註冊全域事件監聽與 MutationObserver (避免重複掛載)
     */
    if (!helperState.initialized) {
        helperState.initialized = true;

        // Capture 階段攔截點擊，確保在 Closure Library 處理前可攔截並進行 DOM 探測
        document.addEventListener('click', handleDocumentInspectClick, true);

        // 監聽歷史紀錄與網址變化
        window.addEventListener('popstate', function () {
            setTimeout(function () {
                scanAndTagDom();
                reportPageModeIfNeeded(false);
            }, 150);
        });

        window.addEventListener('hashchange', function () {
            setTimeout(function () {
                scanAndTagDom();
                reportPageModeIfNeeded(false);
            }, 150);
        });

        // 透過節流 MutationObserver 動態追蹤 Google My Maps 異步渲染出的面板與工具列
        var scanTimer = null;
        var observer = new MutationObserver(function () {
            if (scanTimer) return;
            scanTimer = setTimeout(function () {
                scanTimer = null;
                scanAndTagDom();
                applyBodyClasses();
                reportPageModeIfNeeded(false);
            }, 350);
        });

        if (document.documentElement) {
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }
    }

    // 立即執行一次初始化掃描與回報
    ensureViewportMeta();
    scanAndTagDom();
    applyBodyClasses();
    reportPageModeIfNeeded(true);
})();
