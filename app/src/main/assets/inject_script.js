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
     * Phase 10 地圖畫布保護機制：
     * 判斷節點是否為文件根節點、地圖畫布本身，或其內部包含地圖畫布 / 搜尋框 / 工具列。
     * 凡回傳 true 者代表這是地圖畫布或共用版面根容器，絕對禁止被標記為 layer-panel。
     */
    function containsMapOrEditorRoot(el) {
        if (!el || el === document.body || el === document.documentElement) {
            return true;
        }
        if (el.nodeType !== 1) {
            return true;
        }
        var protectedSelector =
            '#map-canvas, #lyra-canvas, #map-container, .gm-style, canvas, ' +
            '#mapsprosearch-field, [role="toolbar"], [data-mygmap-role="map-canvas"]';
        try {
            if (typeof el.matches === 'function' && el.matches(protectedSelector)) {
                return true;
            }
            if (typeof el.querySelector === 'function' && el.querySelector(protectedSelector)) {
                return true;
            }
        } catch (_e) {
            // 忽略選擇器例外
        }
        return false;
    }

    /**
     * 定位地圖主畫布元素：優先 #map-canvas / #lyra-canvas，次之為不包含 #featurelist-pane 的 .gm-style 外層地圖容器
     */
    function findMapCanvasElement() {
        var directCanvas = document.getElementById('map-canvas') || document.getElementById('lyra-canvas');
        if (directCanvas) {
            return directCanvas;
        }
        var mapContainer = document.getElementById('map-container');
        if (mapContainer && !(mapContainer.querySelector && mapContainer.querySelector('#featurelist-pane'))) {
            return mapContainer;
        }
        var gmStyle = document.querySelector('.gm-style');
        if (gmStyle) {
            var best = gmStyle;
            var candidate = gmStyle.parentElement;
            var depth = 0;
            while (candidate && candidate !== document.body && candidate !== document.documentElement && depth < 3) {
                if (candidate.querySelector && (
                    candidate.querySelector('#featurelist-pane') ||
                    candidate.querySelector('#mapsprosearch-field') ||
                    candidate.querySelector('[role="toolbar"]')
                )) {
                    break;
                }
                best = candidate;
                candidate = candidate.parentElement;
                depth++;
            }
            return best;
        }
        return null;
    }

    /**
     * 啟發式結構搜尋：尋找畫面左側固定寬度的圖層面板容器
     * 嚴格禁止攀爬至任何 containsMapOrEditorRoot(el) === true 的地圖共用外層容器。
     */
    function findLayerPanelByHeuristic() {
        var existingTagged = document.querySelector('[data-mygmap-role="layer-panel"]');
        if (existingTagged) {
            if (isElementUsable(existingTagged) && !containsMapOrEditorRoot(existingTagged)) {
                return existingTagged;
            }
            existingTagged.removeAttribute('data-mygmap-role');
        }

        var viewportHeight = window.innerHeight || 600;
        var viewportWidth = window.innerWidth || 360;

        var featurePane = document.getElementById('featurelist-pane');
        if (featurePane) {
            if (containsMapOrEditorRoot(featurePane)) {
                return null;
            }
            var current = featurePane;
            var bestPanel = featurePane;
            var depth = 0;
            while (current && current.parentElement && current.parentElement !== document.body && depth < 4) {
                var parent = current.parentElement;

                // 條件 1：父層含地圖畫布、canvas、搜尋框或工具列，立即停止攀爬
                if (containsMapOrEditorRoot(parent)) {
                    break;
                }

                // 條件 2：父層除 current 外還有其他大尺寸可見兄弟元素（左右/上下分割共用殼），立即停止
                var hasLargeSibling = false;
                var children = parent.children || [];
                for (var s = 0; s < children.length; s++) {
                    var sibling = children[s];
                    if (!sibling || sibling === current || sibling.id === BACKDROP_ID) continue;
                    if (!isElementUsable(sibling)) continue;
                    var sRect = sibling.getBoundingClientRect();
                    if (sRect.height >= viewportHeight * 0.30 && sRect.width >= 40) {
                        hasLargeSibling = true;
                        break;
                    }
                }
                if (hasLargeSibling) {
                    break;
                }

                // 條件 3：父層佔滿整個視窗寬度且明顯寬於 #featurelist-pane，代表全螢幕外殼，立即停止
                var currentRect = current.getBoundingClientRect();
                var pRect = parent.getBoundingClientRect();
                if (pRect.width >= viewportWidth - 8 && pRect.width > currentRect.width + 16) {
                    break;
                }

                if (pRect.width > 0 && pRect.width <= 460 && pRect.height >= viewportHeight * 0.35) {
                    bestPanel = parent;
                    current = parent;
                    depth++;
                } else {
                    break;
                }
            }
            return bestPanel;
        }

        // 第二階段結構啟發式掃描：僅在編輯頁執行，並嚴格跳過任何含地圖/編輯器根節點之容器
        if (!detectIsEditorPage()) {
            return null;
        }

        var containers = document.querySelectorAll('div, aside, section');
        var maxPanelWidth = Math.min(380, viewportWidth * 0.88);

        for (var i = 0; i < containers.length; i++) {
            var candidate = containers[i];
            if (candidate.id === 'map-canvas' || candidate.id === 'lyra-canvas' || candidate.id === BACKDROP_ID) {
                continue;
            }
            if (containsMapOrEditorRoot(candidate)) {
                continue;
            }
            var cStyle = window.getComputedStyle(candidate);
            if (cStyle.display === 'none' || cStyle.visibility === 'hidden') continue;
            if (cStyle.position !== 'fixed' && cStyle.position !== 'absolute') continue;

            var cRect = candidate.getBoundingClientRect();
            var isLeftAligned = cRect.left >= -460 && cRect.left <= 36;
            var isPanelWidth = cRect.width >= 200 && cRect.width <= maxPanelWidth;
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
     * 檢查是否允許將指定 roleAttr 標記於元素上（防止 layer-panel 誤標含地圖或非編輯頁容器）
     */
    function canAssignRole(roleAttr, el) {
        if (!el) return false;
        if (roleAttr === 'layer-panel') {
            return detectIsEditorPage() && !containsMapOrEditorRoot(el);
        }
        return true;
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
            if (panelEl && canAssignRole(strategy.roleAttr, panelEl)) {
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
                if (byId && isElementUsable(byId) && canAssignRole(strategy.roleAttr, byId)) {
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
            if (byLabel && canAssignRole(strategy.roleAttr, byLabel)) {
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
                    if (bySel && isElementUsable(bySel) && canAssignRole(strategy.roleAttr, bySel)) {
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
            if (byHeuristic && isElementUsable(byHeuristic) && canAssignRole(strategy.roleAttr, byHeuristic)) {
                if (strategy.roleAttr) {
                    byHeuristic.setAttribute('data-mygmap-role', strategy.roleAttr);
                }
                return byHeuristic;
            }
        }

        return null;
    }

    function isSafeOverlayChromeNode(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        if (el.nodeType !== 1) return false;
        if (el.querySelector && el.querySelector(
            '#map-canvas, #lyra-canvas, #map-container, .gm-style, canvas, ' +
            '#featurelist-pane, #map-infowindow-container'
        )) {
            return false;
        }
        return true;
    }

    /**
     * 標記右上角 Google 帳號頭像、九宮格選單與網頁版頂部搜尋列外層容器，讓行動版 CSS 隱藏以釋放地圖空間
     */
    function tagFloatingHeaderChrome() {
        var accountSelectors = [
            '#gb',
            'a[href*="accounts.google.com/SignOutOptions"]',
            '[aria-label*="Google 帳戶"]',
            '[aria-label*="Google Account"]',
            '[aria-label*="Google 應用程式"]',
            '[aria-label*="Google apps"]'
        ];
        for (var i = 0; i < accountSelectors.length; i++) {
            try {
                var matches = document.querySelectorAll(accountSelectors[i]);
                for (var j = 0; j < matches.length; j++) {
                    var target = matches[j];
                    if (!isSafeOverlayChromeNode(target)) continue;
                    var curr = target;
                    var best = target;
                    var depth = 0;
                    while (curr && curr.parentElement && depth < 4) {
                        var parent = curr.parentElement;
                        if (!isSafeOverlayChromeNode(parent)) break;
                        var pRect = parent.getBoundingClientRect ? parent.getBoundingClientRect() : null;
                        if (!pRect || pRect.width > 360 || pRect.height > 180) break;
                        best = parent;
                        curr = parent;
                        depth++;
                    }
                    best.setAttribute('data-mygmap-role', 'google-account-widget');
                }
            } catch (_e) {}
        }

        // 2. 標記桌面版頂部搜尋框與外層陰影卡片容器 (#mapsprosearch-field / #mapsprosearch-button)
        var searchField = document.getElementById('mapsprosearch-field');
        var searchBtn = document.getElementById('mapsprosearch-button');
        var searchAnchor = searchField || searchBtn;
        if (searchAnchor && isSafeOverlayChromeNode(searchAnchor)) {
            var sCurr = searchAnchor;
            var sBest = searchAnchor;
            var sDepth = 0;
            while (sCurr && sCurr.parentElement && sDepth < 5) {
                var sParent = sCurr.parentElement;
                if (!isSafeOverlayChromeNode(sParent)) break;
                var sRect = sParent.getBoundingClientRect ? sParent.getBoundingClientRect() : null;
                if (!sRect || sRect.height > 220) break;
                sBest = sParent;
                sCurr = sParent;
                sDepth++;
            }
            sBest.setAttribute('data-mygmap-role', 'search-container');
        }
    }

    /**
     * 掃描全頁 DOM 並標記 data-mygmap-role，供 inject_style.css 套用行動版抽屜與觸控放大樣式
     * Phase 10 調整順序：
     * 1. 先標記地圖主畫布 [data-mygmap-role="map-canvas"]
     * 2. 執行自我修復清理：移除任何誤標在地圖共用容器或非編輯頁的 layer-panel 標記
     * 3. 再依序標記各 DOM_TARGETS（並二次確認無誤標）
     */
    function scanAndTagDom() {
        var foundSummary = {};

        // 1. 先標記地圖主畫布以套用多點觸控、滿版可視與保護機制
        var mapCanvas = findMapCanvasElement();
        if (mapCanvas) {
            mapCanvas.setAttribute('data-mygmap-role', 'map-canvas');
        }

        // 2. 自我修復清理：立即解除任何誤標在地圖/編輯器根容器或非編輯頁的 layer-panel 隱藏狀態
        var isEditor = detectIsEditorPage();
        var existingPanels = document.querySelectorAll('[data-mygmap-role="layer-panel"]');
        for (var p = 0; p < existingPanels.length; p++) {
            var taggedPanel = existingPanels[p];
            if (!isEditor || containsMapOrEditorRoot(taggedPanel)) {
                taggedPanel.removeAttribute('data-mygmap-role');
            }
        }

        // 3. 掃描並標記所有關鍵節點
        var keys = Object.keys(DOM_TARGETS);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var el = findElement(key);
            foundSummary[key] = Boolean(el);

            // 若找到新增標記、選取或復原/重做工具，順便將其所屬工具列及外層陰影框標記為 editor-toolbar
            if (el && (key === 'addMarkerTool' || key === 'selectTool' || key === 'drawLineTool' || key === 'undoTool' || key === 'redoTool')) {
                var toolbar = el.closest('[role="toolbar"], .goog-toolbar') || el.parentElement;
                if (toolbar && isSafeOverlayChromeNode(toolbar)) {
                    var tbBest = toolbar;
                    var tbParent = toolbar.parentElement;
                    if (tbParent && isSafeOverlayChromeNode(tbParent)) {
                        var tbRect = tbParent.getBoundingClientRect ? tbParent.getBoundingClientRect() : null;
                        if (tbRect && tbRect.height <= 220) {
                            tbBest = tbParent;
                        }
                    }
                    tbBest.setAttribute('data-mygmap-role', 'editor-toolbar');
                }
            }
        }

        // 4. 二次防線：確保最終沒有任何誤標的 layer-panel 殘留
        isEditor = detectIsEditorPage();
        var postPanels = document.querySelectorAll('[data-mygmap-role="layer-panel"]');
        for (var q = 0; q < postPanels.length; q++) {
            if (!isEditor || containsMapOrEditorRoot(postPanels[q])) {
                postPanels[q].removeAttribute('data-mygmap-role');
                foundSummary.layerPanel = false;
            }
        }

        // 5. Phase 12：標記展開中的氣泡窗按鈕列與詳細資料區塊，並標記右上角多餘帳號/工具列
        tagInfoWindowSubElements();
        tagFloatingHeaderChrome();

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
        lastResizedEditorUrl: '',
        initialDrawerResizeDone: false,
        lastExternalNavTriggerAt: 0,
        lastReportedPinStateJson: '',
        userDismissedPinJson: '',
        lastCloseActionAt: 0,
        initialized: false
    };

    var mapResizeDebounceTimer = null;

    /**
     * Phase 10：在編輯頁套用手機優化排版並隱藏左側圖層欄後，延遲 120ms 觸發 resize（防抖），
     * 讓 Google Maps JS 主動重新計算 100vw 寬度並重繪地圖圖磚。
     */
    function scheduleMapResizeIfNeeded(forceSchedule) {
        if (!helperState.mobileMode || !detectIsEditorPage()) {
            return;
        }
        var mapEl = document.querySelector('[data-mygmap-role="map-canvas"]') ||
            document.getElementById('map-canvas') ||
            document.getElementById('lyra-canvas');
        if (!mapEl) {
            return;
        }

        var currentHref = (window.location && window.location.href) ? String(window.location.href) : '';
        var hasLayerPanel = Boolean(
            document.querySelector('[data-mygmap-role="layer-panel"]') ||
            document.getElementById('featurelist-pane')
        );

        var needsInitialUrlResize = helperState.lastResizedEditorUrl !== currentHref;
        var needsFirstDrawerResize = hasLayerPanel && !helperState.initialDrawerResizeDone;

        if (!forceSchedule && !needsInitialUrlResize && !needsFirstDrawerResize) {
            return;
        }

        helperState.lastResizedEditorUrl = currentHref;
        if (hasLayerPanel) {
            helperState.initialDrawerResizeDone = true;
        }

        if (mapResizeDebounceTimer) {
            clearTimeout(mapResizeDebounceTimer);
        }
        mapResizeDebounceTimer = setTimeout(function () {
            mapResizeDebounceTimer = null;
            try {
                window.dispatchEvent(new Event('resize'));
            } catch (_e) {}
        }, 120);
    }

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
        var prevEditorMode = helperState.lastReportedEditorMode;
        if (!isEditor) {
            helperState.lastResizedEditorUrl = '';
            helperState.initialDrawerResizeDone = false;
        }
        if (forceReport || prevEditorMode !== isEditor) {
            helperState.lastReportedEditorMode = isEditor;
            try {
                if (window.AndroidBridge && typeof window.AndroidBridge.onPageModeChanged === 'function') {
                    window.AndroidBridge.onPageModeChanged(Boolean(isEditor));
                }
            } catch (err) {
                console.warn('[MyGMap] AndroidBridge.onPageModeChanged error:', err);
            }
            if (isEditor && prevEditorMode === false) {
                scheduleMapResizeIfNeeded(true);
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
     * Phase 12：判斷氣泡窗元素是否真正在畫面上展開可見（排除空殼或已收合節點）
     */
    function isInfoWindowVisible(el) {
        if (!el || el.id === BACKDROP_ID || !isElementUsable(el)) return false;
        if (typeof el.getBoundingClientRect === 'function') {
            var rect = el.getBoundingClientRect();
            if (rect.width <= 4 || rect.height <= 4) {
                return false;
            }
        }
        var txt = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
        if (txt.length > 0) return true;
        if (el.querySelector && el.querySelector(
            '[id^="map-infowindow-attr-"], #map-infowindow-edit-button, ' +
            '#map-infowindow-done-editing-button, #map-infowindow-delete-button, ' +
            '#map-infowindow-directions-button, #addtomap-button, input, textarea'
        )) {
            return true;
        }
        return false;
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
                var els = document.querySelectorAll(selectors[i]);
                for (var j = 0; j < els.length; j++) {
                    if (isInfoWindowVisible(els[j])) {
                        return els[j];
                    }
                }
            } catch (_e) {}
        }
        return null;
    }

    /**
     * Phase 12：標記氣泡窗內的按鈕列與詳細資料區塊供 CSS 美化排版
     */
    function tagInfoWindowSubElements() {
        var container = findInfoWindowContainer();
        if (!container) return;

        var btnIds = [
            'map-infowindow-edit-button',
            'map-infowindow-delete-button',
            'map-infowindow-directions-button',
            'map-infowindow-done-editing-button',
            'map-infowindow-cancel-editing-button',
            'map-infowindow-style-button',
            'map-infowindow-photo-button'
        ];
        for (var i = 0; i < btnIds.length; i++) {
            var btn = document.getElementById(btnIds[i]);
            if (btn && isElementUsable(btn) && btn.parentElement && btn.parentElement !== container) {
                var parent = btn.parentElement;
                if (parent !== document.body && parent.children && parent.children.length >= 2) {
                    parent.setAttribute('data-mygmap-role', 'infowindow-actions');
                    break;
                }
            }
        }
    }

    /**
     * Phase 12：尋找氣泡窗關閉按鈕
     */
    function findInfoWindowCloseButton() {
        var directIds = [
            'map-infowindow-close-button',
            'infowindow-close-button'
        ];
        for (var i = 0; i < directIds.length; i++) {
            var byId = document.getElementById(directIds[i]);
            if (byId && isElementUsable(byId)) return byId;
        }

        var gmClose = document.querySelector('.gm-style-iw button.gm-ui-hover-effect, .gm-style-iw-c button.gm-ui-hover-effect');
        if (gmClose && isElementUsable(gmClose)) return gmClose;

        var container = findInfoWindowContainer();
        var scopes = [];
        if (container) scopes.push(container);
        var gmIw = document.querySelector('.gm-style-iw-c') || document.querySelector('.gm-style-iw');
        if (gmIw && scopes.indexOf(gmIw) === -1) scopes.push(gmIw);

        var closeSelectors = [
            'button[aria-label*="關閉"]',
            'button[aria-label*="Close"]',
            '[role="button"][aria-label*="關閉"]',
            '[role="button"][aria-label*="Close"]',
            '[data-tooltip*="關閉"]',
            '[data-tooltip*="Close"]',
            '[title*="關閉"]',
            '[title*="Close"]'
        ];
        for (var s = 0; s < scopes.length; s++) {
            var scope = scopes[s];
            for (var c = 0; c < closeSelectors.length; c++) {
                try {
                    var btn = scope.querySelector(closeSelectors[c]);
                    if (btn && isElementUsable(btn)) return btn;
                } catch (_e) {}
            }
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
     * 9. Phase 5 / Phase 13：提取目前網頁的地圖 ID (mid)、地圖中心 (ll)、選取圖釘與搜尋框座標
     *    供「🗺️ 在 Google Maps App 開啟 (導航 / 街景 / 雲端地圖)」使用
     * ========================================================================
     */

    /**
     * Phase 13：從 Google Maps 網址中擷取真實圖釘高精準度座標
     * 優先順序：
     * 1. 第一順位（最高精度真實圖釘）：!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)（若有多組取最後一組）
     * 2. 第二順位（明確目標參數）：destination=, daddr=, query=, q=, ll=, sll=, cbll=, viewpoint=, center=
     * 3. 第三順位（最後備援）：路徑中的 /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)（畫面視角中心）
     */
    function extractExactCoordsFromMapsUrl(rawUrl) {
        if (!rawUrl) return null;
        var decoded = String(rawUrl).trim();
        try {
            if (decoded.indexOf('%') !== -1) {
                decoded = decodeURIComponent(decoded);
            }
        } catch (_e) {
            decoded = decoded.replace(/%2C/gi, ',');
        }

        // 1. 第一順位（最高精度真實圖釘）：擷取 !3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)（若有多組取最後一組）
        var pinRegex = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/g;
        var pinMatch = null;
        var lastPinMatch = null;
        while ((pinMatch = pinRegex.exec(decoded)) !== null) {
            lastPinMatch = pinMatch;
        }
        if (lastPinMatch) {
            var pLat = parseFloat(lastPinMatch[1]);
            var pLng = parseFloat(lastPinMatch[2]);
            if (!isNaN(pLat) && !isNaN(pLng) && pLat >= -90 && pLat <= 90 && pLng >= -180 && pLng <= 180 && !(pLat === 0 && pLng === 0)) {
                return { lat: pLat, lng: pLng, isExactPin: true, isCameraCenter: false };
            }
        }

        // 2. 第二順位（明確目標參數）：destination=, daddr=, query=, q=, ll=, sll=, cbll=, viewpoint=, center=
        var queryParamRegex = /[?&](?:destination|daddr|query|q|ll|sll|cbll|viewpoint|center)=(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/i;
        var qMatch = decoded.match(queryParamRegex);
        if (qMatch) {
            var qLat = parseFloat(qMatch[1]);
            var qLng = parseFloat(qMatch[2]);
            if (!isNaN(qLat) && !isNaN(qLng) && qLat >= -90 && qLat <= 90 && qLng >= -180 && qLng <= 180 && !(qLat === 0 && qLng === 0)) {
                return { lat: qLat, lng: qLng, isExactPin: false, isCameraCenter: false };
            }
        }

        // 3. 第三順位（最後備援）：路徑中的 /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)（畫面視角中心）
        var atMatch = decoded.match(/@(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
        if (atMatch) {
            var atLat = parseFloat(atMatch[1]);
            var atLng = parseFloat(atMatch[2]);
            if (!isNaN(atLat) && !isNaN(atLng) && atLat >= -90 && atLat <= 90 && atLng >= -180 && atLng <= 180 && !(atLat === 0 && atLng === 0)) {
                return { lat: atLat, lng: atLng, isExactPin: false, isCameraCenter: true };
            }
        }

        return null;
    }

    /**
     * Phase 13：高精度經緯度數字格式化（最多 7 位小數，去除無效尾零）
     */
    function formatCoordNumber(num) {
        if (typeof num !== 'number' || isNaN(num)) return '';
        var s = num.toFixed(7);
        if (s.indexOf('.') !== -1) {
            s = s.replace(/\.?0+$/, '');
        }
        return s;
    }

    function formatCoordDisplay(lat, lng) {
        if (lat === null || lng === null || typeof lat !== 'number' || typeof lng !== 'number') return '';
        if (isNaN(lat) || isNaN(lng)) return '';
        return formatCoordNumber(lat) + ', ' + formatCoordNumber(lng);
    }

    function parseLatLngPairFromString(rawStr) {
        if (!rawStr) return null;
        var decoded = String(rawStr);
        try {
            if (decoded.indexOf('%') !== -1) {
                decoded = decodeURIComponent(decoded);
            }
        } catch (_e) {}

        // 若字串為包含 !3d!4d 或 Google Maps 參數的網址，優先透過 extractExactCoordsFromMapsUrl 擷取真實座標
        if (decoded.indexOf('!3d') !== -1 || decoded.indexOf('http') !== -1 || decoded.indexOf('/maps') !== -1) {
            var urlCoords = extractExactCoordsFromMapsUrl(decoded);
            if (urlCoords) {
                return { lat: urlCoords.lat, lng: urlCoords.lng };
            }
        }

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

    /**
     * Phase 13：從氣泡窗中擷取官方「在 Google 地圖檢視 (placeUrl)」與「規劃路線 (directionsUrl)」連結
     */
    function findInfoWindowActionUrls(container) {
        var result = {
            directionsUrl: '',
            placeUrl: ''
        };
        if (!container || !container.querySelectorAll) return result;
        var links = container.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var href = (a.getAttribute('href') || '').trim();
            if (!href || href.indexOf('javascript:') === 0 || href === '#') continue;
            var text = (a.innerText || a.textContent || '').trim();
            var lowerHref = href.toLowerCase();

            // 排除 /maps/d/ 內部地圖連結與帳號登入網址
            if (lowerHref.indexOf('/maps/d/') !== -1 ||
                lowerHref.indexOf('/maps/d?') !== -1 ||
                lowerHref.indexOf('accounts.google.') !== -1) {
                continue;
            }

            // directionsUrl 判斷：符合 /maps/dir、daddr= 或 destination=
            if (!result.directionsUrl) {
                if (
                    lowerHref.indexOf('/maps/dir') !== -1 ||
                    lowerHref.indexOf('daddr=') !== -1 ||
                    lowerHref.indexOf('destination=') !== -1
                ) {
                    result.directionsUrl = href;
                }
            }

            // placeUrl 判斷：文字包含 Google 地圖 / View in Google Maps / 檢視，或網址包含 /maps/place、cid=、ftid=、ludocid=、maps.google.、maps.app.goo.gl、goo.gl/maps（排除 /maps/dir）
            if (!result.placeUrl) {
                var isDirLink = lowerHref.indexOf('/maps/dir') !== -1 ||
                    lowerHref.indexOf('daddr=') !== -1 ||
                    lowerHref.indexOf('destination=') !== -1;
                if (!isDirLink) {
                    var textMatches = /Google\s*地圖|View in Google Maps|檢視/i.test(text);
                    var urlMatches = lowerHref.indexOf('/maps/place') !== -1 ||
                        lowerHref.indexOf('cid=') !== -1 ||
                        lowerHref.indexOf('ftid=') !== -1 ||
                        lowerHref.indexOf('ludocid=') !== -1 ||
                        lowerHref.indexOf('maps.google.') !== -1 ||
                        lowerHref.indexOf('maps.app.goo.gl') !== -1 ||
                        lowerHref.indexOf('goo.gl/maps') !== -1;
                    if (textMatches || urlMatches) {
                        result.placeUrl = href;
                    }
                }
            }
        }
        return result;
    }

    /**
     * Phase 11：尋找所有可能包含目前選取圖釘資訊的氣泡窗、對話框或詳情卡片容器
     */
    function findActivePinContainers() {
        var selectors = [
            '#map-infowindow-container',
            '[id*="map-infowindow"]',
            '.gm-style-iw',
            '.hz-infowindow',
            '[class*="infowindow"]',
            '[role="dialog"]',
            '[id*="feature-details"]',
            '[class*="feature-details"]',
            '[class*="detail-card"]',
            '#featurelist-pane [aria-selected="true"]'
        ];
        var list = [];
        for (var i = 0; i < selectors.length; i++) {
            try {
                var els = document.querySelectorAll(selectors[i]);
                for (var j = 0; j < els.length; j++) {
                    var el = els[j];
                    if (el && el.id !== BACKDROP_ID && isElementUsable(el) && list.indexOf(el) === -1) {
                        list.push(el);
                    }
                }
            } catch (_e) {}
        }
        return list;
    }

    function extractPinTitleFromContainers(containers) {
        var titleNode = findInfoWindowTitleField();
        if (titleNode) {
            var rawTitle = ('value' in titleNode && titleNode.value)
                ? titleNode.value
                : (titleNode.textContent || '');
            var cleaned = String(rawTitle || '').replace(/\s+/g, ' ').trim();
            if (cleaned) return cleaned;
        }
        var titleSelectors = [
            '[id^="map-infowindow-attr-"][id$="-value"]',
            '[id*="infowindow"][id*="title"]',
            '[class*="infowindow"][class*="title"]',
            '[role="heading"]',
            'h1', 'h2', 'h3'
        ];
        for (var i = 0; i < containers.length; i++) {
            var c = containers[i];
            for (var s = 0; s < titleSelectors.length; s++) {
                try {
                    var match = c.querySelector(titleSelectors[s]);
                    if (match && isElementUsable(match)) {
                        var txt = (match.value !== undefined && match.value !== null && String(match.value).trim())
                            ? String(match.value)
                            : (match.textContent || '');
                        txt = txt.replace(/\s+/g, ' ').trim();
                        if (txt) return txt;
                    }
                } catch (_e) {}
            }
            var textLines = ((c.innerText || c.textContent || '') + '').split(/\r?\n/);
            for (var l = 0; l < textLines.length; l++) {
                var line = textLines[l].replace(/\s+/g, ' ').trim();
                if (
                    line &&
                    line.length <= 80 &&
                    !/^(導航|規劃路線|Directions|編輯|Edit|刪除|Delete|關閉|Close|詳細資料|Details)$/i.test(line)
                ) {
                    return line;
                }
            }
        }
        return '';
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

        // 2. 從目前展開的圖釘氣泡窗 (#map-infowindow-container / .gm-style-iw / [role="dialog"] / 詳情卡片) 提取標題、座標與官方連結
        var pinContainers = findActivePinContainers();
        var selectedPinTitle = extractPinTitleFromContainers(pinContainers);
        var selectedPinLat = null;
        var selectedPinLng = null;
        var pinPlaceUrl = '';
        var pinDirectionsUrl = '';

        for (var cIdx = 0; cIdx < pinContainers.length; cIdx++) {
            var container = pinContainers[cIdx];
            var cActionUrls = findInfoWindowActionUrls(container);
            if (!pinPlaceUrl && cActionUrls.placeUrl) {
                pinPlaceUrl = cActionUrls.placeUrl;
            }
            if (!pinDirectionsUrl && cActionUrls.directionsUrl) {
                pinDirectionsUrl = cActionUrls.directionsUrl;
            }

            if (selectedPinLat === null || selectedPinLng === null) {
                var pinCoordPair = extractPinCoordinatesFromContainer(container);
                if (pinCoordPair) {
                    selectedPinLat = pinCoordPair.lat;
                    selectedPinLng = pinCoordPair.lng;
                }
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
            searchBoxLng: searchBoxLng,
            placeUrl: pinPlaceUrl,
            directionsUrl: pinDirectionsUrl
        };
    }

    /**
     * Phase 11：判斷網址是否屬於外部 Google Maps 導航 / 地點 / 短網址連結（排除 /maps/d/ 我的地圖與登入頁）
     */
    function isExternalGoogleMapsUrl(rawUrl) {
        if (!rawUrl) return false;
        var urlStr = String(rawUrl).trim();
        if (!urlStr) return false;
        var lower = urlStr.toLowerCase();

        if (
            lower.indexOf('google.navigation:') === 0 ||
            lower.indexOf('geo:') === 0 ||
            lower.indexOf('google.streetview:') === 0
        ) {
            return true;
        }

        if (
            lower.indexOf('accounts.google.') !== -1 ||
            /\/maps\/d(?:\/|[?#]|$)/i.test(lower)
        ) {
            return false;
        }

        if (/^https?:\/\/maps\.app\.goo\.gl\//i.test(urlStr)) return true;
        if (/^https?:\/\/goo\.gl\/maps(?:\/|$)/i.test(urlStr)) return true;
        if (/^https?:\/\/maps\.google\.[a-z.]+(?:\/|$|[?#])/i.test(urlStr)) return true;
        if (/^https?:\/\/(?:www\.)?google\.[a-z.]+\/maps(?:\/dir|\/place|\/search|\/@|\/?(?:[?#]|$))/i.test(urlStr)) {
            return true;
        }
        return false;
    }

    function dispatchExternalNavigationToAndroid(targetUrl, contextObj) {
        helperState.lastExternalNavTriggerAt = Date.now();
        var ctx = contextObj || extractNavigationContext();
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onExternalNavigationRequested === 'function') {
                window.AndroidBridge.onExternalNavigationRequested(
                    targetUrl ? String(targetUrl) : '',
                    JSON.stringify(ctx)
                );
                return true;
            }
        } catch (err) {
            console.warn('[MyGMap] AndroidBridge.onExternalNavigationRequested error:', err);
        }
        return false;
    }

    /**
     * Phase 11：安全包裝 window.open，攔截 Google Maps 導航 / 地點彈窗並直接轉交 Android 原生開啟
     */
    function installWindowOpenInterceptor() {
        if (window.__myGMapWindowOpenWrapped) return;
        var originalOpen = typeof window.open === 'function' ? window.open : null;
        window.__myGMapWindowOpenWrapped = true;

        window.open = function (url) {
            try {
                var urlStr = (url !== null && url !== undefined) ? String(url).trim() : '';
                if (urlStr && isExternalGoogleMapsUrl(urlStr)) {
                    if (dispatchExternalNavigationToAndroid(urlStr, extractNavigationContext())) {
                        return null;
                    }
                }
            } catch (err) {
                console.warn('[MyGMap] window.open interceptor error:', err);
            }
            if (originalOpen) {
                return originalOpen.apply(window, arguments);
            }
            return null;
        };
    }

    function isInsideInfoOrDetailCard(el) {
        if (!el || typeof el.closest !== 'function') return false;
        return Boolean(el.closest(
            '#map-infowindow-container, [id*="map-infowindow"], .gm-style-iw, ' +
            '.hz-infowindow, [class*="infowindow"], [role="dialog"], ' +
            '[id*="feature-details"], [class*="feature-details"], [class*="detail-card"]'
        ));
    }

    function findNavigationTriggerElement(rawTarget) {
        if (!rawTarget || rawTarget.nodeType !== 1) return null;

        // 1. 直接或上層為導航 / Google Maps <a> 連結
        if (typeof rawTarget.closest === 'function') {
            var linkEl = rawTarget.closest(
                'a[href*="/maps/dir"], a[href*="maps.google."], a[href*="maps.app.goo.gl"], ' +
                'a[href*="goo.gl/maps"], a[href^="google.navigation:"], a[href^="geo:"]'
            );
            if (linkEl) {
                return { element: linkEl, href: linkEl.getAttribute('href') || linkEl.href || '' };
            }

            // 若位於氣泡窗 / 詳情卡內的任何 <a> 指向外部 Google Maps
            var anyAnchor = rawTarget.closest('a[href]');
            if (anyAnchor) {
                var anyHref = anyAnchor.getAttribute('href') || anyAnchor.href || '';
                if (isExternalGoogleMapsUrl(anyHref)) {
                    return { element: anyAnchor, href: anyHref };
                }
            }

            // 2. 明確 ID 的氣泡窗導航按鈕
            var directDirBtn = rawTarget.closest('#map-infowindow-directions-button');
            if (directDirBtn) {
                var directHref = directDirBtn.getAttribute('href') || '';
                return { element: directDirBtn, href: directHref };
            }

            // 3. 位於氣泡窗 / 詳情卡內的語意導航按鈕（排除頂部編輯器工具列的新增路線工具）
            var semanticBtn = rawTarget.closest(
                '[aria-label*="導航"], [aria-label*="規劃路線"], [aria-label*="Directions"], ' +
                '[data-tooltip*="導航"], [data-tooltip*="規劃路線"], [data-tooltip*="Directions"], ' +
                '[title*="導航"], [title*="規劃路線"], [title*="Directions"]'
            );
            if (semanticBtn && isInsideInfoOrDetailCard(semanticBtn)) {
                var innerLink = semanticBtn.querySelector ? semanticBtn.querySelector('a[href]') : null;
                var btnHref = semanticBtn.getAttribute('href') || (innerLink ? (innerLink.getAttribute('href') || innerLink.href || '') : '');
                return { element: semanticBtn, href: btnHref };
            }
        }
        return null;
    }

    /**
     * Phase 11：全域 click 監聽（非 Inspect Mode 時）作為氣泡窗「導航 / 規劃路線」按鈕的保底攔截
     */
    function handleDocumentNavigationClick(event) {
        if (helperState.inspectMode) return;
        if (!event || !event.target) return;

        var matched = findNavigationTriggerElement(event.target);
        if (!matched) return;

        var href = matched.href ? String(matched.href).trim() : '';
        if (href && isExternalGoogleMapsUrl(href)) {
            event.preventDefault();
            event.stopPropagation();
            dispatchExternalNavigationToAndroid(href, extractNavigationContext());
            return;
        }

        // 無直接 href（由 Closure / 網頁 JS 處理）：延遲 220ms 確認未發生跳轉或 window.open 時以選取圖釘保底喚起導航
        var clickedAt = Date.now();
        var hrefBefore = (window.location && window.location.href) ? String(window.location.href) : '';
        var snapshotContext = extractNavigationContext();

        setTimeout(function () {
            if (helperState.lastExternalNavTriggerAt >= clickedAt) {
                return;
            }
            var hrefAfter = (window.location && window.location.href) ? String(window.location.href) : '';
            if (hrefAfter && hrefBefore && hrefAfter !== hrefBefore) {
                return;
            }
            var liveContext = extractNavigationContext();
            var hasLivePin = (liveContext.selectedPinLat !== null && liveContext.selectedPinLng !== null) ||
                Boolean(liveContext.selectedPinTitle && liveContext.selectedPinTitle.trim());
            var finalContext = hasLivePin ? liveContext : snapshotContext;
            var hasPinInfo = (finalContext.selectedPinLat !== null && finalContext.selectedPinLng !== null) ||
                Boolean(finalContext.selectedPinTitle && finalContext.selectedPinTitle.trim());

            if (hasPinInfo) {
                dispatchExternalNavigationToAndroid('', finalContext);
            }
        }, 220);
    }

    /**
     * ========================================================================
     * 9.5 Phase 12：偵測目前點選的 POI 氣泡窗狀態並即時回報給 AndroidBridge
     * ========================================================================
     */
    function isInfoWindowInEditMode(container) {
        if (!container) return false;

        var doneBtn = document.getElementById('map-infowindow-done-editing-button');
        if (doneBtn && isElementUsable(doneBtn)) return true;

        var cancelBtn = document.getElementById('map-infowindow-cancel-editing-button');
        if (cancelBtn && isElementUsable(cancelBtn)) return true;

        var saveBtn = findInfoWindowSaveButton();
        if (saveBtn && isElementUsable(saveBtn)) return true;

        try {
            var editables = container.querySelectorAll(
                'input:not([type="hidden"]):not([type="checkbox"]), textarea, [contenteditable="true"]'
            );
            for (var i = 0; i < editables.length; i++) {
                var ed = editables[i];
                if (ed.id === 'mapsprosearch-field') continue;
                if (isNodeCurrentlyEditable(ed)) {
                    return true;
                }
            }
        } catch (_e) {}

        return false;
    }

    function extractPinRatingFromContainer(container) {
        if (!container) return '';
        try {
            var ratingSelectors = [
                '[aria-label*="顆星"]',
                '[aria-label*="stars"]',
                '[aria-label*="star"]',
                '[class*="rating"]'
            ];
            for (var i = 0; i < ratingSelectors.length; i++) {
                var el = container.querySelector(ratingSelectors[i]);
                if (!el || !isElementUsable(el)) continue;
                var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
                var txt = (el.innerText || el.textContent || '') + ' ' + aria;
                var m = txt.match(/([1-4]\.\d|5\.0)/);
                if (m && m[1]) return m[1];
            }
        } catch (_e) {}

        var rawText = (container.innerText || container.textContent || '') + '';
        var starMatch = rawText.match(/([1-4]\.\d|5\.0)\s*(?:★|⭐|顆星|stars?|\(\s*[\d,]+\s*\))/i);
        if (starMatch && starMatch[1]) {
            return starMatch[1];
        }
        var lineMatch = rawText.match(/(?:^|\n)\s*([1-4]\.\d|5\.0)\s*(?:\n|$)/);
        if (lineMatch && lineMatch[1]) {
            return lineMatch[1];
        }
        return '';
    }

    function extractPinCoordinatesFromContainer(container) {
        if (!container) return null;
        var actionUrls = findInfoWindowActionUrls(container);
        var candidateUrls = [];
        if (actionUrls.placeUrl) candidateUrls.push(actionUrls.placeUrl);
        if (actionUrls.directionsUrl) candidateUrls.push(actionUrls.directionsUrl);

        var links = container.querySelectorAll ? container.querySelectorAll('a[href]') : [];
        for (var i = 0; i < links.length; i++) {
            var href = (links[i].getAttribute('href') || '').trim();
            if (href && candidateUrls.indexOf(href) === -1) {
                candidateUrls.push(href);
            }
        }

        var cameraFallback = null;

        // 1. 優先從 placeUrl 與 directionsUrl 透過 extractExactCoordsFromMapsUrl 提取真實 !3d!4d（或明確查詢參數）
        for (var u = 0; u < candidateUrls.length; u++) {
            var rawU = candidateUrls[u];
            var exactCoords = extractExactCoordsFromMapsUrl(rawU);
            if (exactCoords) {
                if (!exactCoords.isCameraCenter) {
                    return { lat: exactCoords.lat, lng: exactCoords.lng };
                } else if (!cameraFallback) {
                    cameraFallback = { lat: exactCoords.lat, lng: exactCoords.lng };
                }
            }
        }

        // 2. 若官方連結僅含 cid=/ftid= 而無 !3d!4d，再檢查 data-lat / data-lng
        var dataLat = container.getAttribute && container.getAttribute('data-lat');
        var dataLng = container.getAttribute && container.getAttribute('data-lng');
        if (dataLat && dataLng) {
            var dataPair = parseLatLngPairFromString(dataLat + ',' + dataLng);
            if (dataPair) return dataPair;
        }

        // 3. 最後才退回 container.innerText 中的座標文字（避免畫面視角 /@lat,lng 蓋過正確座標）
        var infoText = (container.innerText || container.textContent || '');
        var textPair = parseLatLngPairFromString(infoText);
        if (textPair) return textPair;

        // 4. 最後備援：畫面視角中心 /@lat,lng
        if (cameraFallback) {
            return cameraFallback;
        }

        return null;
    }

    function isBoilerplatePinLine(line, cleanTitle, rating) {
        if (!line) return true;
        if (cleanTitle && line === cleanTitle) return true;
        if (rating && (line === rating || line.indexOf(rating + ' ★') === 0 || line.indexOf(rating + ' ⭐') === 0)) {
            return true;
        }
        if (/^-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}$/.test(line)) {
            return true;
        }
        if (/^\(\s*[\d,]+\s*\)$/.test(line) ||
            /^[\d,]+\s*(?:則評論|reviews?)$/i.test(line) ||
            /^\d+\s*(?:\/|of)\s*\d+$/i.test(line) ||
            /^\d+\s*\(\s*共\s*\d+\s*個\s*\)$/.test(line) ||
            /^\d+\s*\(\s*of\s+\d+\s*\)$/i.test(line) ||
            /^共\s*\d+\s*張相片$/.test(line) ||
            /^\d+\s*photos?$/i.test(line)) {
            return true;
        }
        if (/^(移除|Remove|從\s*Google\s*地圖移除|來自\s*Google\s*地圖的詳細資料|Google\s*地圖詳細資料|Details from Google Maps|在「Google 地圖」中檢視|在『Google 地圖』檢視|在「Google 地圖」檢視|在 Google 地圖中檢視|在 Google 地圖中開啟|View in Google Maps|更多詳細資料|More details|顯示詳細資料|隱藏詳細資料|Show details|Hide details|導航|規劃路線|Directions|編輯|Edit|刪除|Delete|關閉|Close|樣式|Style|相片|Photo|新增相片|Add photo|上傳相片|新增至地圖|Add to map|儲存|Save|取消|Cancel|名稱|Name|說明|Description|網站|Website|電話|Phone|地址|Address)$/i.test(line)) {
            return true;
        }
        return false;
    }

    function collectControlButtonTexts(container) {
        var list = [];
        if (!container || !container.querySelectorAll) return list;
        var controls = container.querySelectorAll('button, [role="button"]');
        for (var i = 0; i < controls.length; i++) {
            var ctrl = controls[i];
            if (!ctrl) continue;
            var txt = ((ctrl.innerText || ctrl.textContent || '') + '').replace(/\s+/g, ' ').trim();
            if (txt && txt.length <= 30 && list.indexOf(txt) === -1) {
                list.push(txt);
            }
        }
        return list;
    }

    function normalizePhotoUrl(rawUrl) {
        if (!rawUrl) return '';
        var s = String(rawUrl).trim();
        if (!s || s.indexOf('blob:') === 0) return '';
        if (s.indexOf('//') === 0) {
            return 'https:' + s;
        }
        if (s.indexOf('/') === 0) {
            return 'https://www.google.com' + s;
        }
        return s;
    }

    function isExcludedUiImageUrl(lowerUrl) {
        return (
            lowerUrl.indexOf('cleardot.gif') !== -1 ||
            lowerUrl.indexOf('transparent.png') !== -1 ||
            lowerUrl.indexOf('maps.gstatic.com/mapfiles/') !== -1 ||
            lowerUrl.indexOf('gstatic.com/images/') !== -1 ||
            lowerUrl.indexOf('data:image/gif;base64,r0lgod') === 0 ||
            /\.svg(?:[?#]|$)/i.test(lowerUrl)
        );
    }

    function isLikelyPhotoHostUrl(lowerUrl) {
        return (
            lowerUrl.indexOf('googleusercontent.com') !== -1 ||
            lowerUrl.indexOf('usercontent.google.com') !== -1 ||
            lowerUrl.indexOf('ggpht.com') !== -1 ||
            lowerUrl.indexOf('photoservice') !== -1 ||
            lowerUrl.indexOf('streetviewpixels') !== -1 ||
            lowerUrl.indexOf('drive.google.com') !== -1 ||
            lowerUrl.indexOf('/maps/d/') !== -1 ||
            lowerUrl.indexOf('cbk') !== -1 ||
            lowerUrl.indexOf('panoramio') !== -1
        );
    }

    function extractPinPhotosFromContainer(container) {
        var scopes = [];
        if (container && container.querySelectorAll) scopes.push(container);
        var gmCard = document.querySelector('.gm-style-iw-c');
        if (gmCard && gmCard.querySelectorAll && scopes.indexOf(gmCard) === -1) {
            scopes.push(gmCard);
        }
        if (scopes.length === 0) return [];

        var urls = [];
        var actionBtnSelector =
            '[data-mygmap-role="infowindow-actions"], ' +
            '#map-infowindow-edit-button, #map-infowindow-delete-button, ' +
            '#map-infowindow-style-button, #map-infowindow-photo-button, ' +
            '#map-infowindow-directions-button, #map-infowindow-done-editing-button, ' +
            '#map-infowindow-cancel-editing-button, #map-infowindow-close-button, ' +
            'button.gm-ui-hover-effect';

        for (var s = 0; s < scopes.length; s++) {
            var scope = scopes[s];
            var imgs = scope.querySelectorAll('img');
            for (var i = 0; i < imgs.length; i++) {
                var img = imgs[i];
                if (!img) continue;
                if (img.closest && img.closest(actionBtnSelector)) continue;

                var rawSrc = img.currentSrc ||
                    img.src ||
                    img.getAttribute('data-src') ||
                    img.getAttribute('data-lazy-src') ||
                    img.getAttribute('src') ||
                    '';
                var src = normalizePhotoUrl(rawSrc);
                if (!src) continue;
                var lower = src.toLowerCase();
                if (isExcludedUiImageUrl(lower)) continue;

                var rect = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 0, height: 0 };
                var natW = img.naturalWidth || 0;
                var natH = img.naturalHeight || 0;
                var photoHost = isLikelyPhotoHostUrl(lower);
                var inMediaBox = Boolean(
                    img.closest && img.closest('[class*="photo"], [class*="media"], [class*="carousel"], [id*="photo"], [id*="media"], [id*="image"]')
                );

                if ((natW > 0 && natW <= 28 && natH > 0 && natH <= 28) ||
                    (!photoHost && !inMediaBox && rect.width > 0 && rect.width <= 28 && rect.height > 0 && rect.height <= 28)) {
                    continue;
                }
                if (natW === 0 && rect.width === 0 && !photoHost && !inMediaBox && lower.indexOf('data:image/') !== 0) {
                    continue;
                }
                if (urls.indexOf(src) === -1) {
                    urls.push(src);
                }
                if (urls.length >= 6) return urls;
            }

            var bgCandidates = scope.querySelectorAll(
                '[style*="background-image"], [class*="photo"], [class*="media"], [class*="carousel"], [class*="image"]'
            );
            for (var b = 0; b < bgCandidates.length; b++) {
                var bgEl = bgCandidates[b];
                if (!bgEl || (bgEl.closest && bgEl.closest(actionBtnSelector))) continue;
                var inlineBg = (bgEl.style && bgEl.style.backgroundImage) || '';
                var compBg = '';
                if (!inlineBg || inlineBg === 'none') {
                    try {
                        compBg = window.getComputedStyle(bgEl).backgroundImage || '';
                    } catch (_e) {}
                }
                var bgText = inlineBg || compBg;
                if (!bgText || bgText === 'none') continue;
                var urlMatch = bgText.match(/url\(["']?([^"')]+)["']?\)/i);
                if (!urlMatch || !urlMatch[1]) continue;

                var bgUrl = normalizePhotoUrl(urlMatch[1]);
                if (!bgUrl) continue;
                var bgLower = bgUrl.toLowerCase();
                if (isExcludedUiImageUrl(bgLower) || bgLower.indexOf('sprite') !== -1) continue;

                var bgRect = bgEl.getBoundingClientRect ? bgEl.getBoundingClientRect() : { width: 0, height: 0 };
                if (!isLikelyPhotoHostUrl(bgLower) && bgRect.width < 40 && bgRect.height < 40) continue;

                if (urls.indexOf(bgUrl) === -1) {
                    urls.push(bgUrl);
                }
                if (urls.length >= 6) return urls;
            }
        }
        return urls;
    }

    function hasVisibleAddToMapButton(container) {
        var btn = document.getElementById('addtomap-button');
        if (btn && isElementUsable(btn)) {
            if (!container || !container.contains || container.contains(btn)) {
                return true;
            }
        }
        return false;
    }

    function getEditInfoWindowCard() {
        var iwCard = document.querySelector('.gm-style-iw-c');
        if (iwCard && isElementUsable(iwCard)) return iwCard;
        return findInfoWindowContainer();
    }

    function resetEditInfoWindowPosition() {
        var centered = document.querySelectorAll('[data-mygmap-centered="true"]');
        for (var i = 0; i < centered.length; i++) {
            var el = centered[i];
            el.style.removeProperty('margin-left');
            el.style.removeProperty('margin-top');
            el.removeAttribute('data-mygmap-centered');
        }
    }

    function centerEditInfoWindowInViewport() {
        if (!helperState.mobileMode) {
            resetEditInfoWindowPosition();
            return;
        }
        var card = getEditInfoWindowCard();
        if (!card || !isElementUsable(card)) return;

        var rect = card.getBoundingClientRect ? card.getBoundingClientRect() : null;
        if (!rect || rect.width <= 0 || rect.height <= 0) return;

        var vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 360;
        var vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 640;

        var targetLeft = Math.max(14, (vw - rect.width) / 2);
        var targetTop = Math.max(16, Math.min(vh - rect.height - 24, (vh - rect.height) * 0.25));

        var deltaX = targetLeft - rect.left;
        var deltaY = targetTop - rect.top;

        if (Math.abs(deltaX) <= 2 && Math.abs(deltaY) <= 2) {
            card.setAttribute('data-mygmap-centered', 'true');
            return;
        }

        var prevDx = parseFloat(card.style.marginLeft || '0') || 0;
        var prevDy = parseFloat(card.style.marginTop || '0') || 0;
        var nextDx = Math.round(prevDx + deltaX);
        var nextDy = Math.round(prevDy + deltaY);

        card.setAttribute('data-mygmap-centered', 'true');
        card.style.setProperty('margin-left', nextDx + 'px', 'important');
        card.style.setProperty('margin-top', nextDy + 'px', 'important');
    }

    function applyInfoWindowBodyClasses(state) {
        if (!document.body) return;
        if (!helperState.mobileMode || !state || !state.visible) {
            document.body.classList.remove('mygmap-pin-view-hidden');
            document.body.classList.remove('mygmap-pin-editing');
            resetEditInfoWindowPosition();
            return;
        }

        if (state.isEditMode) {
            document.body.classList.remove('mygmap-pin-view-hidden');
            document.body.classList.add('mygmap-pin-editing');
            centerEditInfoWindowInViewport();
        } else {
            document.body.classList.remove('mygmap-pin-editing');
            resetEditInfoWindowPosition();
            document.body.classList.add('mygmap-pin-view-hidden');
        }
    }

    function extractSelectedPinUiState() {
        var container = findInfoWindowContainer();
        if (!container) {
            return { visible: false };
        }

        // 若為尚未加入地圖的搜尋結果綠釘氣泡窗 (#addtomap-button)，保留原氣泡窗與底部加入地圖列
        if (hasVisibleAddToMapButton(container)) {
            return { visible: false };
        }

        var isEditMode = isInfoWindowInEditMode(container);

        // 1. 標題擷取：優先從屬性節點讀取，其次標題選擇器，再退回第一行非系統文字
        var title = '';
        var titleAttrIds = [
            'map-infowindow-attr-名稱-value',
            'map-infowindow-attr-name-value',
            'map-infowindow-attr-Name-value',
            'map-infowindow-attr-標題-value',
            'map-infowindow-attr-title-value',
            'map-infowindow-attr-Title-value'
        ];
        var usedTitleNode = null;
        for (var t = 0; t < titleAttrIds.length; t++) {
            var tNode = document.getElementById(titleAttrIds[t]);
            if (tNode && isElementUsable(tNode)) {
                var tVal = ('value' in tNode && tNode.value) ? tNode.value : (tNode.textContent || '');
                tVal = String(tVal || '').replace(/\s+/g, ' ').trim();
                if (tVal) {
                    title = tVal;
                    usedTitleNode = tNode;
                    break;
                }
            }
        }
        if (!title) {
            var firstAttr = container.querySelector('[id^="map-infowindow-attr-"][id$="-value"]');
            if (firstAttr && isElementUsable(firstAttr)) {
                var fVal = ('value' in firstAttr && firstAttr.value) ? firstAttr.value : (firstAttr.textContent || '');
                fVal = String(fVal || '').replace(/\s+/g, ' ').trim();
                if (fVal) {
                    title = fVal;
                    usedTitleNode = firstAttr;
                }
            }
        }
        if (!title) {
            title = extractPinTitleFromContainers([container]);
        }
        title = String(title || '').replace(/\s+/g, ' ').trim();

        // 2. 座標與評分
        var coordPair = extractPinCoordinatesFromContainer(container);
        var lat = coordPair ? coordPair.lat : null;
        var lng = coordPair ? coordPair.lng : null;
        var coordinates = (lat !== null && lng !== null)
            ? formatCoordDisplay(lat, lng)
            : '';

        var rating = extractPinRatingFromContainer(container);

        // 3. 詳細資料 / 地址 / 備註整理（排除重複標題、評分數字與純座標字串）
        var detailParts = [];
        function pushDetailPart(rawPart) {
            var cleaned = String(rawPart || '').replace(/\s+/g, ' ').trim();
            if (!cleaned || isBoilerplatePinLine(cleaned, title, rating)) return;
            for (var idx = 0; idx < detailParts.length; idx++) {
                if (detailParts[idx] === cleaned || detailParts[idx].indexOf(cleaned) !== -1) {
                    return;
                }
            }
            detailParts.push(cleaned);
        }

        var attrNodes = container.querySelectorAll('[id^="map-infowindow-attr-"][id$="-value"]');
        for (var a = 0; a < attrNodes.length; a++) {
            var attrNode = attrNodes[a];
            if (!isElementUsable(attrNode) || attrNode === usedTitleNode) continue;
            var attrVal = ('value' in attrNode && attrNode.value) ? attrNode.value : (attrNode.textContent || '');
            pushDetailPart(attrVal);
        }

        var buttonTexts = collectControlButtonTexts(container);
        var rawLines = ((container.innerText || container.textContent || '') + '').split(/\r?\n/);
        for (var l = 0; l < rawLines.length; l++) {
            var line = rawLines[l].replace(/\s+/g, ' ').trim();
            if (!line || buttonTexts.indexOf(line) !== -1) {
                continue;
            }
            // 移除行內夾帶的評分前綴（如 "4.6 ★ "）
            if (rating && line.indexOf(rating) === 0 && line.length <= rating.length + 6) {
                continue;
            }
            pushDetailPart(line);
            if (detailParts.length >= 4) break;
        }

        var details = detailParts.join(' • ');
        if (details.length > 180) {
            details = details.slice(0, 177) + '…';
        }

        var photoUrls = extractPinPhotosFromContainer(container);
        var actionUrls = findInfoWindowActionUrls(container);

        return {
            visible: true,
            title: title,
            details: details,
            rating: rating,
            coordinates: coordinates,
            lat: lat,
            lng: lng,
            isEditMode: Boolean(isEditMode),
            photoUrls: photoUrls,
            placeUrl: actionUrls.placeUrl || '',
            directionsUrl: actionUrls.directionsUrl || ''
        };
    }

    function reportSelectedPinStateIfChanged(forceReport) {
        var state = extractSelectedPinUiState();
        applyInfoWindowBodyClasses(state);
        var jsonStr = JSON.stringify(state);

        if (!state.visible) {
            helperState.userDismissedPinJson = '';
        } else if (!forceReport && helperState.userDismissedPinJson) {
            if (jsonStr === helperState.userDismissedPinJson) {
                return state;
            }
            helperState.userDismissedPinJson = '';
        }

        if (forceReport || jsonStr !== helperState.lastReportedPinStateJson) {
            helperState.lastReportedPinStateJson = jsonStr;
            try {
                if (window.AndroidBridge && typeof window.AndroidBridge.onSelectedPinStateChanged === 'function') {
                    window.AndroidBridge.onSelectedPinStateChanged(jsonStr);
                }
            } catch (err) {
                console.warn('[MyGMap] AndroidBridge.onSelectedPinStateChanged error:', err);
            }
        }
        return state;
    }

    function simulateEmptyMapDismissClick() {
        if (helperState.activeTool === 'addMarker') return false;
        var vw = window.innerWidth || 360;
        var vh = window.innerHeight || 640;
        var probes = [
            [18, Math.max(96, Math.round(vh * 0.22))],
            [18, Math.max(120, vh - 220)],
            [Math.max(40, vw - 22), Math.max(120, Math.round(vh * 0.28))]
        ];
        for (var i = 0; i < probes.length; i++) {
            var x = probes[i][0];
            var y = probes[i][1];
            var el = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
            if (!el || !el.closest) continue;
            if (el.closest('#map-infowindow-container, .gm-style-iw, [role="button"], button, a, input, [data-mygmap-role="layer-panel"]')) {
                continue;
            }
            if (el.closest('.gm-style, #map-canvas, #lyra-canvas, [data-mygmap-role="map-canvas"]')) {
                var types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
                for (var t = 0; t < types.length; t++) {
                    var type = types[t];
                    var isPointer = type.indexOf('pointer') === 0;
                    var isDown = type.indexOf('down') !== -1;
                    var evtInit = {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: x,
                        clientY: y,
                        button: 0,
                        buttons: isDown ? 1 : 0
                    };
                    try {
                        var evt;
                        if (isPointer && typeof window.PointerEvent === 'function') {
                            evtInit.pointerId = 1;
                            evtInit.pointerType = 'touch';
                            evtInit.isPrimary = true;
                            evt = new PointerEvent(type, evtInit);
                        } else {
                            evt = new MouseEvent(type, evtInit);
                        }
                        el.dispatchEvent(evt);
                    } catch (_e) {}
                }
                return true;
            }
        }
        return false;
    }

    function scheduleSelectedPinStateChecks() {
        setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 80);
        setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 200);
        setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 450);
        setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 800);
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

        /** Phase 12：擷取目前選取 POI 氣泡窗顯示狀態與完整資訊 */
        extractSelectedPinUiState: extractSelectedPinUiState,

        /** Phase 13：從 Google Maps 網址中擷取真實圖釘高精準度座標 */
        extractExactCoordsFromMapsUrl: extractExactCoordsFromMapsUrl,

        /** Phase 13：從氣泡窗中擷取官方「在 Google 地圖檢視 (placeUrl)」與「規劃路線 (directionsUrl)」連結 */
        findInfoWindowActionUrls: findInfoWindowActionUrls,

        /** Phase 12：從原生卡片觸發目前氣泡窗進入編輯模式 */
        triggerInfoWindowEdit: function () {
            var editBtn = findInfoWindowEditButton();
            if (!editBtn) {
                return false;
            }
            var ok = simulateClick(editBtn);
            scheduleSelectedPinStateChecks();
            setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 1100);
            return ok;
        },

        /** Phase 12：從原生卡片關閉目前網頁氣泡窗 */
        closeInfoWindow: function () {
            helperState.lastCloseActionAt = Date.now();
            var currentState = extractSelectedPinUiState();
            helperState.userDismissedPinJson = currentState.visible
                ? JSON.stringify(currentState)
                : (helperState.lastReportedPinStateJson || '');

            var closeBtn = findInfoWindowCloseButton();
            if (closeBtn) {
                var ok = simulateClick(closeBtn);
                scheduleSelectedPinStateChecks();
                return ok;
            }
            try {
                var escEvt = new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    keyCode: 27,
                    which: 27,
                    bubbles: true,
                    cancelable: true
                });
                document.dispatchEvent(escEvt);
            } catch (_e) {}

            var dismissedByMapClick = simulateEmptyMapDismissClick();
            scheduleSelectedPinStateChecks();
            return dismissedByMapClick;
        },

        /** 重新掃描並標記所有關鍵 DOM 節點 */
        scanAndTagDom: function () {
            ensureViewportMeta();
            var summary = scanAndTagDom();
            applyBodyClasses();
            reportPageModeIfNeeded(false);
            scheduleMapResizeIfNeeded(false);
            reportSelectedPinStateIfChanged(false);
            return summary;
        },

        /** 偵測是否位於地圖編輯頁 */
        isEditorPage: detectIsEditorPage,

        /** 設定是否啟用手機版優化 CSS (false 即為 CSS Bypass 逃生門，恢復原始桌面排版) */
        setMobileMode: function (enabled) {
            helperState.mobileMode = Boolean(enabled);
            applyBodyClasses();
            reportMobileModeState();
            reportSelectedPinStateIfChanged(false);
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
            scheduleMapResizeIfNeeded(false);
            reportDrawerState();
            reportMobileModeState();
            reportInspectModeState();
            reportActiveToolState();
            reportSelectedPinStateIfChanged(true);
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

        // Phase 11：包裝 window.open 以攔截導航彈窗並轉交 Android 原生開啟
        installWindowOpenInterceptor();

        // Capture 階段攔截點擊，確保在 Closure Library 處理前可攔截並進行 DOM 探測
        document.addEventListener('click', handleDocumentInspectClick, true);

        // Phase 11：Capture 階段偵測氣泡窗 / 詳情卡內的導航連結與按鈕點擊
        document.addEventListener('click', handleDocumentNavigationClick, true);

        // Phase 12：使用 Capture 階段監聽點擊/輕觸（防止 Google Maps stopPropagation 吃掉事件），
        // 輕點地圖時立即重設手動關閉標記，確保按 × 後再點同一個圖釘也能立刻重新開啟說明卡
        var pinTapStart = null;
        var lastDragEndedAt = 0;
        document.addEventListener('touchstart', function (e) {
            if (e && e.touches && e.touches.length === 1) {
                pinTapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            } else {
                pinTapStart = null;
            }
        }, { capture: true, passive: true });
        document.addEventListener('click', function () {
            if (helperState.inspectMode) return;
            var now = Date.now();
            if (now - (helperState.lastCloseActionAt || 0) < 300) return;
            if (now - lastDragEndedAt < 300) return;
            helperState.userDismissedPinJson = '';
            helperState.lastReportedPinStateJson = '';
            scheduleSelectedPinStateChecks();
        }, true);
        document.addEventListener('touchend', function (e) {
            if (helperState.inspectMode) return;
            var now = Date.now();
            if (now - (helperState.lastCloseActionAt || 0) < 300) {
                pinTapStart = null;
                return;
            }
            var isTap = true;
            if (pinTapStart && e && e.changedTouches && e.changedTouches.length === 1) {
                var dx = e.changedTouches[0].clientX - pinTapStart.x;
                var dy = e.changedTouches[0].clientY - pinTapStart.y;
                if (Math.sqrt(dx * dx + dy * dy) > 16) {
                    isTap = false;
                    lastDragEndedAt = now;
                }
            }
            pinTapStart = null;
            if (isTap) {
                helperState.userDismissedPinJson = '';
                helperState.lastReportedPinStateJson = '';
                scheduleSelectedPinStateChecks();
            }
        }, { capture: true, passive: true });
        document.addEventListener('load', function (e) {
            if (e && e.target && e.target.tagName === 'IMG' && isInsideInfoOrDetailCard(e.target)) {
                scheduleSelectedPinStateChecks();
            }
        }, true);

        // 監聽歷史紀錄與網址變化
        window.addEventListener('popstate', function () {
            setTimeout(function () {
                scanAndTagDom();
                applyBodyClasses();
                reportPageModeIfNeeded(false);
                scheduleMapResizeIfNeeded(false);
                reportSelectedPinStateIfChanged(false);
            }, 150);
        });

        window.addEventListener('hashchange', function () {
            setTimeout(function () {
                scanAndTagDom();
                applyBodyClasses();
                reportPageModeIfNeeded(false);
                scheduleMapResizeIfNeeded(false);
                reportSelectedPinStateIfChanged(false);
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
                scheduleMapResizeIfNeeded(false);
                reportSelectedPinStateIfChanged(false);
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
    scheduleMapResizeIfNeeded(false);
    reportSelectedPinStateIfChanged(false);
})();
