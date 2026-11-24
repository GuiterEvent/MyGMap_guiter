#!/usr/bin/env node
/**
 * ============================================================================
 * MyGMap inject_script.js 真實執行 DOM 行為回歸測試套件 (scripts/test_inject_dom.mjs)
 *
 * 純開源 Node.js 實作（零外部商業/第三方相依），真實載入並執行
 * app/src/main/assets/inject_script.js，驗證 Google 我的地圖 DOM 行為：
 *   1. 巢狀 Wrapper 儲存按鈕測試（核心回歸測試）
 *   2. 儲存失敗不假報成功測試
 *   3. 無 type="text" <input> 標題自動帶入與空說明欄寫入測試
 *   4. 禁止無 preventScroll 聚焦與地圖捲動歸零測試
 *   5. 點選 POI 零閃跳狀態測試 (mygmap-addtomap-visible)
 *   6. 圖層抽屜與地圖保護回歸測試 (360px 窄螢幕 + backdrop left)
 *   7. !3d!4d 高精準座標優先序回歸測試
 * ============================================================================
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const INJECT_SCRIPT_PATH = path.join(PROJECT_ROOT, 'app', 'src', 'main', 'assets', 'inject_script.js');
const INJECT_SCRIPT_SOURCE = fs.readFileSync(INJECT_SCRIPT_PATH, 'utf8');

// ============================================================================
// 輕量級標準 DOM / Event / Selector 模擬環境（真實支援事件冒泡 child -> parent）
// ============================================================================
function splitTopLevel(str, delimiter) {
    const parts = [];
    let current = '';
    let bracketDepth = 0;
    let parenDepth = 0;
    let inQuote = null;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (inQuote) {
            current += ch;
            if (ch === inQuote && str[i - 1] !== '\\') inQuote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inQuote = ch;
            current += ch;
            continue;
        }
        if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth--;
        else if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth--;

        if (ch === delimiter && bracketDepth === 0 && parenDepth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.length > 0) parts.push(current);
    return parts;
}

function splitWhitespaceTopLevel(str) {
    const tokens = [];
    let current = '';
    let bracketDepth = 0;
    let parenDepth = 0;
    let inQuote = null;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (inQuote) {
            current += ch;
            if (ch === inQuote && str[i - 1] !== '\\') inQuote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inQuote = ch;
            current += ch;
            continue;
        }
        if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth--;
        else if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth--;

        if (/\s/.test(ch) && bracketDepth === 0 && parenDepth === 0) {
            if (current) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (current) tokens.push(current);
    return tokens;
}

function matchesSimpleSelector(el, selector) {
    if (!el || el.nodeType !== 1) return false;
    let s = selector.trim();
    if (!s || s === '*') return true;

    // Extract :not(...) groups first
    const notGroups = [];
    let stripped = '';
    for (let i = 0; i < s.length; i++) {
        if (s.slice(i, i + 5) === ':not(') {
            let depth = 1;
            let j = i + 5;
            let inner = '';
            let inQ = null;
            while (j < s.length && depth > 0) {
                const c = s[j];
                if (inQ) {
                    if (c === inQ && s[j - 1] !== '\\') inQ = null;
                    inner += c;
                } else {
                    if (c === '"' || c === "'") inQ = c;
                    else if (c === '(') depth++;
                    else if (c === ')') {
                        depth--;
                        if (depth === 0) break;
                    }
                    inner += c;
                }
                j++;
            }
            notGroups.push(inner.trim());
            i = j;
        } else {
            stripped += s[i];
        }
    }

    for (const ng of notGroups) {
        if (matchesSimpleSelector(el, ng)) return false;
    }

    // Parse attribute selectors [...]
    const attrRegex = /\[([^\]=*^$]+)(?:([*^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
    let match;
    while ((match = attrRegex.exec(stripped)) !== null) {
        const attrName = match[1].trim();
        const op = match[2];
        const expected = match[3] ?? match[4] ?? match[5] ?? '';
        const hasAttr = el.hasAttribute(attrName);
        if (!op) {
            if (!hasAttr) return false;
        } else {
            if (!hasAttr) return false;
            const actual = String(el.getAttribute(attrName) ?? '');
            if (op === '=' && actual !== expected) return false;
            if (op === '*=' && !actual.includes(expected)) return false;
            if (op === '^=' && !actual.startsWith(expected)) return false;
            if (op === '$=' && !actual.endsWith(expected)) return false;
        }
    }

    const base = stripped.replace(attrRegex, '').trim();
    if (!base) return true;

    // Tag, #id, .class parts
    const tagMatch = base.match(/^([a-zA-Z0-9_-]+)/);
    if (tagMatch) {
        if (el.tagName.toUpperCase() !== tagMatch[1].toUpperCase()) return false;
    }

    const idMatches = base.matchAll(/#([a-zA-Z0-9_\u4e00-\u9fff-]+)/g);
    for (const im of idMatches) {
        if (el.id !== im[1]) return false;
    }

    const clsMatches = base.matchAll(/\.([a-zA-Z0-9_-]+)/g);
    for (const cm of clsMatches) {
        if (!el.classList.contains(cm[1])) return false;
    }

    return true;
}

function matchesSelector(el, selectorList) {
    if (!el || el.nodeType !== 1 || !selectorList) return false;
    const groups = splitTopLevel(selectorList, ',');
    for (const rawGroup of groups) {
        const group = rawGroup.trim();
        if (!group) continue;
        const parts = splitWhitespaceTopLevel(group);
        if (parts.length === 0) continue;
        if (!matchesSimpleSelector(el, parts[parts.length - 1])) continue;

        let ok = true;
        let curr = el.parentElement;
        for (let idx = parts.length - 2; idx >= 0; idx--) {
            let found = false;
            while (curr) {
                if (matchesSimpleSelector(curr, parts[idx])) {
                    found = true;
                    curr = curr.parentElement;
                    break;
                }
                curr = curr.parentElement;
            }
            if (!found) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }
    return false;
}

function createMockEnvironment(options = {}) {
    const viewportWidth = options.viewportWidth ?? 360;
    const viewportHeight = options.viewportHeight ?? 740;
    const initialHref = options.href ?? 'https://www.google.com/maps/d/edit?mid=test-map-id-123';
    const focusCalls = [];
    const scrollToCalls = [];
    const bridgeCalls = {
        onPageModeChanged: [],
        onDrawerStateChanged: [],
        onMobileModeChanged: [],
        onSelectedPinStateChanged: [],
        onPinEditFormReady: [],
        onPinEditResult: [],
        onGpsPinStatus: []
    };

    class MockEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.bubbles = Boolean(init.bubbles);
            this.cancelable = Boolean(init.cancelable);
            this.defaultPrevented = false;
            this.target = null;
            this.currentTarget = null;
            this._stopped = false;
            this._immediateStopped = false;
            Object.assign(this, init);
        }
        preventDefault() {
            if (this.cancelable) this.defaultPrevented = true;
        }
        stopPropagation() {
            this._stopped = true;
        }
        stopImmediatePropagation() {
            this._stopped = true;
            this._immediateStopped = true;
        }
    }

    class MockStyle {
        constructor() {
            this._map = new Map();
            return new Proxy(this, {
                get(target, prop) {
                    if (prop in target) return target[prop];
                    if (typeof prop === 'string') return target._map.get(prop) ?? '';
                    return undefined;
                },
                set(target, prop, value) {
                    if (prop in target) {
                        target[prop] = value;
                        return true;
                    }
                    target._map.set(String(prop), String(value));
                    return true;
                }
            });
        }
        setProperty(name, value) {
            this._map.set(String(name), String(value));
        }
        removeProperty(name) {
            this._map.delete(String(name));
        }
        getPropertyValue(name) {
            return this._map.get(String(name)) ?? '';
        }
    }

    class MockClassList {
        constructor(el) {
            this._el = el;
            this._set = new Set();
        }
        add(...names) {
            for (const n of names) if (n) this._set.add(n);
            this._sync();
        }
        remove(...names) {
            for (const n of names) this._set.delete(n);
            this._sync();
        }
        contains(name) {
            return this._set.has(name);
        }
        _setFromString(str) {
            this._set = new Set(String(str || '').trim().split(/\s+/).filter(Boolean));
        }
        _sync() {
            this._el._attrs.set('class', Array.from(this._set).join(' '));
        }
        toString() {
            return Array.from(this._set).join(' ');
        }
    }

    class MockElement {
        constructor(tagName, ownerDoc) {
            this.nodeType = 1;
            this.tagName = String(tagName || 'DIV').toUpperCase();
            this.ownerDocument = ownerDoc;
            this.parentElement = null;
            this.children = [];
            this._attrs = new Map();
            this.classList = new MockClassList(this);
            this.style = new MockStyle();
            this._listeners = new Map();
            this._textContent = '';
            this._rect = { left: 0, top: 0, width: 120, height: 40, right: 120, bottom: 40 };
            this._computed = { display: 'block', visibility: 'visible', position: 'static' };
            this.scrollLeft = 0;
            this.scrollTop = 0;
            this.disabled = false;
            this.readOnly = false;
        }

        get id() {
            return this._attrs.get('id') || '';
        }
        set id(v) {
            this.setAttribute('id', v);
        }

        get className() {
            return this.classList.toString();
        }
        set className(v) {
            this.setAttribute('class', v);
        }

        get isContentEditable() {
            if (!this.hasAttribute('contenteditable')) return false;
            return String(this.getAttribute('contenteditable') || '').toLowerCase() !== 'false';
        }

        get textContent() {
            if (this.children.length === 0) return this._textContent;
            const childTexts = this.children.map((c) => c.textContent).filter(Boolean);
            return [this._textContent, ...childTexts].filter(Boolean).join('\n');
        }
        set textContent(val) {
            this._textContent = String(val ?? '');
            this.children = [];
        }

        get innerText() {
            return this.textContent;
        }
        set innerText(val) {
            this.textContent = val;
        }

        setAttribute(name, value) {
            const key = String(name);
            const val = String(value);
            this._attrs.set(key, val);
            if (key === 'class') {
                this.classList._setFromString(val);
            }
        }
        getAttribute(name) {
            const key = String(name);
            return this._attrs.has(key) ? this._attrs.get(key) : null;
        }
        hasAttribute(name) {
            return this._attrs.has(String(name));
        }
        removeAttribute(name) {
            const key = String(name);
            this._attrs.delete(key);
            if (key === 'class') this.classList._setFromString('');
        }

        appendChild(child) {
            if (child.parentElement) child.parentElement.removeChild(child);
            child.parentElement = this;
            this.children.push(child);
            return child;
        }
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx !== -1) {
                this.children.splice(idx, 1);
                child.parentElement = null;
            }
            return child;
        }
        contains(other) {
            let cur = other;
            while (cur) {
                if (cur === this) return true;
                cur = cur.parentElement;
            }
            return false;
        }

        matches(selector) {
            return matchesSelector(this, selector);
        }
        closest(selector) {
            let cur = this;
            while (cur) {
                if (matchesSelector(cur, selector)) return cur;
                cur = cur.parentElement;
            }
            return null;
        }
        querySelectorAll(selector) {
            const results = [];
            const walk = (node) => {
                for (const child of node.children) {
                    if (matchesSelector(child, selector)) results.push(child);
                    walk(child);
                }
            };
            walk(this);
            return results;
        }
        querySelector(selector) {
            const all = this.querySelectorAll(selector);
            return all.length > 0 ? all[0] : null;
        }

        setRect(rect) {
            const left = rect.left ?? 0;
            const top = rect.top ?? 0;
            const width = rect.width ?? 120;
            const height = rect.height ?? 40;
            this._rect = { left, top, width, height, right: left + width, bottom: top + height };
        }
        getBoundingClientRect() {
            return { ...this._rect };
        }
        getClientRects() {
            let cur = this;
            while (cur) {
                if (cur.style.display === 'none' || cur._computed.display === 'none') return [];
                cur = cur.parentElement;
            }
            return [this.getBoundingClientRect()];
        }

        addEventListener(type, fn, opts) {
            const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
            if (!this._listeners.has(type)) this._listeners.set(type, []);
            this._listeners.get(type).push({ fn, capture });
        }

        /**
         * 真實 DOM 事件傳遞：Capture (root -> target) + Target + Bubble (target -> root)
         * 嚴格遵守「絕不向下傳遞給子節點」規則！
         */
        dispatchEvent(evt) {
            evt.target = this;
            const chain = [];
            let cur = this;
            while (cur) {
                chain.push(cur);
                cur = cur.parentElement;
            }
            if (this.ownerDocument) chain.push(this.ownerDocument);

            // Capture phase (excluding target)
            for (let i = chain.length - 1; i >= 1; i--) {
                const node = chain[i];
                const list = node._listeners ? (node._listeners.get(evt.type) || []) : [];
                for (const entry of list) {
                    if (!entry.capture) continue;
                    evt.currentTarget = node;
                    entry.fn.call(node, evt);
                    if (evt._immediateStopped) return !evt.defaultPrevented;
                }
                if (evt._stopped) return !evt.defaultPrevented;
            }

            // Target phase
            const targetList = this._listeners.get(evt.type) || [];
            for (const entry of targetList) {
                evt.currentTarget = this;
                entry.fn.call(this, evt);
                if (evt._immediateStopped) return !evt.defaultPrevented;
            }
            if (evt._stopped || !evt.bubbles) return !evt.defaultPrevented;

            // Bubble phase (parent -> root; NEVER downwards to children!)
            for (let i = 1; i < chain.length; i++) {
                const node = chain[i];
                const list = node._listeners ? (node._listeners.get(evt.type) || []) : [];
                for (const entry of list) {
                    if (entry.capture) continue;
                    evt.currentTarget = node;
                    entry.fn.call(node, evt);
                    if (evt._immediateStopped) return !evt.defaultPrevented;
                }
                if (evt._stopped) return !evt.defaultPrevented;
            }
            return !evt.defaultPrevented;
        }

        click() {
            this.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true }));
        }
        focus(opts) {
            focusCalls.push({ element: this, id: this.id, tagName: this.tagName, options: opts });
            this.ownerDocument.activeElement = this;
        }
        blur() {
            if (this.ownerDocument.activeElement === this) {
                this.ownerDocument.activeElement = this.ownerDocument.body;
            }
        }
        scrollIntoView() {}
    }

    class MockInputElement extends MockElement {
        constructor(ownerDoc) {
            super('INPUT', ownerDoc);
            this._value = '';
        }
        get value() {
            return this._value;
        }
        set value(v) {
            this._value = String(v ?? '');
        }
        get type() {
            return this.getAttribute('type') || 'text';
        }
    }

    class MockTextAreaElement extends MockElement {
        constructor(ownerDoc) {
            super('TEXTAREA', ownerDoc);
            this._value = '';
        }
        get value() {
            return this._value;
        }
        set value(v) {
            this._value = String(v ?? '');
        }
    }

    const docListeners = new Map();
    const document = {
        nodeType: 9,
        _listeners: docListeners,
        activeElement: null,
        createElement(tag) {
            const upper = String(tag).toUpperCase();
            if (upper === 'INPUT') return new MockInputElement(document);
            if (upper === 'TEXTAREA') return new MockTextAreaElement(document);
            return new MockElement(upper, document);
        },
        getElementById(id) {
            const walk = (node) => {
                if (node.id === id) return node;
                for (const c of node.children) {
                    const hit = walk(c);
                    if (hit) return hit;
                }
                return null;
            };
            return walk(document.documentElement);
        },
        getElementsByTagName(tag) {
            return document.documentElement.querySelectorAll(tag);
        },
        querySelectorAll(selector) {
            return document.documentElement.querySelectorAll(selector);
        },
        querySelector(selector) {
            return document.documentElement.querySelector(selector);
        },
        addEventListener(type, fn, opts) {
            const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
            if (!docListeners.has(type)) docListeners.set(type, []);
            docListeners.get(type).push({ fn, capture });
        },
        dispatchEvent(evt) {
            const list = docListeners.get(evt.type) || [];
            for (const entry of list) {
                entry.fn.call(document, evt);
            }
            return true;
        }
    };

    document.documentElement = new MockElement('HTML', document);
    document.head = new MockElement('HEAD', document);
    document.body = new MockElement('BODY', document);
    document.documentElement.appendChild(document.head);
    document.documentElement.appendChild(document.body);
    document.activeElement = document.body;

    const winListeners = new Map();
    const urlObj = new URL(initialHref);
    const activeTimers = new Set();

    const wrappedSetTimeout = (fn, ms, ...args) => {
        const handle = setTimeout(() => {
            activeTimers.delete(handle);
            fn(...args);
        }, ms);
        activeTimers.add(handle);
        return handle;
    };
    const wrappedClearTimeout = (handle) => {
        activeTimers.delete(handle);
        clearTimeout(handle);
    };
    const wrappedSetInterval = (fn, ms, ...args) => {
        const handle = setInterval(fn, ms, ...args);
        activeTimers.add(handle);
        return handle;
    };
    const wrappedClearInterval = (handle) => {
        activeTimers.delete(handle);
        clearInterval(handle);
    };

    const windowObj = {
        innerWidth: viewportWidth,
        innerHeight: viewportHeight,
        location: {
            href: urlObj.href,
            pathname: urlObj.pathname,
            search: urlObj.search
        },
        document,
        HTMLElement: MockElement,
        Element: MockElement,
        HTMLInputElement: MockInputElement,
        HTMLTextAreaElement: MockTextAreaElement,
        Event: MockEvent,
        MouseEvent: MockEvent,
        PointerEvent: MockEvent,
        KeyboardEvent: MockEvent,
        InputEvent: MockEvent,
        FocusEvent: MockEvent,
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
        requestAnimationFrame(cb) {
            return wrappedSetTimeout(cb, 0);
        },
        setTimeout: wrappedSetTimeout,
        clearTimeout: wrappedClearTimeout,
        setInterval: wrappedSetInterval,
        clearInterval: wrappedClearInterval,
        scrollTo(x, y) {
            scrollToCalls.push({ x, y });
        },
        getComputedStyle(el) {
            return {
                display: el.style.display || el._computed.display || 'block',
                visibility: el.style.visibility || el._computed.visibility || 'visible',
                position: el.style.position || el._computed.position || 'static',
                backgroundImage: el.style.backgroundImage || 'none'
            };
        },
        addEventListener(type, fn) {
            if (!winListeners.has(type)) winListeners.set(type, []);
            winListeners.get(type).push(fn);
        },
        dispatchEvent(evt) {
            const list = winListeners.get(evt.type) || [];
            for (const fn of list) fn.call(windowObj, evt);
            return true;
        },
        AndroidBridge: {
            onPageModeChanged(v) { bridgeCalls.onPageModeChanged.push(v); },
            onDrawerStateChanged(v) { bridgeCalls.onDrawerStateChanged.push(v); },
            onMobileModeChanged(v) { bridgeCalls.onMobileModeChanged.push(v); },
            onSelectedPinStateChanged(json) { bridgeCalls.onSelectedPinStateChanged.push(JSON.parse(json)); },
            onPinEditFormReady(json) { bridgeCalls.onPinEditFormReady.push(JSON.parse(json)); },
            onPinEditResult(json) { bridgeCalls.onPinEditResult.push(JSON.parse(json)); },
            onGpsPinStatus(json) { bridgeCalls.onGpsPinStatus.push(JSON.parse(json)); }
        },
        console: {
            info() {},
            log() {},
            warn() {},
            error() {}
        }
    };
    windowObj.window = windowObj;
    windowObj.self = windowObj;

    function loadScript() {
        const ctx = vm.createContext(windowObj);
        vm.runInContext(INJECT_SCRIPT_SOURCE, ctx, { filename: 'inject_script.js' });
        return windowObj.MyGMapHelper;
    }

    function cleanup() {
        for (const h of activeTimers) {
            clearTimeout(h);
            clearInterval(h);
        }
        activeTimers.clear();
    }

    return {
        window: windowObj,
        document,
        focusCalls,
        scrollToCalls,
        bridgeCalls,
        loadScript,
        cleanup
    };
}

function waitFor(predicate, timeoutMs = 4000, intervalMs = 20) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (predicate()) return resolve();
            if (Date.now() - start >= timeoutMs) {
                return reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
            }
            setTimeout(check, intervalMs);
        };
        check();
    });
}

// ============================================================================
// 7 組真實行為回歸測試
// ============================================================================
const tests = [];
function registerTest(name, fn) {
    tests.push({ name, fn });
}

// ----------------------------------------------------------------------------
// 測試 1：巢狀 Wrapper 儲存按鈕測試（Phase 17 核心回歸測試！）
// ----------------------------------------------------------------------------
registerTest('1. 巢狀 Wrapper 儲存按鈕：穿透點擊內層 [role="button"] 寫入標題與說明並退出編輯模式', async () => {
    const env = createMockEnvironment();
    try {
        const { document, bridgeCalls } = env;
        const mapCanvas = document.createElement('div');
        mapCanvas.id = 'map-canvas';
        mapCanvas.setRect({ left: 0, top: 0, width: 360, height: 740 });
        document.body.appendChild(mapCanvas);

        const iw = document.createElement('div');
        iw.id = 'map-infowindow-container';
        iw.setRect({ left: 20, top: 40, width: 280, height: 220 });
        document.body.appendChild(iw);

        let savedTitle = '原始標題';
        let savedDesc = '';
        let innerSaveClicks = 0;

        function renderViewMode() {
            iw.children = [];
            const titleDiv = document.createElement('div');
            titleDiv.id = 'map-infowindow-attr-名稱-value';
            titleDiv.textContent = savedTitle;
            iw.appendChild(titleDiv);

            const descDiv = document.createElement('div');
            descDiv.id = 'map-infowindow-attr-說明-value';
            descDiv.textContent = savedDesc;
            iw.appendChild(descDiv);

            const editWrapper = document.createElement('div');
            editWrapper.id = 'map-infowindow-edit-button';
            const editInner = document.createElement('div');
            editInner.setAttribute('role', 'button');
            editInner.className = 'jfk-button';
            editInner.textContent = '編輯';
            editInner.addEventListener('click', () => {
                renderEditMode();
            });
            editWrapper.appendChild(editInner);
            iw.appendChild(editWrapper);
        }

        function renderEditMode() {
            iw.children = [];
            const titleInput = document.createElement('input');
            titleInput.id = 'map-infowindow-attr-名稱-value';
            titleInput.value = savedTitle;
            iw.appendChild(titleInput);

            const descTextarea = document.createElement('textarea');
            descTextarea.id = 'map-infowindow-attr-說明-value';
            descTextarea.value = savedDesc;
            iw.appendChild(descTextarea);

            // 模擬真實 Google 我的地圖結構：外層 Wrapper <div> 無事件，只有內層 [role="button"] 綁定儲存監聽器
            const saveWrapper = document.createElement('div');
            saveWrapper.id = 'map-infowindow-done-editing-button';
            const innerSaveBtn = document.createElement('div');
            innerSaveBtn.setAttribute('role', 'button');
            innerSaveBtn.className = 'jfk-button';
            innerSaveBtn.textContent = '儲存';
            innerSaveBtn.addEventListener('click', () => {
                innerSaveClicks++;
                savedTitle = titleInput.value;
                savedDesc = descTextarea.value;
                renderViewMode();
            });
            saveWrapper.appendChild(innerSaveBtn);
            iw.appendChild(saveWrapper);
        }

        renderViewMode();
        const helper = env.loadScript();

        helper.openNativePinEdit();
        assert.equal(bridgeCalls.onPinEditFormReady.length, 1);
        assert.equal(bridgeCalls.onPinEditFormReady[0].ok, true);
        assert.equal(bridgeCalls.onPinEditFormReady[0].title, '原始標題');

        helper.saveNativePinEdit(JSON.stringify({
            title: '北角觀景台',
            description: '夕陽與海景絕佳，車停入口免費停車場',
            extraFields: []
        }));

        await waitFor(() => bridgeCalls.onPinEditResult.length > 0, 2500);

        const res = bridgeCalls.onPinEditResult[0];
        assert.equal(res.ok, true, '內層儲存按鈕被正確觸發後必須回報 ok: true');
        assert.equal(res.action, 'save');
        assert.ok(innerSaveClicks >= 1, '必須實際觸發內層 [role="button"] 的 click 監聽器');
        assert.equal(savedTitle, '北角觀景台', '標題必須確實寫入 Google 狀態');
        assert.equal(savedDesc, '夕陽與海景絕佳，車停入口免費停車場', '說明必須確實寫入 Google 狀態');
        assert.equal(helper._state.nativePinEditing, false, '儲存後必須解除 nativePinEditing');
        assert.equal(document.body.classList.contains('mygmap-native-pin-editing'), false, '儲存後必須清除 mygmap-native-pin-editing');
        assert.equal(document.body.classList.contains('mygmap-pin-editing'), false, '儲存後必須清除 mygmap-pin-editing');
        assert.equal(document.getElementById('map-infowindow-done-editing-button'), null, '背景氣泡窗必須已退出編輯模式回到檢視模式');
    } finally {
        env.cleanup();
    }
});

// ----------------------------------------------------------------------------
// 測試 2：儲存失敗不假報成功測試
// ----------------------------------------------------------------------------
registerTest('2. 儲存失敗不假報成功：按鈕無反應時嚴格回報 ok: false 且不鎖死 nativePinEditing', async () => {
    const env = createMockEnvironment();
    try {
        const { document, bridgeCalls } = env;
        const iw = document.createElement('div');
        iw.id = 'map-infowindow-container';
        iw.setRect({ left: 20, top: 40, width: 280, height: 220 });
        document.body.appendChild(iw);

        const titleInput = document.createElement('input');
        titleInput.id = 'map-infowindow-attr-名稱-value';
        titleInput.value = '卡住的地點';
        iw.appendChild(titleInput);

        const descTextarea = document.createElement('textarea');
        descTextarea.id = 'map-infowindow-attr-說明-value';
        descTextarea.value = '';
        iw.appendChild(descTextarea);

        // 刻意不綁定任何退出編輯模式的事件監聽器，模擬儲存按鈕完全失效
        const brokenSaveWrapper = document.createElement('div');
        brokenSaveWrapper.id = 'map-infowindow-done-editing-button';
        const brokenInner = document.createElement('div');
        brokenInner.setAttribute('role', 'button');
        brokenInner.className = 'jfk-button';
        brokenInner.textContent = '儲存';
        brokenSaveWrapper.appendChild(brokenInner);
        iw.appendChild(brokenSaveWrapper);

        // 取消按鈕可正常退出編輯模式（驗證逾時會安全還原）
        let cancelTriggered = false;
        const cancelWrapper = document.createElement('div');
        cancelWrapper.id = 'map-infowindow-cancel-editing-button';
        const cancelInner = document.createElement('div');
        cancelInner.setAttribute('role', 'button');
        cancelInner.textContent = '取消';
        cancelInner.addEventListener('click', () => {
            cancelTriggered = true;
            iw.children = [];
            const titleView = document.createElement('div');
            titleView.id = 'map-infowindow-attr-名稱-value';
            titleView.textContent = '卡住的地點';
            iw.appendChild(titleView);
        });
        cancelWrapper.appendChild(cancelInner);
        iw.appendChild(cancelWrapper);

        const helper = env.loadScript();
        helper.saveNativePinEdit(JSON.stringify({
            title: '新標題',
            description: '新說明',
            extraFields: []
        }));

        await waitFor(() => bridgeCalls.onPinEditResult.length > 0, 3500);

        const res = bridgeCalls.onPinEditResult[0];
        assert.equal(res.ok, false, '逾時仍停在編輯模式時絕不可假報 ok: true');
        assert.equal(res.action, 'save');
        assert.equal(cancelTriggered, true, '儲存逾時時應自動嘗試取消退出編輯模式，避免地圖鎖死回彈');
        assert.equal(helper._state.nativePinEditing, false, '儲存失敗後不可讓 nativePinEditing 永遠鎖死');
        assert.equal(document.body.classList.contains('mygmap-native-pin-editing'), false);
    } finally {
        env.cleanup();
    }
});

// ----------------------------------------------------------------------------
// 測試 3：無 type="text" <input> 標題自動帶入與空說明欄寫入測試
// ----------------------------------------------------------------------------
registerTest('3. 無 type="text" <input> 標題自動帶入與空說明欄 <textarea> 寫入及事件派發', async () => {
    const env = createMockEnvironment();
    try {
        const { document, bridgeCalls } = env;
        const iw = document.createElement('div');
        iw.id = 'map-infowindow-container';
        iw.setRect({ left: 16, top: 40, width: 280, height: 200 });
        document.body.appendChild(iw);

        // 無顯式 type="text" 屬性之 <input>
        const titleInput = document.createElement('input');
        titleInput.id = 'map-infowindow-attr-名稱-value';
        titleInput.value = '九份老街觀海平台';
        iw.appendChild(titleInput);

        // 帶 Closure label-input-label class 的空 <textarea>
        const descTextarea = document.createElement('textarea');
        descTextarea.id = 'map-infowindow-attr-說明-value';
        descTextarea.className = 'label-input-label';
        descTextarea.value = '';
        const descEvents = [];
        descTextarea.addEventListener('focus', () => descEvents.push('focus'));
        descTextarea.addEventListener('input', () => descEvents.push('input'));
        descTextarea.addEventListener('change', () => descEvents.push('change'));
        descTextarea.addEventListener('keyup', () => descEvents.push('keyup'));
        descTextarea.addEventListener('blur', () => descEvents.push('blur'));
        iw.appendChild(descTextarea);

        const saveBtn = document.createElement('div');
        saveBtn.id = 'map-infowindow-done-editing-button';
        const innerSave = document.createElement('button');
        innerSave.textContent = '儲存';
        let capturedDescOnSave = '';
        innerSave.addEventListener('click', () => {
            capturedDescOnSave = descTextarea.value;
            iw.children = [];
            const viewTitle = document.createElement('div');
            viewTitle.id = 'map-infowindow-attr-名稱-value';
            viewTitle.textContent = titleInput.value;
            iw.appendChild(viewTitle);
        });
        saveBtn.appendChild(innerSave);
        iw.appendChild(saveBtn);

        const helper = env.loadScript();
        helper.openNativePinEdit();

        assert.equal(bridgeCalls.onPinEditFormReady.length, 1);
        assert.equal(bridgeCalls.onPinEditFormReady[0].ok, true);
        assert.equal(bridgeCalls.onPinEditFormReady[0].title, '九份老街觀海平台', '無 type="text" 的 <input> 標題必須自動帶入');

        helper.saveNativePinEdit(JSON.stringify({
            title: '九份老街觀海平台',
            description: '傍晚點燈很美，建議搭公車上山',
            extraFields: []
        }));

        await waitFor(() => bridgeCalls.onPinEditResult.length > 0, 2500);

        assert.equal(bridgeCalls.onPinEditResult[0].ok, true);
        assert.equal(capturedDescOnSave, '傍晚點燈很美，建議搭公車上山');
        assert.equal(descTextarea.classList.contains('label-input-label'), false, '應清除 Closure label-input-label');
        assert.ok(descEvents.includes('input'), '寫入說明欄時必須派發 input 事件');
        assert.ok(descEvents.includes('change'), '寫入說明欄時必須派發 change 事件');
        assert.ok(descEvents.includes('focus'), '寫入說明欄前必須派發 focus 事件');
    } finally {
        env.cleanup();
    }
});

// ----------------------------------------------------------------------------
// 測試 4：禁止無 preventScroll 聚焦與地圖捲動歸零測試
// ----------------------------------------------------------------------------
registerTest('4. 禁止無 preventScroll 聚焦與 resetMapViewportScrollLock 地圖祖先捲動歸零', async () => {
    const env = createMockEnvironment();
    try {
        const { document, focusCalls, scrollToCalls } = env;

        const rootShell = document.createElement('div');
        rootShell.id = 'map-root-shell';
        rootShell.scrollLeft = 185;
        rootShell.scrollTop = 92;

        const mapCanvas = document.createElement('div');
        mapCanvas.id = 'map-canvas';
        mapCanvas.scrollLeft = 64;
        mapCanvas.scrollTop = 48;
        rootShell.appendChild(mapCanvas);
        document.body.appendChild(rootShell);

        document.documentElement.scrollLeft = 30;
        document.documentElement.scrollTop = 20;
        document.body.scrollLeft = 15;
        document.body.scrollTop = 10;

        const iw = document.createElement('div');
        iw.id = 'map-infowindow-container';
        iw.setRect({ left: 10, top: 20, width: 240, height: 180 });
        const titleInput = document.createElement('input');
        titleInput.id = 'map-infowindow-attr-名稱-value';
        titleInput.value = '測試地點';
        const saveWrapper = document.createElement('div');
        saveWrapper.id = 'map-infowindow-done-editing-button';
        const saveInner = document.createElement('div');
        saveInner.setAttribute('role', 'button');
        saveInner.textContent = '儲存';
        saveInner.addEventListener('click', () => {
            iw.children = [];
            const vt = document.createElement('div');
            vt.id = 'map-infowindow-attr-名稱-value';
            vt.textContent = titleInput.value;
            iw.appendChild(vt);
        });
        saveWrapper.appendChild(saveInner);
        iw.appendChild(titleInput);
        iw.appendChild(saveWrapper);
        document.body.appendChild(iw);

        const helper = env.loadScript();
        focusCalls.length = 0;

        helper.saveNativePinEdit(JSON.stringify({
            title: '測試地點更新',
            description: '',
            extraFields: []
        }));

        await waitFor(() => env.bridgeCalls.onPinEditResult.length > 0, 2500);

        assert.ok(focusCalls.length > 0, '應有執行到聚焦呼叫');
        for (const call of focusCalls) {
            assert.equal(
                Boolean(call.options && call.options.preventScroll === true),
                true,
                `所有 focus() 必須帶入 { preventScroll: true }，實際呼叫於 ${call.tagName}#${call.id}: ${JSON.stringify(call.options)}`
            );
        }

        // 再次人為偏移捲動，驗證 resetMapViewportScrollLock() 強制歸零
        rootShell.scrollLeft = 210;
        rootShell.scrollTop = 115;
        mapCanvas.scrollLeft = 77;
        mapCanvas.scrollTop = 33;
        scrollToCalls.length = 0;

        helper.resetMapViewportScrollLock(true);

        assert.equal(rootShell.scrollLeft, 0);
        assert.equal(rootShell.scrollTop, 0);
        assert.equal(mapCanvas.scrollLeft, 0);
        assert.equal(mapCanvas.scrollTop, 0);
        assert.equal(document.documentElement.scrollLeft, 0);
        assert.equal(document.documentElement.scrollTop, 0);
        assert.equal(document.body.scrollLeft, 0);
        assert.equal(document.body.scrollTop, 0);
        assert.ok(scrollToCalls.some((c) => c.x === 0 && c.y === 0), '必須呼叫 window.scrollTo(0, 0)');
    } finally {
        env.cleanup();
    }
});

// ----------------------------------------------------------------------------
// 測試 5：點選 POI 零閃跳狀態測試
// ----------------------------------------------------------------------------
registerTest('5. 點選 POI 零閃跳狀態：一般 POI 不加 mygmap-addtomap-visible，搜尋綠釘才加', async () => {
    const env = createMockEnvironment();
    try {
        const { document } = env;
        const iw = document.createElement('div');
        iw.id = 'map-infowindow-container';
        iw.setRect({ left: 10, top: 20, width: 260, height: 150 });
        const titleDiv = document.createElement('div');
        titleDiv.id = 'map-infowindow-attr-名稱-value';
        titleDiv.textContent = '象山觀景台';
        iw.appendChild(titleDiv);
        document.body.appendChild(iw);

        const helper = env.loadScript();
        helper.scanAndTagDom();

        assert.equal(
            document.body.classList.contains('mygmap-addtomap-visible'),
            false,
            '一般已儲存 POI 不可加上 mygmap-addtomap-visible'
        );

        // 切換為搜尋結果綠釘氣泡窗（含可見 #addtomap-button）
        const addToMapBtn = document.createElement('div');
        addToMapBtn.id = 'addtomap-button';
        addToMapBtn.setAttribute('role', 'button');
        addToMapBtn.textContent = '+ 新增至地圖';
        iw.appendChild(addToMapBtn);

        helper.scanAndTagDom();

        assert.equal(
            document.body.classList.contains('mygmap-addtomap-visible'),
            true,
            '搜尋結果綠釘含 #addtomap-button 時必須加上 mygmap-addtomap-visible'
        );
    } finally {
        env.cleanup();
    }
});

// ----------------------------------------------------------------------------
// 測試 6：圖層抽屜與地圖保護回歸測試 (360px 窄螢幕)
// ----------------------------------------------------------------------------
registerTest('6. 圖層抽屜與地圖保護：360px 窄螢幕不誤標共用外殼，展開時動態設定 backdrop left', async () => {
    const env = createMockEnvironment({ viewportWidth: 360, viewportHeight: 740 });
    try {
        const { document } = env;

        // 模擬同時包裹 #featurelist-pane 與 #map-canvas 的 360px 共用外殼
        const sharedRoot = document.createElement('div');
        sharedRoot.id = 'shared-editor-root';
        sharedRoot.setRect({ left: 0, top: 0, width: 360, height: 740 });

        const featurePane = document.createElement('div');
        featurePane.id = 'featurelist-pane';
        featurePane.setRect({ left: 0, top: 0, width: 306, height: 740 });

        const mapCanvas = document.createElement('div');
        mapCanvas.id = 'map-canvas';
        mapCanvas.setRect({ left: 0, top: 0, width: 360, height: 740 });

        sharedRoot.appendChild(featurePane);
        sharedRoot.appendChild(mapCanvas);
        document.body.appendChild(sharedRoot);

        const helper = env.loadScript();
        helper.scanAndTagDom();

        assert.notEqual(
            sharedRoot.getAttribute('data-mygmap-role'),
            'layer-panel',
            '360px 窄螢幕下絕不可將含 #map-canvas 的共用外殼標記為 layer-panel'
        );
        assert.equal(
            featurePane.getAttribute('data-mygmap-role'),
            'layer-panel',
            '#featurelist-pane 應被精準標記為 layer-panel'
        );
        assert.equal(
            mapCanvas.getAttribute('data-mygmap-role'),
            'map-canvas',
            '#map-canvas 應被標記為 map-canvas'
        );

        helper.setDrawerOpen(true);
        const backdrop = document.getElementById('mygmap-drawer-backdrop');
        assert.ok(backdrop, '應建立 #mygmap-drawer-backdrop');
        assert.equal(
            backdrop.style.getPropertyValue('left'),
            '306px',
            'setDrawerOpen(true) 必須將 #mygmap-drawer-backdrop 的 left 動態設為抽屜實際寬度 306px'
        );
    } finally {
        env.cleanup();
    }
});

// ----------------------------------------------------------------------------
// 測試 7：!3d!4d 高精準座標優先序回歸測試
// ----------------------------------------------------------------------------
registerTest('7. !3d!4d 高精準座標優先序：優先回傳 !3d!4d 而非畫面中心 /@lat,lng', async () => {
    const env = createMockEnvironment();
    try {
        const helper = env.loadScript();
        const sampleUrl = 'https://www.google.com/maps/place/Bogen+Hostel+as/@68.51358,17.01783,16z/data=!4m6!3m5!1s0x0:0x1!8m2!3d68.514123!4d17.012345';
        const coords = helper.extractExactCoordsFromMapsUrl(sampleUrl);

        assert.ok(coords, '應成功解析出座標物件');
        assert.equal(coords.lat, 68.514123, '必須優先採用 !3d 的真實圖釘緯度');
        assert.equal(coords.lng, 17.012345, '必須優先採用 !4d 的真實圖釘經度');
        assert.equal(coords.isExactPin, true);
        assert.equal(coords.isCameraCenter, false);
    } finally {
        env.cleanup();
    }
});

// ============================================================================
// 執行所有回歸測試
// ============================================================================
async function main() {
    console.log('============================================================');
    console.log('MyGMap inject_script.js DOM Regression Test Suite');
    console.log('============================================================');
    let passed = 0;
    let failed = 0;

    for (const t of tests) {
        try {
            await t.fn();
            passed++;
            console.log(`  [PASS] ${t.name}`);
        } catch (err) {
            failed++;
            console.error(`  [FAIL] ${t.name}`);
            console.error(`         ${err && err.stack ? err.stack : err}`);
        }
    }

    console.log('------------------------------------------------------------');
    console.log(`Result: ${passed}/${tests.length} passed, ${failed} failed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

main();
