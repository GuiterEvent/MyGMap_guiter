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
     * 判斷元素是否在畫面上可見（並排除位於 display:none 祖先容器內的隱藏檢視/編輯範本節點）
     */
    function isElementUsable(el) {
        if (!el || !el.ownerDocument) return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) {
            return false;
        }
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

        // 6. Phase 14：解鎖圖層面板向上私有外殼父層 (layer-panel-shell)
        syncLayerPanelShells();

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
     *    Phase 14：保護 Google Closure 選單/調色盤/對話框與圖層內部點擊不誤關抽屜。
     */
    function ensureDrawerBackdrop() {
        if (!document.body) return null;
        var backdrop = document.getElementById(BACKDROP_ID);
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = BACKDROP_ID;
            backdrop.setAttribute('aria-hidden', 'true');
            backdrop.addEventListener('click', function (e) {
                if (e.target && e.target.closest && e.target.closest(
                    '[role="menu"], .goog-menu, [role="dialog"], [data-mygmap-role="layer-panel"], [data-mygmap-role="layer-panel-shell"], #featurelist-pane'
                )) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (window.MyGMapHelper) {
                    window.MyGMapHelper.setDrawerOpen(false);
                }
            }, false);

            var touchStartX = null;
            backdrop.addEventListener('touchstart', function (e) {
                if (e.target && e.target.closest && e.target.closest(
                    '[role="menu"], .goog-menu, [role="dialog"], [data-mygmap-role="layer-panel"], [data-mygmap-role="layer-panel-shell"], #featurelist-pane'
                )) {
                    touchStartX = null;
                    return;
                }
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
        nativePinEditing: false,
        webPinEditAllowed: false,
        initialized: false
    };
    if (typeof helperState.nativePinEditing !== 'boolean') {
        helperState.nativePinEditing = false;
    }
    if (typeof helperState.webPinEditAllowed !== 'boolean') {
        helperState.webPinEditAllowed = false;
    }

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
     * Phase 14：私有外殼父層解鎖標記 (layer-panel-shell)
     * 從圖層面板 ([data-mygmap-role="layer-panel"] 或 #featurelist-pane) 往上遍歷父層，
     * 僅限不包含地圖畫布或編輯器根節點的私有容器 (!containsMapOrEditorRoot(current))，
     * 標記 data-mygmap-role="layer-panel-shell"，供 CSS 解除 overflow:hidden 與低堆疊鎖定。
     */
    function syncLayerPanelShells() {
        try {
            var existingShells = document.querySelectorAll('[data-mygmap-role="layer-panel-shell"]');
            for (var i = 0; i < existingShells.length; i++) {
                existingShells[i].removeAttribute('data-mygmap-role');
            }

            if (!helperState.mobileMode || !helperState.drawerOpen) {
                return;
            }

            var panel = document.querySelector('[data-mygmap-role="layer-panel"]') ||
                document.getElementById('featurelist-pane');
            if (!panel) return;

            var current = panel.parentElement;
            var depth = 0;
            while (current && current !== document.body && current !== document.documentElement && depth < 6) {
                if (containsMapOrEditorRoot(current)) {
                    break;
                }
                current.setAttribute('data-mygmap-role', 'layer-panel-shell');
                current = current.parentElement;
                depth++;
            }
        } catch (err) {
            console.warn('[MyGMap] syncLayerPanelShells error:', err);
        }
    }

    /**
     * Phase 14：同步背景遮罩 (#mygmap-drawer-backdrop) 的水平位置與範圍
     * 依實際圖層面板寬度動態將 backdrop.style.left 設為抽屜右側邊緣，
     * 確保遮罩物理上只覆蓋右側留白區，絕對不覆蓋左側圖層面板任何一像素！
     */
    function syncDrawerBackdropBounds() {
        try {
            var backdrop = document.getElementById(BACKDROP_ID);
            if (!backdrop) return;

            if (!helperState.mobileMode || !helperState.drawerOpen) {
                backdrop.style.removeProperty('left');
                return;
            }

            var panel = document.querySelector('[data-mygmap-role="layer-panel"]') ||
                document.getElementById('featurelist-pane');
            var drawerWidthPx = 0;
            if (panel && isElementUsable(panel)) {
                var rect = panel.getBoundingClientRect();
                if (rect.width > 0) {
                    drawerWidthPx = Math.round(rect.width);
                }
            }

            if (drawerWidthPx <= 0) {
                var vw = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 0) || 360;
                drawerWidthPx = Math.min(Math.round(vw * 0.85), 340);
            }

            backdrop.style.setProperty('left', drawerWidthPx + 'px', 'important');
        } catch (err) {
            console.warn('[MyGMap] syncDrawerBackdropBounds error:', err);
        }
    }

    /**
     * 套用 body class 狀態 (mygmap-mobile-mode, mygmap-drawer-open / mygmap-drawer-closed, mygmap-inspect-mode)
     */
    function applyBodyClasses() {
        if (!document.body) return;
        ensureDrawerBackdrop();

        if (helperState.mobileMode) {
            document.body.classList.add('mygmap-mobile-mode');
            if (document.documentElement) {
                document.documentElement.classList.add('mygmap-mobile-mode');
            }
        } else {
            document.body.classList.remove('mygmap-mobile-mode');
            if (document.documentElement) {
                document.documentElement.classList.remove('mygmap-mobile-mode');
            }
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

        // Phase 15：原生 EditPinDialog 編輯期間強制掛上 mygmap-native-pin-editing 隱藏網頁氣泡窗
        if (helperState.mobileMode && helperState.nativePinEditing) {
            document.body.classList.add('mygmap-native-pin-editing');
        } else {
            document.body.classList.remove('mygmap-native-pin-editing');
        }

        // Phase 14：同步私有父層容器標記與遮罩邊界
        syncLayerPanelShells();
        syncDrawerBackdropBounds();
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
     * Phase 16：攔截 Google My Maps 自身在背景氣泡窗呼叫的 focus() 與 scrollIntoView()，
     * 強制帶入 { preventScroll: true } 並阻擋 scrollIntoView，防止背景地圖在點擊編輯或關閉時自動亂移動！
     */
    function installInfoWindowFocusScrollGuard() {
        if (window.__myGMapFocusScrollGuardInstalled) return;
        window.__myGMapFocusScrollGuardInstalled = true;

        function shouldGuardNode(node) {
            if (!node || node.nodeType !== 1) return false;
            if (!helperState.mobileMode || helperState.webPinEditAllowed) return false;
            if (helperState.nativePinEditing) return true;
            if (typeof node.closest === 'function') {
                return Boolean(node.closest('#map-infowindow-container, .gm-style-iw, .gm-style-iw-c'));
            }
            return false;
        }

        try {
            if (window.HTMLElement && window.HTMLElement.prototype && typeof window.HTMLElement.prototype.focus === 'function') {
                var origFocus = window.HTMLElement.prototype.focus;
                window.HTMLElement.prototype.focus = function (options) {
                    if (shouldGuardNode(this)) {
                        try {
                            return origFocus.call(this, { preventScroll: true });
                        } catch (_e) {
                            return origFocus.call(this);
                        }
                    }
                    return origFocus.apply(this, arguments);
                };
            }
        } catch (err) {
            console.warn('[MyGMap] focus guard install error:', err);
        }

        try {
            if (window.Element && window.Element.prototype && typeof window.Element.prototype.scrollIntoView === 'function') {
                var origScrollIntoView = window.Element.prototype.scrollIntoView;
                window.Element.prototype.scrollIntoView = function () {
                    if (shouldGuardNode(this)) {
                        return;
                    }
                    return origScrollIntoView.apply(this, arguments);
                };
            }
        } catch (err2) {
            console.warn('[MyGMap] scrollIntoView guard install error:', err2);
        }
    }

    /**
     * Phase 16：安全聚焦元素並禁止瀏覽器捲動祖先容器（防止隱藏輸入框焦點將 overflow:hidden 地圖容器推偏）
     */
    function focusWithoutScroll(el) {
        if (!el || typeof el.focus !== 'function') return;
        try {
            el.focus({ preventScroll: true });
        } catch (_e) {
            try {
                el.focus();
            } catch (_e2) {}
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
            focusWithoutScroll(el);
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
     * Phase 17：解析真正綁定 Google Closure 點擊監聽器的內層按鈕節點
     * Google 我的地圖的 #map-infowindow-done-editing-button / #map-infowindow-cancel-editing-button 等
     * 常為外層 Wrapper <div>，真正綁定點擊事件的 <div role="button"> / <button> / .jfk-button 位於子節點。
     * 因 DOM 事件只會向上冒泡 (child -> parent) 而不會向下傳遞，優先回傳最內層可見的可點擊子節點，
     * 確保內外層監聽器 100% 都能收到點擊事件。
     */
    function resolveClickableButton(rawNode) {
        if (!rawNode || rawNode.nodeType !== 1) return rawNode || null;
        if (typeof rawNode.querySelectorAll !== 'function') return rawNode;

        var prioritySelectors = [
            'button',
            '[role="button"]',
            '.jfk-button',
            '.goog-button',
            '.goog-inline-block'
        ];

        function pickInnermostUsable(nodeList) {
            var usable = [];
            for (var i = 0; i < nodeList.length; i++) {
                var candidate = nodeList[i];
                if (candidate && candidate !== rawNode && isElementUsable(candidate)) {
                    usable.push(candidate);
                }
            }
            if (usable.length === 0) return null;

            // 挑選最內層（不包含其他同級候選子節點）的可點擊按鈕
            for (var a = 0; a < usable.length; a++) {
                var outer = usable[a];
                var containsOther = false;
                for (var b = 0; b < usable.length; b++) {
                    if (a === b) continue;
                    if (typeof outer.contains === 'function' && outer.contains(usable[b])) {
                        containsOther = true;
                        break;
                    }
                }
                if (!containsOther) {
                    return outer;
                }
            }
            return usable[usable.length - 1];
        }

        for (var s = 0; s < prioritySelectors.length; s++) {
            try {
                var matches = rawNode.querySelectorAll(prioritySelectors[s]);
                var picked = pickInnermostUsable(matches);
                if (picked) {
                    return picked;
                }
            } catch (_e) {}
        }

        return rawNode;
    }

    /**
     * Phase 17：穿透外層 Wrapper 點擊氣泡窗控制按鈕
     * 優先對 resolveClickableButton(rawNode) 取得之最內層按鈕派發完整 simulateClick 序列；
     * 絕不呼叫會捲動視埠的無參數 focus()。
     */
    function clickInfoWindowControl(rawNode, options) {
        if (!rawNode) return false;
        var opts = options || {};
        var innerBtn = resolveClickableButton(rawNode);
        var primaryTarget = innerBtn || rawNode;
        var clicked = simulateClick(primaryTarget);

        if (opts.alsoNativeClick) {
            try {
                if (typeof primaryTarget.click === 'function') {
                    primaryTarget.click();
                    clicked = true;
                }
            } catch (_e1) {}
        }

        if (opts.alsoClickWrapper && primaryTarget !== rawNode) {
            clicked = simulateClick(rawNode) || clicked;
            if (opts.alsoNativeClick) {
                try {
                    if (typeof rawNode.click === 'function') {
                        rawNode.click();
                        clicked = true;
                    }
                } catch (_e2) {}
            }
        }

        return clicked;
    }

    /**
     * 設定輸入框文字並派發完整 input / change 事件
     */
    function setInputValueAndNotify(inputEl, text) {
        if (!inputEl) return false;
        try {
            focusWithoutScroll(inputEl);
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
     * Phase 16：統一氣泡窗可輸入欄位選擇器
     * 完整涵蓋：
     * - 沒有顯式 type="text" 屬性的 <input>
     * - <textarea>
     * - 任意 contenteditable（包含 contenteditable="true"、"plaintext-only"、""）與 [role="textbox"]
     */
    var INFOWINDOW_TEXT_INPUT_SELECTOR =
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"])';
    var INFOWINDOW_CONTENTEDITABLE_SELECTOR =
        '[contenteditable]:not([contenteditable="false"]), [role="textbox"]';
    var INFOWINDOW_EDITABLE_SELECTOR =
        INFOWINDOW_TEXT_INPUT_SELECTOR + ', textarea, ' + INFOWINDOW_CONTENTEDITABLE_SELECTOR;

    function isContentEditableNode(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.isContentEditable) return true;
        if (node.hasAttribute && node.hasAttribute('contenteditable')) {
            var ceVal = String(node.getAttribute('contenteditable') || '').toLowerCase();
            if (ceVal !== 'false') return true;
        }
        return false;
    }

    /**
     * 解析實際可輸入文字的 DOM 節點（處理外層 wrapper div 包裹 input / textarea / contenteditable 的情況）
     */
    function resolveEditableNode(node) {
        if (!node) return null;
        var tag = (node.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || isContentEditableNode(node)) {
            return node;
        }
        if (node.querySelector) {
            var inner = node.querySelector(INFOWINDOW_EDITABLE_SELECTOR);
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
            if (tag === 'INPUT') {
                var inputType = String(resolved.getAttribute('type') || resolved.type || 'text').toLowerCase();
                if (
                    inputType === 'hidden' ||
                    inputType === 'checkbox' ||
                    inputType === 'radio' ||
                    inputType === 'button' ||
                    inputType === 'submit' ||
                    inputType === 'file'
                ) {
                    return false;
                }
            }
            return !resolved.disabled && !resolved.readOnly;
        }
        if (isContentEditableNode(resolved)) {
            return true;
        }
        return false;
    }

    function getInfoWindowEditScopes() {
        var scopes = [];
        var candidates = [
            document.getElementById('map-infowindow-container'),
            findInfoWindowContainer(),
            document.querySelector('.gm-style-iw-d'),
            document.querySelector('.gm-style-iw-c'),
            document.querySelector('.gm-style-iw')
        ];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (c && isElementUsable(c) && scopes.indexOf(c) === -1) {
                scopes.push(c);
            }
        }
        return scopes;
    }

    /**
     * 在所有氣泡窗範圍內依 ID 尋找真正可編輯的節點（避免 document.getElementById 撞到重複 ID 的隱藏檢視 div）
     */
    function findEditableByAttrIds(ids, excludeChecker) {
        for (var i = 0; i < ids.length; i++) {
            var targetId = ids[i];
            try {
                var allWithId = document.querySelectorAll('[id="' + targetId.replace(/"/g, '\\"') + '"]');
                for (var j = 0; j < allWithId.length; j++) {
                    var node = allWithId[j];
                    if (excludeChecker && excludeChecker(node)) continue;
                    if (isNodeCurrentlyEditable(node)) {
                        return resolveEditableNode(node);
                    }
                }
            } catch (_e) {
                var byId = document.getElementById(targetId);
                if (byId && (!excludeChecker || !excludeChecker(byId)) && isNodeCurrentlyEditable(byId)) {
                    return resolveEditableNode(byId);
                }
            }
        }
        return null;
    }

    /**
     * 尋找氣泡窗內的「名稱 / 標題」欄位
     * Phase 16：編輯模式下嚴格優先匹配真正可編輯 (isNodeCurrentlyEditable) 之節點，
     * 順序：已知標題 ID -> 第一個可編輯 <input>（含無 type="text" 屬性者）-> 第一個可編輯 map-infowindow-attr-*-value -> 任意可編輯欄位。
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
        var container = findInfoWindowContainer();
        var inEditMode = Boolean(container && isInfoWindowInEditMode(container));
        var scopes = getInfoWindowEditScopes();

        if (inEditMode) {
            // 1. 優先已知標題 ID 內真正可編輯的節點（支援重複 ID 情況）
            var byKnownTitleId = findEditableByAttrIds(titleIds, null);
            if (byKnownTitleId) return byKnownTitleId;

            // 2. 優先取氣泡窗內第一個可編輯的 <input>（完整涵蓋無 type="text" 屬性之 <input>，絕不誤抓空白 <textarea>）
            for (var s1 = 0; s1 < scopes.length; s1++) {
                var textInputs = scopes[s1].querySelectorAll(INFOWINDOW_TEXT_INPUT_SELECTOR);
                for (var t1 = 0; t1 < textInputs.length; t1++) {
                    var inputCandidate = textInputs[t1];
                    if (inputCandidate.id === 'mapsprosearch-field') continue;
                    if (isNodeCurrentlyEditable(inputCandidate)) {
                        return inputCandidate;
                    }
                }
            }

            // 3. 次之取第一個可編輯的 [id^="map-infowindow-attr-"][id$="-value"]
            for (var s2 = 0; s2 < scopes.length; s2++) {
                var editAttrs = scopes[s2].querySelectorAll('[id^="map-infowindow-attr-"][id$="-value"]');
                for (var a1 = 0; a1 < editAttrs.length; a1++) {
                    if (isNodeCurrentlyEditable(editAttrs[a1])) {
                        return resolveEditableNode(editAttrs[a1]);
                    }
                }
            }

            // 4. 備援：氣泡窗內任何可編輯欄位（含 contenteditable="plaintext-only" / "" / "true"）
            for (var s3 = 0; s3 < scopes.length; s3++) {
                var anyEditables = scopes[s3].querySelectorAll(INFOWINDOW_EDITABLE_SELECTOR);
                for (var a2 = 0; a2 < anyEditables.length; a2++) {
                    var cand = anyEditables[a2];
                    if (cand.id === 'mapsprosearch-field') continue;
                    if (isNodeCurrentlyEditable(cand)) {
                        return cand;
                    }
                }
            }
        }

        // 檢視模式或非編輯過渡期備援
        for (var i = 0; i < titleIds.length; i++) {
            var byId = document.getElementById(titleIds[i]);
            if (byId && isElementUsable(byId)) {
                return resolveEditableNode(byId);
            }
        }

        var attrValues = (container || document).querySelectorAll('[id^="map-infowindow-attr-"][id$="-value"]');
        for (var j = 0; j < attrValues.length; j++) {
            if (isElementUsable(attrValues[j])) {
                return resolveEditableNode(attrValues[j]);
            }
        }

        if (container) {
            var inputs = container.querySelectorAll(INFOWINDOW_EDITABLE_SELECTOR);
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
     * Phase 16：編輯模式下嚴格優先匹配真正可編輯 (isNodeCurrentlyEditable) 之節點，
     * 順序：已知說明 ID -> 第一個非 titleNode 的 <textarea> / contenteditable(含 plaintext-only) -> 第二個可編輯欄位。
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
        var resolvedTitle = titleNode ? resolveEditableNode(titleNode) : null;
        function isSameAsTitle(node) {
            if (!node) return false;
            var r = resolveEditableNode(node);
            return node === titleNode || r === titleNode || (resolvedTitle !== null && (node === resolvedTitle || r === resolvedTitle));
        }

        var container = findInfoWindowContainer();
        var inEditMode = Boolean(container && isInfoWindowInEditMode(container));
        var scopes = getInfoWindowEditScopes();

        if (inEditMode) {
            // 1. 優先已知說明 ID 內真正可編輯的節點（支援重複 ID 情況）
            var byKnownDescId = findEditableByAttrIds(descIds, isSameAsTitle);
            if (byKnownDescId) return byKnownDescId;

            // 2. 優先取氣泡窗內第一個非 titleNode 的 <textarea> 或 contenteditable（含 plaintext-only / "" / "true"）
            for (var s1 = 0; s1 < scopes.length; s1++) {
                var multilineEditables = scopes[s1].querySelectorAll('textarea, ' + INFOWINDOW_CONTENTEDITABLE_SELECTOR);
                for (var m1 = 0; m1 < multilineEditables.length; m1++) {
                    var multiCand = multilineEditables[m1];
                    if (multiCand.id === 'mapsprosearch-field') continue;
                    if (!isSameAsTitle(multiCand) && isNodeCurrentlyEditable(multiCand)) {
                        return multiCand;
                    }
                }
            }

            // 3. 次之取第二個可編輯的 [id^="map-infowindow-attr-"][id$="-value"] 或任意第二個可編輯欄位
            for (var s2 = 0; s2 < scopes.length; s2++) {
                var editAttrs = scopes[s2].querySelectorAll('[id^="map-infowindow-attr-"][id$="-value"]');
                for (var a1 = 0; a1 < editAttrs.length; a1++) {
                    if (isNodeCurrentlyEditable(editAttrs[a1]) && !isSameAsTitle(editAttrs[a1])) {
                        return resolveEditableNode(editAttrs[a1]);
                    }
                }
            }

            for (var s3 = 0; s3 < scopes.length; s3++) {
                var allEditables = scopes[s3].querySelectorAll(INFOWINDOW_EDITABLE_SELECTOR);
                for (var a2 = 0; a2 < allEditables.length; a2++) {
                    var cand = allEditables[a2];
                    if (cand.id === 'mapsprosearch-field') continue;
                    if (!isSameAsTitle(cand) && isNodeCurrentlyEditable(cand)) {
                        return cand;
                    }
                }
            }
        }

        // 檢視模式或非編輯過渡期備援
        for (var i = 0; i < descIds.length; i++) {
            var byId = document.getElementById(descIds[i]);
            if (byId && isElementUsable(byId) && !isSameAsTitle(byId)) {
                return resolveEditableNode(byId);
            }
        }

        var attrValues = (container || document).querySelectorAll('[id^="map-infowindow-attr-"][id$="-value"]');
        for (var j = 0; j < attrValues.length; j++) {
            if (isElementUsable(attrValues[j]) && !isSameAsTitle(attrValues[j])) {
                return resolveEditableNode(attrValues[j]);
            }
        }

        if (container) {
            var editables = container.querySelectorAll(INFOWINDOW_EDITABLE_SELECTOR);
            for (var k = 0; k < editables.length; k++) {
                var candidate = editables[k];
                if (candidate.id === 'mapsprosearch-field') continue;
                if (!isSameAsTitle(candidate) && isElementUsable(candidate)) {
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
     * Phase 16：派發完整 Google Closure InputHandler & LabelInput 事件序列
     * 注意：當原生 EditPinDialog 開啟於 WebView 上方時，WebView 未持有 Android 視窗焦點，
     * 呼叫 el.focus() 不會同步觸發 DOM focus 事件，導致空說明欄的 goog.ui.LabelInput 維持 placeholder 狀態而存成空值！
     * 因此寫入前必須先顯式派發 focus/focusin 並移除 label-input-label，再寫入值並派發完整鍵盤/輸入/變更/失焦事件。
     */
    function dispatchEditableFocusEvents(el) {
        try {
            if (typeof window.FocusEvent === 'function') {
                el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
                el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
            } else {
                el.dispatchEvent(new Event('focus', { bubbles: false }));
                el.dispatchEvent(new Event('focusin', { bubbles: true }));
            }
        } catch (_e) {}
        try {
            if (el.classList && el.classList.contains('label-input-label')) {
                el.classList.remove('label-input-label');
            }
        } catch (_e2) {}
    }

    function dispatchEditableInputSequence(el, cleanText) {
        var keyChar = cleanText ? cleanText.slice(-1) : 'Backspace';
        try {
            el.dispatchEvent(new KeyboardEvent('keydown', {
                key: keyChar,
                bubbles: true,
                cancelable: true
            }));
        } catch (_e1) {}

        try {
            el.dispatchEvent(new KeyboardEvent('keypress', {
                key: keyChar,
                bubbles: true,
                cancelable: true
            }));
        } catch (_e1b) {}

        try {
            if (typeof window.InputEvent === 'function') {
                el.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: cleanText ? 'insertText' : 'deleteContentBackward',
                    data: cleanText
                }));
            } else {
                el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
        } catch (_e2) {
            try {
                el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            } catch (_e2b) {}
        }

        try {
            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } catch (_e3) {}

        try {
            el.dispatchEvent(new KeyboardEvent('keyup', {
                key: keyChar,
                bubbles: true,
                cancelable: true
            }));
        } catch (_e4) {}

        try {
            if (typeof window.FocusEvent === 'function') {
                el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
            } else {
                el.dispatchEvent(new Event('focusout', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: false }));
            }
        } catch (_e5) {}
    }

    /**
     * 將文字寫入氣泡窗的 `<input>`、`<textarea>` 或 `contenteditable="true"` 元素，並派發完整 Closure 事件
     * Phase 16：嚴格使用 focus({ preventScroll: true }) 且不對輸入框呼叫 simulateClick(el)，
     * 寫入前先顯式觸發 focus/focusin 清除 goog.ui.LabelInput 狀態，杜絕空說明欄儲存為空字串。
     */
    function setEditableElementValue(rawEl, text) {
        var el = resolveEditableNode(rawEl);
        if (!el) return false;
        var cleanText = (text === null || text === undefined) ? '' : String(text);

        try {
            focusWithoutScroll(el);
            dispatchEditableFocusEvents(el);

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
                if (el.value !== cleanText) {
                    el.value = cleanText;
                }
                dispatchEditableInputSequence(el, cleanText);
                return true;
            }

            // 處理 contenteditable（含 plaintext-only / "" / "true"）或 Closure 屬性值容器
            try {
                if (window.getSelection && document.createRange) {
                    var range = document.createRange();
                    range.selectNodeContents(el);
                    var sel = window.getSelection();
                    if (sel) {
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }
            } catch (_selErr) {}

            try {
                if (typeof window.InputEvent === 'function') {
                    el.dispatchEvent(new InputEvent('beforeinput', {
                        bubbles: true,
                        cancelable: true,
                        inputType: cleanText ? 'insertText' : 'deleteContentBackward',
                        data: cleanText
                    }));
                }
            } catch (_biErr) {}

            var execApplied = false;
            if (typeof document.execCommand === 'function') {
                try {
                    execApplied = Boolean(document.execCommand('insertText', false, cleanText));
                } catch (_execErr) {}
            }
            if (!execApplied || (el.innerText || el.textContent || '').trim() !== cleanText.trim()) {
                if (typeof el.innerText === 'string') {
                    el.innerText = cleanText;
                } else {
                    el.textContent = cleanText;
                }
                if ((el.textContent || '').trim() !== cleanText.trim()) {
                    el.textContent = cleanText;
                }
            }
            dispatchEditableInputSequence(el, cleanText);
            return true;
        } catch (err) {
            console.warn('[MyGMap] setEditableElementValue error:', err);
            try {
                if ('value' in el) {
                    el.value = cleanText;
                } else {
                    el.textContent = cleanText;
                }
                dispatchEditableInputSequence(el, cleanText);
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
                        clickInfoWindowControl(editBtn);
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
                            savedClicked = clickInfoWindowControl(latestSaveBtn);
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
            var editables = container.querySelectorAll(INFOWINDOW_EDITABLE_SELECTOR);
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

    function centerEditInfoWindowInViewport(forceRecenter) {
        if (!helperState.mobileMode || !helperState.webPinEditAllowed || helperState.nativePinEditing) {
            resetEditInfoWindowPosition();
            return;
        }
        var card = getEditInfoWindowCard();
        if (!card || !isElementUsable(card)) return;

        // 避免在 MutationObserver 週期性觸發時反覆累加 margin 造成氣泡窗持續飄移
        if (!forceRecenter && card.getAttribute('data-mygmap-centered') === 'true') {
            return;
        }

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
        var nextDx = Math.max(-vw, Math.min(vw, Math.round(prevDx + deltaX)));
        var nextDy = Math.max(-vh, Math.min(vh, Math.round(prevDy + deltaY)));

        card.setAttribute('data-mygmap-centered', 'true');
        card.style.setProperty('margin-left', nextDx + 'px', 'important');
        card.style.setProperty('margin-top', nextDy + 'px', 'important');
    }

    function applyInfoWindowBodyClasses(state) {
        if (!document.body) return;
        if (!helperState.mobileMode) {
            document.body.classList.remove('mygmap-pin-view-hidden');
            document.body.classList.remove('mygmap-pin-editing');
            document.body.classList.remove('mygmap-native-pin-editing');
            document.body.classList.remove('mygmap-addtomap-visible');
            resetEditInfoWindowPosition();
            return;
        }

        // Phase 15：原生編輯期間一律維持網頁氣泡窗隱藏（opacity: 0 + pointer-events: none）
        if (helperState.nativePinEditing) {
            document.body.classList.add('mygmap-native-pin-editing');
            document.body.classList.remove('mygmap-pin-editing');
            document.body.classList.remove('mygmap-addtomap-visible');
            resetEditInfoWindowPosition();
            document.body.classList.add('mygmap-pin-view-hidden');
            return;
        }

        // Phase 16：搜尋結果綠釘（含可見的 #addtomap-button）加上 mygmap-addtomap-visible 讓其正常顯示
        var activeContainer = findInfoWindowContainer();
        if (activeContainer && hasVisibleAddToMapButton(activeContainer)) {
            helperState.webPinEditAllowed = false;
            document.body.classList.add('mygmap-addtomap-visible');
            document.body.classList.remove('mygmap-pin-view-hidden');
            document.body.classList.remove('mygmap-pin-editing');
            document.body.classList.remove('mygmap-native-pin-editing');
            resetEditInfoWindowPosition();
            return;
        }
        document.body.classList.remove('mygmap-addtomap-visible');

        if (!state || !state.visible) {
            helperState.webPinEditAllowed = false;
            document.body.classList.remove('mygmap-pin-view-hidden');
            document.body.classList.remove('mygmap-pin-editing');
            document.body.classList.remove('mygmap-native-pin-editing');
            resetEditInfoWindowPosition();
            return;
        }

        if (state.isEditMode) {
            // 僅於使用者明確點擊「改用原網頁編輯」逃生門時，才允許顯示原網頁編輯氣泡窗；
            // 其餘時刻（包含取消/儲存過渡期）一律鎖定隱藏，杜絕氣泡窗閃現或飄移
            if (helperState.webPinEditAllowed) {
                document.body.classList.remove('mygmap-native-pin-editing');
                document.body.classList.remove('mygmap-pin-view-hidden');
                document.body.classList.add('mygmap-pin-editing');
                centerEditInfoWindowInViewport(false);
            } else {
                document.body.classList.remove('mygmap-pin-editing');
                resetEditInfoWindowPosition();
                document.body.classList.add('mygmap-native-pin-editing');
                document.body.classList.add('mygmap-pin-view-hidden');
            }
        } else {
            helperState.webPinEditAllowed = false;
            document.body.classList.remove('mygmap-pin-editing');
            document.body.classList.remove('mygmap-native-pin-editing');
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

        // 3. 專用「說明 / 備註」擷取（保留換行，直接顯示於 SelectedPinBottomCard 的獨立說明區）
        var description = '';
        var usedDescNode = null;
        var descAttrIds = [
            'map-infowindow-attr-說明-value',
            'map-infowindow-attr-description-value',
            'map-infowindow-attr-Description-value',
            'map-infowindow-attr-備註-value',
            'map-infowindow-attr-notes-value',
            'map-infowindow-attr-Notes-value'
        ];
        for (var dIdx = 0; dIdx < descAttrIds.length; dIdx++) {
            var dNode = document.getElementById(descAttrIds[dIdx]);
            if (dNode && isElementUsable(dNode) && dNode !== usedTitleNode) {
                var rawDVal = ('value' in dNode && dNode.value)
                    ? dNode.value
                    : (dNode.innerText || dNode.textContent || '');
                var trimmedDVal = String(rawDVal || '').replace(/\r\n/g, '\n').trim();
                if (trimmedDVal && trimmedDVal !== title) {
                    description = trimmedDVal;
                    usedDescNode = dNode;
                    break;
                }
            }
        }

        // 4. 詳細資料 / 地址 / 其他自訂欄位整理（排除重複標題、說明、評分數字與純座標字串）
        var detailParts = [];
        var normalizedDesc = description.replace(/\s+/g, ' ').trim();
        function pushDetailPart(rawPart) {
            var cleaned = String(rawPart || '').replace(/\s+/g, ' ').trim();
            if (!cleaned || isBoilerplatePinLine(cleaned, title, rating)) return;
            if (normalizedDesc && (cleaned === normalizedDesc || normalizedDesc.indexOf(cleaned) !== -1)) {
                return;
            }
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
            if (!isElementUsable(attrNode) || attrNode === usedTitleNode || attrNode === usedDescNode) continue;
            var attrVal = ('value' in attrNode && attrNode.value)
                ? attrNode.value
                : (attrNode.innerText || attrNode.textContent || '');
            var rawAttrStr = String(attrVal || '').replace(/\r\n/g, '\n').trim();
            var cleanedAttr = rawAttrStr.replace(/\s+/g, ' ').trim();
            if (!cleanedAttr || cleanedAttr === title) continue;
            if (!description && !isBoilerplatePinLine(cleanedAttr, title, rating)) {
                description = rawAttrStr;
                usedDescNode = attrNode;
                normalizedDesc = cleanedAttr;
                continue;
            }
            pushDetailPart(cleanedAttr);
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
            description: description,
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
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(function () {
                reportSelectedPinStateIfChanged(false);
            });
        }
        setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 25);
        setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 90);
        setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 220);
        setTimeout(function () { reportSelectedPinStateIfChanged(false); }, 500);
    }

    /**
     * ========================================================================
     * 9.6 Phase 15：原生 Material 3「✏️ 編輯地點」對話框背景讀寫、儲存、取消與刪除 API
     * ========================================================================
     */
    var nativeEditPollTimer = null;

    function clearNativeEditPollTimer() {
        if (nativeEditPollTimer) {
            clearInterval(nativeEditPollTimer);
            nativeEditPollTimer = null;
        }
    }

    function blurActiveWebElement() {
        try {
            if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
        } catch (_e) {}
    }

    /**
     * Phase 16：強制歸零視窗與地圖容器整條祖先鏈的 scrollLeft / scrollTop，
     * 徹底根治背景輸入框焦點觸發 Chromium WebView 捲動 overflow:hidden 地圖容器導致偏移與卡死問題。
     */
    function resetMapViewportScrollLock(shouldBlur) {
        try {
            if (shouldBlur !== false) {
                blurActiveWebElement();
            }
            if (typeof window.scrollTo === 'function') {
                window.scrollTo(0, 0);
            }
            if (document.documentElement) {
                document.documentElement.scrollLeft = 0;
                document.documentElement.scrollTop = 0;
            }
            if (document.body) {
                document.body.scrollLeft = 0;
                document.body.scrollTop = 0;
            }

            var anchors = [
                document.getElementById('map-canvas'),
                document.getElementById('lyra-canvas'),
                document.querySelector('.gm-style'),
                document.querySelector('[data-mygmap-role="map-canvas"]')
            ];
            var visited = [];
            for (var i = 0; i < anchors.length; i++) {
                var node = anchors[i];
                while (node && node.nodeType === 1) {
                    if (visited.indexOf(node) !== -1) break;
                    visited.push(node);
                    if (node.scrollLeft !== 0) {
                        node.scrollLeft = 0;
                    }
                    if (node.scrollTop !== 0) {
                        node.scrollTop = 0;
                    }
                    node = node.parentElement;
                }
            }
        } catch (err) {
            console.warn('[MyGMap] resetMapViewportScrollLock error:', err);
        }
    }

    function scheduleMapViewportScrollUnlock() {
        resetMapViewportScrollLock(true);
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(function () {
                resetMapViewportScrollLock(true);
            });
        }
        setTimeout(function () {
            resetMapViewportScrollLock(true);
        }, 100);
        setTimeout(function () {
            resetMapViewportScrollLock(true);
        }, 350);
    }

    function findInfoWindowCancelButton() {
        var cancelIds = [
            'map-infowindow-cancel-editing-button',
            'map-infowindow-cancel-button',
            'infowindow-cancel-button'
        ];
        for (var i = 0; i < cancelIds.length; i++) {
            var byId = document.getElementById(cancelIds[i]);
            if (byId && isElementUsable(byId)) return byId;
        }

        var scopes = [];
        var container = findInfoWindowContainer();
        if (container) scopes.push(container);
        var gmCard = document.querySelector('.gm-style-iw-c');
        if (gmCard && scopes.indexOf(gmCard) === -1) scopes.push(gmCard);
        scopes.push(document);

        var selectors = [
            '[id*="infowindow"][id*="cancel"]',
            '[role="button"][aria-label*="取消"]',
            '[role="button"][aria-label*="Cancel"]',
            '[data-tooltip*="取消"]',
            '[data-tooltip*="Cancel"]',
            '[title*="取消"]',
            '[title*="Cancel"]'
        ];
        for (var s = 0; s < scopes.length; s++) {
            var scope = scopes[s];
            for (var j = 0; j < selectors.length; j++) {
                try {
                    var matched = scope.querySelector(selectors[j]);
                    if (matched && isElementUsable(matched)) return matched;
                } catch (_e) {}
            }

            var buttons = scope.querySelectorAll('button, [role="button"], div.goog-inline-block, div.jfk-button');
            for (var k = 0; k < buttons.length; k++) {
                var btn = buttons[k];
                if (!isElementUsable(btn)) continue;
                var txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
                if (txt === '取消' || txt === 'Cancel') {
                    return btn;
                }
            }
        }
        return null;
    }

    function findInfoWindowDeleteButton() {
        var deleteIds = [
            'map-infowindow-delete-button',
            'infowindow-delete-button'
        ];
        for (var i = 0; i < deleteIds.length; i++) {
            var byId = document.getElementById(deleteIds[i]);
            if (byId && isElementUsable(byId)) return byId;
        }

        var scope = findInfoWindowContainer() || document;
        var selectors = [
            '[id*="infowindow"][id*="delete"]',
            '[role="button"][aria-label*="刪除"]',
            '[role="button"][aria-label*="Delete"]',
            '[data-tooltip*="刪除"]',
            '[data-tooltip*="Delete"]',
            '[title*="刪除"]',
            '[title*="Delete"]'
        ];
        for (var j = 0; j < selectors.length; j++) {
            try {
                var matched = scope.querySelector(selectors[j]);
                if (matched && isElementUsable(matched)) return matched;
            } catch (_e) {}
        }
        return null;
    }

    function readEditableFieldValue(node) {
        var el = resolveEditableNode(node);
        if (!el) return '';
        var tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            return String(el.value || '');
        }
        if (typeof el.innerText === 'string') {
            return el.innerText;
        }
        return String(el.textContent || '');
    }

    function extractAttrFieldLabel(rawNode, resolvedNode, fallbackIndex) {
        var rawId = (rawNode && rawNode.id) ? String(rawNode.id) : '';
        var idMatch = rawId.match(/^map-infowindow-attr-(.+)-value$/i);
        if (idMatch && idMatch[1]) {
            var attrKey = idMatch[1];
            var nameEl = document.getElementById('map-infowindow-attr-' + attrKey + '-name');
            if (nameEl) {
                var nameText = ((nameEl.innerText || nameEl.textContent || '') + '').replace(/\s+/g, ' ').trim();
                if (nameText) return nameText;
            }
            if (attrKey) return attrKey;
        }
        var target = resolvedNode || rawNode;
        if (target && target.getAttribute) {
            var lbl = target.getAttribute('aria-label') || target.getAttribute('placeholder') || target.getAttribute('title') || '';
            lbl = String(lbl).replace(/\s+/g, ' ').trim();
            if (lbl) return lbl;
        }
        return '欄位 ' + (fallbackIndex + 1);
    }

    function collectNativePinEditFormData() {
        var container = findInfoWindowContainer();
        var scope = container || document;
        var titleField = findInfoWindowTitleField();
        var descField = findInfoWindowDescField(titleField);

        var titleVal = titleField ? readEditableFieldValue(titleField) : '';
        var descVal = descField ? readEditableFieldValue(descField) : '';

        var extraFields = [];
        try {
            var resolvedTitleField = titleField ? resolveEditableNode(titleField) : null;
            var resolvedDescField = descField ? resolveEditableNode(descField) : null;
            var inEditMode = Boolean(container && isInfoWindowInEditMode(container));
            var attrNodes = scope.querySelectorAll('[id^="map-infowindow-attr-"][id$="-value"]');
            for (var i = 0; i < attrNodes.length; i++) {
                var attrNode = attrNodes[i];
                if (!isElementUsable(attrNode)) continue;
                if (inEditMode && !isNodeCurrentlyEditable(attrNode)) continue;
                var resolved = resolveEditableNode(attrNode);
                if (
                    !resolved ||
                    resolved === titleField ||
                    resolved === descField ||
                    (resolvedTitleField && resolved === resolvedTitleField) ||
                    (resolvedDescField && resolved === resolvedDescField)
                ) {
                    continue;
                }

                var fVal = readEditableFieldValue(resolved);
                var fTag = (resolved.tagName || '').toUpperCase();
                var isMultiline = (fTag === 'TEXTAREA') ||
                    Boolean(resolved.isContentEditable) ||
                    (fVal.indexOf('\n') !== -1) ||
                    (fVal.length > 60);

                extraFields.push({
                    id: attrNode.id || resolved.id || ('extra-' + extraFields.length),
                    label: extractAttrFieldLabel(attrNode, resolved, extraFields.length),
                    value: fVal,
                    multiline: isMultiline
                });
            }
        } catch (_e) {}

        var canDelete = Boolean(findInfoWindowDeleteButton());
        var photoBtn = document.getElementById('map-infowindow-photo-button');
        var styleBtn = document.getElementById('map-infowindow-style-button');
        var canEditPhoto = Boolean(photoBtn && isElementUsable(photoBtn));
        var canEditStyle = Boolean(styleBtn && isElementUsable(styleBtn));

        var hasEditable = Boolean(
            (titleField && isNodeCurrentlyEditable(titleField)) ||
            (descField && isNodeCurrentlyEditable(descField)) ||
            findInfoWindowSaveButton()
        );

        return {
            hasEditable: hasEditable,
            title: titleVal,
            description: descVal,
            extraFields: extraFields,
            canDelete: canDelete,
            canEditPhoto: canEditPhoto,
            canEditStyle: canEditStyle
        };
    }

    function reportPinEditFormReady(payload) {
        var safePayload = {
            ok: Boolean(payload && payload.ok),
            title: String((payload && payload.title) || ''),
            description: String((payload && payload.description) || ''),
            extraFields: Array.isArray(payload && payload.extraFields) ? payload.extraFields : [],
            canDelete: Boolean(payload && payload.canDelete),
            canEditPhoto: Boolean(payload && payload.canEditPhoto),
            canEditStyle: Boolean(payload && payload.canEditStyle),
            errorMessage: String((payload && payload.errorMessage) || '')
        };
        var jsonStr = JSON.stringify(safePayload);
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onPinEditFormReady === 'function') {
                window.AndroidBridge.onPinEditFormReady(jsonStr);
            }
        } catch (err) {
            console.warn('[MyGMap] AndroidBridge.onPinEditFormReady error:', err);
        }
    }

    function reportPinEditResult(payload) {
        var safePayload = {
            ok: Boolean(payload && payload.ok),
            action: String((payload && payload.action) || 'save'),
            message: String((payload && payload.message) || '')
        };
        var jsonStr = JSON.stringify(safePayload);
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.onPinEditResult === 'function') {
                window.AndroidBridge.onPinEditResult(jsonStr);
            }
        } catch (err) {
            console.warn('[MyGMap] AndroidBridge.onPinEditResult error:', err);
        }
    }

    /**
     * Phase 16 重大架構升級（零漂移延遲開啟編輯）：
     * 點選「✏️ 編輯」開啟原生 EditPinDialog 時，直接從檢視模式 DOM 讀取標題、說明、自訂欄位與權限，
     * 不再提前點擊網頁 #map-infowindow-edit-button（徹底杜絕一點選編輯就把背景地圖往左推！），
     * 僅於使用者實際按下「💾 儲存」時才於背景進入編輯、回寫並儲存。
     */
    function openNativePinEdit() {
        clearNativeEditPollTimer();
        var container = findInfoWindowContainer();
        var preViewState = extractSelectedPinUiState();

        if (!container || !preViewState || !preViewState.visible) {
            reportPinEditFormReady({
                ok: false,
                title: '',
                description: '',
                extraFields: [],
                canDelete: false,
                canEditPhoto: false,
                canEditStyle: false,
                errorMessage: '⚠️ 目前未選取可編輯的地點，請先點擊地圖上的圖釘'
            });
            return true;
        }

        var alreadyEditing = isInfoWindowInEditMode(container);
        var editBtn = alreadyEditing ? null : findInfoWindowEditButton();
        if (!alreadyEditing && !editBtn) {
            reportPinEditFormReady({
                ok: false,
                title: '',
                description: '',
                extraFields: [],
                canDelete: false,
                canEditPhoto: false,
                canEditStyle: false,
                errorMessage: '⚠️ 此地圖或地點目前無法編輯（可能為唯讀檢視模式）'
            });
            return true;
        }

        helperState.webPinEditAllowed = false;
        helperState.nativePinEditing = true;
        applyBodyClasses();

        var preViewCanDelete = Boolean(findInfoWindowDeleteButton());
        var prePhotoBtn = document.getElementById('map-infowindow-photo-button');
        var preStyleBtn = document.getElementById('map-infowindow-style-button');
        var preViewCanEditPhoto = Boolean(prePhotoBtn && isElementUsable(prePhotoBtn));
        var preViewCanEditStyle = Boolean(preStyleBtn && isElementUsable(preStyleBtn));

        var formData = collectNativePinEditFormData();
        var preViewTitle = String(preViewState.title || '').trim();
        var preViewDescription = String(preViewState.description || '').trim();
        var resolvedTitle = String(formData.title || '').trim() ? formData.title : preViewTitle;
        var resolvedDesc = String(formData.description || '').trim() ? formData.description : preViewDescription;

        reportPinEditFormReady({
            ok: true,
            title: resolvedTitle,
            description: resolvedDesc,
            extraFields: formData.extraFields || [],
            canDelete: formData.canDelete || preViewCanDelete,
            canEditPhoto: formData.canEditPhoto || preViewCanEditPhoto,
            canEditStyle: formData.canEditStyle || preViewCanEditStyle,
            errorMessage: ''
        });
        return true;
    }

    /**
     * Phase 15 / Phase 16：將原生 EditPinDialog 的修改內容寫回背景氣泡窗並自動觸發儲存。
     * Phase 16 強化：支援延遲進入背景編輯模式、等待可編輯欄位真正掛載完成再寫入，
     * 若有填寫說明卻未找到背景說明欄時明確回報錯誤而非假性成功。
     */
    function saveNativePinEdit(payloadJson) {
        clearNativeEditPollTimer();
        helperState.webPinEditAllowed = false;
        helperState.nativePinEditing = true;
        applyBodyClasses();
        resetMapViewportScrollLock(false);

        var data = null;
        try {
            data = (typeof payloadJson === 'string') ? JSON.parse(payloadJson) : payloadJson;
        } catch (err) {
            helperState.nativePinEditing = false;
            applyBodyClasses();
            scheduleMapViewportScrollUnlock();
            reportPinEditResult({
                ok: false,
                action: 'save',
                message: '⚠️ 儲存資料格式異常，請重試'
            });
            return false;
        }

        var nextTitle = (data && data.title !== undefined && data.title !== null) ? String(data.title) : '';
        var nextDesc = (data && data.description !== undefined && data.description !== null) ? String(data.description) : '';
        var nextExtras = (data && Array.isArray(data.extraFields)) ? data.extraFields : [];

        function performWriteAndSave() {
            var titleField = findInfoWindowTitleField();
            var descField = findInfoWindowDescField(titleField);

            if (!titleField && !descField) {
                helperState.nativePinEditing = false;
                applyBodyClasses();
                scheduleMapViewportScrollUnlock();
                reportPinEditResult({
                    ok: false,
                    action: 'save',
                    message: '⚠️ 找不到背景編輯欄位，請點選「改用原網頁編輯」'
                });
                return;
            }

            if (nextDesc.trim() && !descField) {
                helperState.nativePinEditing = false;
                applyBodyClasses();
                scheduleMapViewportScrollUnlock();
                reportPinEditResult({
                    ok: false,
                    action: 'save',
                    message: '⚠️ 找不到背景「說明」輸入欄位，請點選「改用原網頁編輯」輸入說明'
                });
                return;
            }

            var wroteAny = false;
            if (titleField) {
                wroteAny = setEditableElementValue(titleField, nextTitle) || wroteAny;
                resetMapViewportScrollLock(false);
            }
            if (descField) {
                wroteAny = setEditableElementValue(descField, nextDesc) || wroteAny;
                // Phase 17：寫入後即時驗證，若因 Google Closure LabelInput 狀態未寫入，立即補做直接寫入並重派完整事件
                var verifiedDesc = readEditableFieldValue(descField);
                if (verifiedDesc !== nextDesc) {
                    var resolvedDesc = resolveEditableNode(descField) || descField;
                    try {
                        focusWithoutScroll(resolvedDesc);
                        dispatchEditableFocusEvents(resolvedDesc);
                        var dTag = (resolvedDesc.tagName || '').toUpperCase();
                        if (dTag === 'INPUT' || dTag === 'TEXTAREA') {
                            resolvedDesc.value = nextDesc;
                        } else {
                            if (typeof resolvedDesc.innerText === 'string') {
                                resolvedDesc.innerText = nextDesc;
                            }
                            resolvedDesc.textContent = nextDesc;
                        }
                        dispatchEditableInputSequence(resolvedDesc, nextDesc);
                        wroteAny = true;
                    } catch (_descRetryErr) {}
                }
                resetMapViewportScrollLock(false);
            }
            for (var i = 0; i < nextExtras.length; i++) {
                var item = nextExtras[i];
                if (!item || !item.id) continue;
                var extraNode = findEditableByAttrIds([item.id], null) || document.getElementById(item.id);
                if (extraNode) {
                    setEditableElementValue(extraNode, item.value !== undefined && item.value !== null ? String(item.value) : '');
                    resetMapViewportScrollLock(false);
                    wroteAny = true;
                }
            }

            // Phase 17：延遲 260ms 確保 Google Closure InputHandler 已同步所有欄位變更，再穿透 Wrapper 點擊真正內層儲存按鈕
            setTimeout(function () {
                var saveBtn = findInfoWindowSaveButton();
                if (saveBtn) {
                    clickInfoWindowControl(saveBtn);
                } else if (titleField && (titleField.tagName || '').toUpperCase() === 'INPUT') {
                    dispatchEnterKey(titleField);
                }
                resetMapViewportScrollLock(true);

                helperState.webPinEditAllowed = false;
                helperState.userDismissedPinJson = '';
                helperState.lastReportedPinStateJson = '';

                function finishSaveSuccess() {
                    clearNativeEditPollTimer();
                    helperState.nativePinEditing = false;
                    helperState.webPinEditAllowed = false;
                    if (document.body) {
                        document.body.classList.remove('mygmap-native-pin-editing');
                        document.body.classList.remove('mygmap-pin-editing');
                    }
                    applyBodyClasses();
                    blurActiveWebElement();
                    resetMapViewportScrollLock(true);
                    scheduleMapViewportScrollUnlock();
                    reportSelectedPinStateIfChanged(true);
                    setTimeout(function () {
                        resetMapViewportScrollLock(true);
                        reportSelectedPinStateIfChanged(true);
                    }, 220);
                    setTimeout(function () {
                        resetMapViewportScrollLock(true);
                        reportSelectedPinStateIfChanged(true);
                    }, 520);

                    reportPinEditResult({
                        ok: true,
                        action: 'save',
                        message: '✅ 已儲存地點變更'
                    });
                }

                // 若第一次點擊已同步退出編輯模式，直接完成成功流程
                var immediateContainer = findInfoWindowContainer();
                if (!immediateContainer || !isInfoWindowInEditMode(immediateContainer)) {
                    finishSaveSuccess();
                    return;
                }

                // Phase 17：多階段可靠儲存點擊與嚴格結果回報（最長 2000ms，每 90ms 檢查，嚴禁逾時假性成功）
                var saveWaitStart = Date.now();
                var stage1Retried = false;
                var stage2Retried = false;
                nativeEditPollTimer = setInterval(function () {
                    resetMapViewportScrollLock(true);
                    var liveContainer = findInfoWindowContainer();
                    var stillEditing = Boolean(liveContainer && isInfoWindowInEditMode(liveContainer));
                    var elapsed = Date.now() - saveWaitStart;

                    if (!stillEditing) {
                        finishSaveSuccess();
                        return;
                    }

                    // 階段 1 (300ms)：對內層按鈕與外層 Wrapper 依序嘗試 .click() + simulateClick()
                    if (!stage1Retried && elapsed >= 300) {
                        stage1Retried = true;
                        var retrySaveBtn = findInfoWindowSaveButton() || saveBtn;
                        if (retrySaveBtn) {
                            clickInfoWindowControl(retrySaveBtn, {
                                alsoNativeClick: true,
                                alsoClickWrapper: true
                            });
                            resetMapViewportScrollLock(true);
                        }
                        return;
                    }

                    // 階段 2 (750ms)：遍歷 saveBtn 內所有 [role="button"], button, .jfk-button 子元素與文字為「儲存 / Save」之節點逐一觸發
                    if (!stage2Retried && elapsed >= 750) {
                        stage2Retried = true;
                        var deepSaveBtn = findInfoWindowSaveButton() || saveBtn;
                        var clickedNodes = [];
                        function triggerOnce(node) {
                            if (!node || clickedNodes.indexOf(node) !== -1) return;
                            clickedNodes.push(node);
                            simulateClick(node);
                            try {
                                if (typeof node.click === 'function') {
                                    node.click();
                                }
                            } catch (_e) {}
                        }
                        if (deepSaveBtn && typeof deepSaveBtn.querySelectorAll === 'function') {
                            var subBtns = deepSaveBtn.querySelectorAll('[role="button"], button, .jfk-button');
                            for (var sb = 0; sb < subBtns.length; sb++) {
                                if (isElementUsable(subBtns[sb])) {
                                    triggerOnce(subBtns[sb]);
                                }
                            }
                            var allDescendants = deepSaveBtn.querySelectorAll('*');
                            for (var ad = 0; ad < allDescendants.length; ad++) {
                                var descEl = allDescendants[ad];
                                if (!isElementUsable(descEl)) continue;
                                var dTxt = (descEl.textContent || '').replace(/\s+/g, ' ').trim();
                                if (dTxt === '儲存' || dTxt === 'Save' || dTxt === '完成' || dTxt === 'Done') {
                                    triggerOnce(descEl);
                                }
                            }
                            triggerOnce(deepSaveBtn);
                        } else if (deepSaveBtn) {
                            triggerOnce(deepSaveBtn);
                        }
                        resetMapViewportScrollLock(true);
                        return;
                    }

                    // 超過 2000ms 仍為 stillEditing === true：嚴禁假報 ok: true，先嘗試取消退出編輯模式避免地圖被鎖死回彈
                    if (elapsed >= 2000) {
                        clearNativeEditPollTimer();
                        cancelNativePinEdit();
                        helperState.nativePinEditing = false;
                        helperState.webPinEditAllowed = false;
                        if (document.body) {
                            document.body.classList.remove('mygmap-native-pin-editing');
                            document.body.classList.remove('mygmap-pin-editing');
                        }
                        applyBodyClasses();
                        blurActiveWebElement();
                        resetMapViewportScrollLock(true);
                        reportPinEditResult({
                            ok: false,
                            action: 'save',
                            message: '⚠️ 背景儲存未生效，已還原狀態，請點「改用原網頁編輯」試試'
                        });
                    }
                }, 90);
            }, 260);
        }

        function hasReadyEditableFields() {
            var liveContainer = findInfoWindowContainer();
            if (!liveContainer || !isInfoWindowInEditMode(liveContainer)) return false;
            var tf = findInfoWindowTitleField();
            var df = findInfoWindowDescField(tf);
            var titleReady = Boolean(tf && isNodeCurrentlyEditable(tf));
            var descReady = Boolean(df && isNodeCurrentlyEditable(df));
            // Phase 17：當 nextDesc 非空時，必須等到 descField 也真正可編輯才進入寫入，不可因 titleField 先就緒就提早寫入
            if (nextDesc.trim().length > 0) {
                return descReady;
            }
            return titleReady || descReady;
        }

        if (hasReadyEditableFields()) {
            performWriteAndSave();
            return true;
        }

        // 延遲進入背景編輯模式：點擊編輯按鈕並輪詢直到可編輯欄位真正掛載完成
        var editBtn = findInfoWindowEditButton();
        if (editBtn) {
            clickInfoWindowControl(editBtn);
            resetMapViewportScrollLock(true);
        }
        var waitStart = Date.now();
        nativeEditPollTimer = setInterval(function () {
            resetMapViewportScrollLock(true);
            if (hasReadyEditableFields() || Date.now() - waitStart >= 1200) {
                clearNativeEditPollTimer();
                performWriteAndSave();
            }
        }, 60);
        return true;
    }

    /**
     * Phase 15 / Phase 16：取消原生編輯；若網頁本來就還在檢視模式（未點過編輯鈕），直接解除鎖定、零地圖移動。
     */
    function cancelNativePinEdit() {
        clearNativeEditPollTimer();
        helperState.webPinEditAllowed = false;

        var container = findInfoWindowContainer();
        if (!container || !isInfoWindowInEditMode(container)) {
            helperState.nativePinEditing = false;
            applyBodyClasses();
            resetMapViewportScrollLock(true);
            return true;
        }

        helperState.nativePinEditing = true;
        applyBodyClasses();
        resetMapViewportScrollLock(true);

        function triggerCancelAttempt(useFallbackEscape) {
            var cancelBtn = findInfoWindowCancelButton();
            if (cancelBtn) {
                clickInfoWindowControl(cancelBtn, {
                    alsoNativeClick: Boolean(useFallbackEscape),
                    alsoClickWrapper: Boolean(useFallbackEscape)
                });
            }
            if (useFallbackEscape) {
                try {
                    var escTarget = findInfoWindowTitleField() || findInfoWindowContainer() || document;
                    escTarget.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Escape',
                        code: 'Escape',
                        keyCode: 27,
                        which: 27,
                        bubbles: true,
                        cancelable: true
                    }));
                } catch (_e2) {}
            }
            resetMapViewportScrollLock(true);
        }

        triggerCancelAttempt(false);

        var immediateContainer = findInfoWindowContainer();
        if (!immediateContainer || !isInfoWindowInEditMode(immediateContainer)) {
            helperState.nativePinEditing = false;
            helperState.userDismissedPinJson = '';
            helperState.lastReportedPinStateJson = '';
            if (document.body) {
                document.body.classList.remove('mygmap-native-pin-editing');
                document.body.classList.remove('mygmap-pin-editing');
            }
            applyBodyClasses();
            scheduleMapViewportScrollUnlock();
            reportSelectedPinStateIfChanged(true);
            setTimeout(function () { reportSelectedPinStateIfChanged(true); }, 200);
            return true;
        }

        var startedAt = Date.now();
        var retried = false;
        nativeEditPollTimer = setInterval(function () {
            resetMapViewportScrollLock(true);
            var liveContainer = findInfoWindowContainer();
            var stillEditing = Boolean(liveContainer && isInfoWindowInEditMode(liveContainer));
            var elapsed = Date.now() - startedAt;

            if (!stillEditing) {
                clearNativeEditPollTimer();
                helperState.nativePinEditing = false;
                helperState.userDismissedPinJson = '';
                helperState.lastReportedPinStateJson = '';
                applyBodyClasses();
                scheduleMapViewportScrollUnlock();
                reportSelectedPinStateIfChanged(true);
                setTimeout(function () { reportSelectedPinStateIfChanged(true); }, 200);
                return;
            }

            if (!retried && elapsed >= 180) {
                retried = true;
                triggerCancelAttempt(true);
                return;
            }

            if (elapsed >= 900) {
                clearNativeEditPollTimer();
                helperState.nativePinEditing = false;
                helperState.userDismissedPinJson = '';
                helperState.lastReportedPinStateJson = '';
                applyBodyClasses();
                scheduleMapViewportScrollUnlock();
                reportSelectedPinStateIfChanged(true);
            }
        }, 90);

        return true;
    }

    /**
     * Phase 15 / Phase 16：刪除目前選取的圖釘（若背景處於編輯模式先取消返回檢視再點擊刪除按鈕，並自動處理確認對話框）
     */
    function deleteSelectedPin() {
        clearNativeEditPollTimer();
        helperState.webPinEditAllowed = false;
        helperState.nativePinEditing = false;
        resetMapViewportScrollLock(true);

        function clickConfirmDialogIfPresent() {
            try {
                var dialogs = document.querySelectorAll('[role="dialog"], .modal-dialog');
                for (var d = 0; d < dialogs.length; d++) {
                    var dlg = dialogs[d];
                    if (!isElementUsable(dlg)) continue;
                    var btns = dlg.querySelectorAll('button, [role="button"], .jfk-button');
                    for (var b = 0; b < btns.length; b++) {
                        var btn = btns[b];
                        if (!isElementUsable(btn)) continue;
                        var txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
                        if (/^(刪除|Delete|確定|確認|OK)$/i.test(txt)) {
                            simulateClick(btn);
                            return true;
                        }
                    }
                }
            } catch (_e) {}
            return false;
        }

        function triggerDeleteButton(delBtn) {
            var ok = clickInfoWindowControl(delBtn);
            scheduleMapViewportScrollUnlock();
            setTimeout(function () {
                clickConfirmDialogIfPresent();
                applyBodyClasses();
                resetMapViewportScrollLock(true);
                helperState.userDismissedPinJson = '';
                helperState.lastReportedPinStateJson = '';
                reportSelectedPinStateIfChanged(true);
            }, 180);
            setTimeout(function () {
                resetMapViewportScrollLock(true);
                reportSelectedPinStateIfChanged(true);
            }, 480);
            setTimeout(function () { reportSelectedPinStateIfChanged(true); }, 880);

            reportPinEditResult({
                ok: ok,
                action: 'delete',
                message: ok ? '🗑️ 已刪除地點' : '⚠️ 無法觸發刪除按鈕'
            });
            return ok;
        }

        var directDeleteBtn = findInfoWindowDeleteButton();
        if (directDeleteBtn) {
            return triggerDeleteButton(directDeleteBtn);
        }

        // 若目前在編輯模式導致刪除按鈕暫時隱藏，先退出編輯再尋找刪除按鈕
        var cancelBtn = findInfoWindowCancelButton();
        if (cancelBtn) {
            clickInfoWindowControl(cancelBtn);
            resetMapViewportScrollLock(true);
            setTimeout(function () {
                var retryDeleteBtn = findInfoWindowDeleteButton();
                if (retryDeleteBtn) {
                    triggerDeleteButton(retryDeleteBtn);
                } else {
                    applyBodyClasses();
                    scheduleMapViewportScrollUnlock();
                    reportPinEditResult({
                        ok: false,
                        action: 'delete',
                        message: '⚠️ 找不到刪除按鈕，請改用原網頁編輯刪除'
                    });
                }
            }, 220);
            return true;
        }

        applyBodyClasses();
        scheduleMapViewportScrollUnlock();
        reportPinEditResult({
            ok: false,
            action: 'delete',
            message: '⚠️ 找不到刪除按鈕，請改用原網頁編輯刪除'
        });
        return false;
    }

    /**
     * Phase 15 逃生門：關閉原生編輯模式並切回原網頁氣泡窗編輯介面（供上傳相片/修改圖釘樣式使用）
     */
    function fallbackToWebPinEdit() {
        clearNativeEditPollTimer();
        helperState.webPinEditAllowed = true;
        helperState.nativePinEditing = false;

        if (document.body) {
            document.body.classList.remove('mygmap-native-pin-editing');
        }

        var container = findInfoWindowContainer();
        if (container && !isInfoWindowInEditMode(container)) {
            var editBtn = findInfoWindowEditButton();
            if (editBtn) {
                clickInfoWindowControl(editBtn);
            }
        }

        applyBodyClasses();
        applyInfoWindowBodyClasses({ visible: true, isEditMode: true });
        setTimeout(function () {
            centerEditInfoWindowInViewport(true);
            reportSelectedPinStateIfChanged(true);
        }, 160);
        return true;
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
            var ok = clickInfoWindowControl(editBtn);
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
            syncLayerPanelShells();
            applyBodyClasses();
            syncDrawerBackdropBounds();
            reportDrawerState();
            if (helperState.drawerOpen) {
                try {
                    window.dispatchEvent(new Event('resize'));
                } catch (_e) {}
            }
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
        },

        /** Phase 14：同步背景遮罩位置 */
        syncDrawerBackdropBounds: syncDrawerBackdropBounds,

        /** Phase 14：同步私有圖層父層解鎖標記 */
        syncLayerPanelShells: syncLayerPanelShells,

        /** Phase 15：開啟原生 EditPinDialog 並於背景擷取可編輯欄位 */
        openNativePinEdit: openNativePinEdit,

        /** Phase 15：將原生 EditPinDialog 修改結果寫回背景氣泡窗並自動儲存 */
        saveNativePinEdit: saveNativePinEdit,

        /** Phase 15：取消原生編輯並退出背景氣泡窗編輯模式 */
        cancelNativePinEdit: cancelNativePinEdit,

        /** Phase 15：刪除目前選取的地點圖釘 */
        deleteSelectedPin: deleteSelectedPin,

        /** Phase 15：逃生門 —— 切換回原網頁氣泡窗編輯模式（相片/樣式） */
        fallbackToWebPinEdit: fallbackToWebPinEdit,

        /** Phase 16：強制歸零視窗與地圖祖先鏈捲動偏移，避免背景聚焦造成地圖飄移卡死 */
        resetMapViewportScrollLock: resetMapViewportScrollLock,

        /** Phase 17：穿透外層 Wrapper 解析並點擊真正內層 Closure 按鈕 */
        resolveClickableButton: resolveClickableButton,
        clickInfoWindowControl: clickInfoWindowControl
    };

    /**
     * 9. 初次載入時註冊全域事件監聽與 MutationObserver (避免重複掛載)
     */
    if (!helperState.initialized) {
        helperState.initialized = true;

        // Phase 11：包裝 window.open 以攔截導航彈窗並轉交 Android 原生開啟
        installWindowOpenInterceptor();

        // Phase 16：攔截背景氣泡窗內的 focus() 與 scrollIntoView()，杜絕地圖自動亂移動
        installInfoWindowFocusScrollGuard();

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

        // Phase 14：螢幕旋轉或視窗 resize 時，若抽屜開啟中自動同步背景遮罩位置
        window.addEventListener('resize', function () {
            if (helperState.drawerOpen) {
                syncDrawerBackdropBounds();
            }
        }, { passive: true });

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
