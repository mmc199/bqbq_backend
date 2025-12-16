/**
 * Unified Tag Input Module
 * Handles capsule rendering, input interactions, and state management.
 */

// --- 新增常量：缓存有效期（毫秒）---
const CACHE_DURATION = 10 * 60 * 1000; 
const TAGS_CACHE_KEY = 'bqbq_tag_cache';
const TAGS_TIME_KEY = 'bqbq_tag_timestamp';

const RULES_VERSION_KEY = 'bqbq_rules_version'; // 存储规则树的本地版本号
const CLIENT_ID_KEY = 'bqbq_client_id'; // 存储客户端唯一 ID
const FAB_COLLAPSED_KEY = 'bqbq_fab_collapsed'; // 存储FAB悬浮按钮组的折叠状态
const FAB_MINI_POSITION_KEY = 'bqbq_fab_mini_position'; // 存储FAB迷你按钮组的垂直位置

// --- 支持的图片扩展名列表 ---
const SUPPORTED_EXTENSIONS = ['gif', 'png', 'jpg', 'webp'];

// --- 工具函数：防抖 ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// --- 优化 1: 预定义 Inline SVG Icons (减少 DOM 节点和 Lucide 循环调用) ---
const SVG_ICONS = {
    // Standard Lucide 24x24
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
    // UPDATED: 剪贴板堆叠图标 (Clipboard Stack)
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><rect width="8" height="14" x="4" y="8" rx="2"/><path d="M15 4h-2a2 2 0 0 0-2 2v2"/><rect width="8" height="14" x="12" y="2" rx="2" ry="2"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M3 6h18"/><path d="M19 6v14c0 1-1.1 2-2 2H7c-1.1 0-2-1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M15 2h-6l-1 4h8z"/></svg>`,
    refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg>`,
    // MODIFIED: 旋转沙漏图标 (保留现有沙漏 SVG，并使用 fast-spin 动画)
    loader: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-8 h-8 animate-spin-fast"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><polyline points="20 6 9 17 4 12"/></svg>`,
    // MODIFIED: 错误提示图标 (Alert Triangle), 增加尺寸 w-10 h-10
    alert: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-10 h-10"><path d="m21.73 18-9-15-9 15z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
};

class TagInput {
    constructor({ 
        container, 
        initialTags = [], 
        suggestionsId = '', 
        placeholder = 'Add tag...', 
        onChange = () => {}, 
        onSubmit = () => {}, 
        // --- NEW: 新增回调函数 ---
        onInputUpdate = () => {}, 
        // -------------------------
        theme = 'blue', // blue, purple, mixed (for search)
        enableExcludes = false, // Allow -tag for exclusion
        autoFocus = false
    }) {
        this.container = container;
        this.tags = [...initialTags];
        this.suggestionsId = suggestionsId;
        this.placeholder = placeholder;
        this.onChange = onChange;
        this.onSubmit = onSubmit;
        // --- NEW: 存储回调函数 ---
        this.onInputUpdate = onInputUpdate;
        // -------------------------
        this.theme = theme;
        this.enableExcludes = enableExcludes;

        // Create Input Element
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = "flex-grow min-w-[60px] bg-transparent outline-none text-slate-700 placeholder-slate-400 font-medium h-8 text-sm";
        if (suggestionsId) this.input.setAttribute('list', suggestionsId);
        this.input.placeholder = placeholder;
        
        // Bind Events
        this.bindEvents();

        // Initial Render
        this.render();

        if (autoFocus) {
            requestAnimationFrame(() => this.input.focus());
        }
    }

    bindEvents() {
        this.container.onclick = (e) => {
            if (e.target === this.container) this.input.focus();
        };

        // --- 核心修改：统一处理空格分割逻辑 (适用于PC粘贴和手机输入法) ---
        this.input.addEventListener('input', (e) => {
            const val = this.input.value;
            // 正则表达式匹配任意空格（半角 ' ' 或全角 '　'）
            const spaceIndex = val.search(/[ 　]/);

            if (spaceIndex !== -1) {
                // 找到了空格
                e.preventDefault(); // 阻止默认行为 (虽然 input 事件通常不需要，但保留)
                
                // 分割文本
                const textBefore = val.substring(0, spaceIndex).trim();
                const textAfter = val.substring(spaceIndex).trim();
                
                if (textBefore) {
                    this.addTag(textBefore);
                }
                
                // 将后面的文本放回输入框，并设置光标位置
                this.input.value = textAfter;
                
                // 强制聚焦，确保 datalist 正常弹出
                this.input.focus(); 
            }
            // --- NEW: 在每次输入时，调用外部方法更新 Datalist ---
            this.onInputUpdate(this.input.value); 
            // ----------------------------------------------------
        });

        this.input.addEventListener('keydown', (e) => {
            // Enter -> Create Tag or Submit
            if (e.key === 'Enter') {
                const val = this.input.value.trim();
                if (val) {
                    e.preventDefault();
                    this.addTag(val);
                    this.input.value = '';
                } else {
                    // Empty Enter -> Submit
                    e.preventDefault();
                    this.onSubmit(this.tags);
                }
            } 
            // Backspace -> Edit Last Tag (保持不变)
            else if (e.key === 'Backspace' && !this.input.value && this.tags.length > 0) {
                e.preventDefault();
                this.editTag(this.tags.length - 1);
            }
        });
    }

    addTag(text) {
        let isExclude = false;
        let isSynonym = false;
        let synonymWords = [];

        // 检查是否是排除标签
        if (this.enableExcludes && text.startsWith('-') && text.length > 1) {
            isExclude = true;
            text = text.substring(1);
        }

        // 检查是否包含逗号（中文或英文），如果有则为同义词组
        // 注意：排除标签也可以是同义词组
        // - 包含标签的同义词组（如 猫,喵,cat）表示匹配任一即包含（OR关系）
        // - 排除标签的同义词组（如 -猫,狗,鸟）表示必须都匹配才排除（AND关系，即交集排除）
        if (text.includes(',') || text.includes('，')) {
            // 分割并清理每个词
            synonymWords = text.split(/[,，]/).map(w => w.trim()).filter(w => w.length > 0);

            // 如果是排除标签，去掉每个词前面多余的负号（除第一个外）
            if (isExclude && synonymWords.length > 0) {
                synonymWords = synonymWords.map(w => w.startsWith('-') ? w.substring(1) : w).filter(w => w.length > 0);
            }

            if (synonymWords.length > 1) {
                isSynonym = true;
                text = synonymWords.join(', '); // 规范化显示格式
            } else if (synonymWords.length === 1) {
                text = synonymWords[0]; // 只有一个词，不算同义词组
            }
        }

        // Avoid duplicates (taking exclude and synonym status into account for search)
        const exists = this.tags.some(t => {
            const tText = typeof t === 'string' ? t : t.text;
            const tExclude = typeof t === 'string' ? false : t.exclude;
            const tSynonym = typeof t === 'string' ? false : t.synonym;
            return tText === text && tExclude === isExclude && tSynonym === isSynonym;
        });

        if (!exists) {
            const newTag = this.enableExcludes
                ? { text, exclude: isExclude, synonym: isSynonym, synonymWords: isSynonym ? synonymWords : null }
                : text;
            this.tags.push(newTag);
            this.onChange(this.tags);
            this.render();

            // --- 修改开始: 添加这一行 ---
            this.input.focus();
            // --- 修改结束 ---

        }

        // Scroll to keep input in view
        this.input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    removeTag(index) {
        this.tags.splice(index, 1);
        this.onChange(this.tags);
        this.render();
    }

    editTag(index) {
        // 1. If there is text currently in input, tokenize it first (Save it as a capsule)
        const currentInput = this.input.value.trim();
        if (currentInput) {
            this.addTag(currentInput);
        }

        // 2. Get the tag to edit
        const tag = this.tags[index];
        let text = this.enableExcludes ? (tag.exclude ? '-' : '') + tag.text : tag;

        // 3. 【修复】如果是同义词组，将文本转换为紧凑格式（移除逗号后的空格）
        // 这样可以避免在编辑过程中触发空格分割，用户只有在末尾输入空格或按回车时才会形成新胶囊
        text = text.replace(/, /g, ',');

        // 4. Remove it from the list
        this.tags.splice(index, 1);
        this.onChange(this.tags); // Update state immediately (though visual update happens in render)

        // 5. Put text into input and render
        this.input.value = text;
        this.render();
        this.input.focus();
    }

    getStyle(isExclude, isSynonym = false) {
        // 排除+同义词组（交集排除）：橙红色，区分于普通排除
        if (isExclude && isSynonym) return 'bg-orange-100 text-orange-700 border border-orange-300 hover:bg-orange-200';
        if (isExclude) return 'bg-red-100 text-red-600 border border-red-200 hover:bg-red-200';
        if (isSynonym) return 'bg-green-100 text-green-600 border border-green-200 hover:bg-green-200';
        if (this.theme === 'purple') return 'bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200';
        return 'bg-blue-100 text-blue-600 border border-blue-200 hover:bg-blue-200';
    }

    render() {
        // Clear container but keep input if possible, or just rebuild.
        // Rebuilding is safer for order.
        this.container.innerHTML = '';

        this.tags.forEach((tag, idx) => {
            const text = this.enableExcludes ? tag.text : tag;
            const isExclude = this.enableExcludes ? tag.exclude : false;
            const isSynonym = this.enableExcludes ? (tag.synonym || false) : false;

            const capsule = document.createElement('div');
            capsule.className = `tag-capsule flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold cursor-pointer select-none whitespace-nowrap transition-transform active:scale-95 ${this.getStyle(isExclude, isSynonym)}
                                 max-w-full break-all`;
            capsule.classList.remove('whitespace-nowrap');

            // Text Part (Click to Edit)
            const spanText = document.createElement('span');
            // 同义词组显示：排除用-前缀，同义词组用逗号分隔显示
            spanText.textContent = (isExclude ? '-' : '') + text;
            // 为同义词组添加 title 提示
            if (isSynonym) {
                if (isExclude) {
                    // 排除类型的多关键词胶囊：交集排除
                    capsule.title = `交集排除: 同时包含 [${tag.synonymWords.join(' 且 ')}] 的图片才会被排除`;
                } else {
                    // 包含类型的同义词组：OR关系
                    capsule.title = `同义词组: ${tag.synonymWords.join(' | ')}`;
                }
            }
            spanText.onclick = (e) => {
                e.stopPropagation();
                this.editTag(idx);
            };

            // Delete Handle (Click to Remove)
            const spanDel = document.createElement('span');
            spanDel.innerHTML = '&times;';
            spanDel.className = "ml-1 hover:text-black/50 text-lg leading-none px-1 rounded-full hover:bg-black/5 transition-colors";
            spanDel.onclick = (e) => {
                e.stopPropagation();
                this.removeTag(idx);
            };

            capsule.appendChild(spanText);
            capsule.appendChild(spanDel);
            this.container.appendChild(capsule);
        });

        this.container.appendChild(this.input);

        // 当有标签时隐藏 placeholder，节省空间
        this.input.placeholder = this.tags.length > 0 ? '' : this.placeholder;
    }
    
    // External Setters
    setTags(newTags) {
        this.tags = [...newTags];
        this.render();
    }
    
    focus() {
        this.input.focus();
    }
    
    clear() {
        this.tags = [];
        this.input.value = '';
        this.render();
    }
}

class GlobalState {
    constructor() {
        // --- 1. 新增：规则同步与并发控制状态 (Semantic Forest) ---
        // 首次加载生成随机 ID 存入 LocalStorage
        this.clientId = this.getOrGenerateClientId();
        // 从 LocalStorage 读取当前本地规则版本号
        this.rulesBaseVersion = parseInt(localStorage.getItem(RULES_VERSION_KEY) || '0');
        // 存储从后端加载并解析后的同义词规则树结构
        this.rulesTree = null;
        // 存储冲突节点（循环依赖等问题）
        this.conflictNodes = [];
        this.conflictRelations = [];

        // --- 1.1 新增：防抖控制 ---
        this.pendingRulesRender = null; // 用于存储待执行的渲染函数
        this.rulesRenderDebounceMs = 300; // 防抖延迟(毫秒)

        // --- 2. 原有：图片搜索与数据加载状态 (MemeApp State) ---
        this.offset = 0;
        this.limit = 40;
        this.loading = false;
        this.hasMore = true;
        this.totalItems = 0;

        // Search State
        this.queryTags = [];
        this.isTrashMode = false;

        // Tag Data (用于 Datalist 建议)
        this.allKnownTags = [];

        // Settings
        const savedHQ = localStorage.getItem('bqbq_prefer_hq');
        this.sortBy = 'date_desc';
        this.preferHQ = savedHQ === 'true';

        // Temp Panel State (用于临时标签粘贴)
        this.tempTags = [];
        this.isTempTagMode = false; // 新增：用于控制临时标签面板的开关状态

        // --- 新增：标签数量筛选状态 ---
        this.minTags = 0;      // 最小标签数
        this.maxTags = -1;     // 最大标签数 (-1 表示无限制)
        this.isTagCountPanelOpen = false; // 标签数量面板开关状态

        // --- 新增：批量编辑状态 ---
        this.batchEditMode = false; // 是否处于批量编辑模式
        this.selectedGroupIds = new Set(); // 存储已选中的组ID

        // --- 新增：规则树展开状态 ---
        this.expandedGroupIds = this.loadExpandedState(); // 从 sessionStorage 加载展开状态
        this.isTreeDefaultExpanded = true; // 标记是否首次加载（用于默认展开）

        // --- 新增：同义词膨胀功能开关 ---
        this.isExpansionEnabled = this.loadExpansionState(); // 从 sessionStorage 加载，默认开启

        // --- 新增：FAB悬浮按钮组折叠状态 ---
        this.isFabCollapsed = this.loadFabCollapsedState(); // 从 sessionStorage 加载，默认折叠

        // --- 新增：FAB迷你按钮组垂直位置（距离顶部的像素值，null表示使用默认位置24rem=384px） ---
        this.fabMiniTopPosition = this.loadFabMiniPosition();
    }

    /**
     * 从 sessionStorage 加载FAB迷你按钮组位置
     * @returns {number|null} 距离顶部的像素值，null表示使用默认位置
     */
    loadFabMiniPosition() {
        try {
            const saved = sessionStorage.getItem(FAB_MINI_POSITION_KEY);
            if (saved !== null) {
                const pos = parseInt(saved, 10);
                if (!isNaN(pos) && pos >= 0) {
                    return pos;
                }
            }
        } catch (e) {
            console.warn('Failed to load FAB mini position from sessionStorage:', e);
        }
        return null; // 使用默认位置
    }

    /**
     * 保存FAB迷你按钮组位置到 sessionStorage
     */
    saveFabMiniPosition() {
        try {
            if (this.fabMiniTopPosition !== null) {
                sessionStorage.setItem(FAB_MINI_POSITION_KEY, this.fabMiniTopPosition.toString());
            } else {
                sessionStorage.removeItem(FAB_MINI_POSITION_KEY);
            }
        } catch (e) {
            console.warn('Failed to save FAB mini position to sessionStorage:', e);
        }
    }

    /**
     * 从 sessionStorage 加载FAB折叠状态
     * @returns {boolean} FAB是否折叠（默认为 true - 折叠）
     */
    loadFabCollapsedState() {
        try {
            const saved = sessionStorage.getItem(FAB_COLLAPSED_KEY);
            if (saved !== null) {
                return saved === 'true';
            }
        } catch (e) {
            console.warn('Failed to load FAB collapsed state from sessionStorage:', e);
        }
        return true; // 默认折叠
    }

    /**
     * 保存FAB折叠状态到 sessionStorage
     */
    saveFabCollapsedState() {
        try {
            sessionStorage.setItem(FAB_COLLAPSED_KEY, this.isFabCollapsed.toString());
        } catch (e) {
            console.warn('Failed to save FAB collapsed state to sessionStorage:', e);
        }
    }

    /**
     * 从 sessionStorage 加载膨胀功能开关状态
     * @returns {boolean} 膨胀功能是否启用（默认为 true）
     */
    loadExpansionState() {
        try {
            const saved = sessionStorage.getItem('bqbq_expansion_enabled');
            if (saved !== null) {
                return saved === 'true';
            }
        } catch (e) {
            console.warn('Failed to load expansion state from sessionStorage:', e);
        }
        return true; // 默认开启
    }

    /**
     * 保存膨胀功能开关状态到 sessionStorage
     */
    saveExpansionState() {
        try {
            sessionStorage.setItem('bqbq_expansion_enabled', this.isExpansionEnabled.toString());
        } catch (e) {
            console.warn('Failed to save expansion state to sessionStorage:', e);
        }
    }

    /**
     * 从 sessionStorage 加载展开状态
     */
    loadExpandedState() {
        try {
            const saved = sessionStorage.getItem('bqbq_tree_expanded');
            if (saved) {
                return new Set(JSON.parse(saved));
            }
        } catch (e) {
            console.warn('Failed to load expanded state from sessionStorage:', e);
        }
        return new Set();
    }

    /**
     * 保存展开状态到 sessionStorage
     */
    saveExpandedState() {
        try {
            sessionStorage.setItem('bqbq_tree_expanded', JSON.stringify([...this.expandedGroupIds]));
        } catch (e) {
            console.warn('Failed to save expanded state to sessionStorage:', e);
        }
    }

    /**
     * 初始化默认展开状态：如果是首次加载（sessionStorage 中没有数据），则展开所有节点
     * @param {Array} rulesTree - 规则树数据
     */
    initDefaultExpandState(rulesTree) {
        // 检查 sessionStorage 中是否已有保存的展开状态
        const savedState = sessionStorage.getItem('bqbq_tree_expanded');

        // 如果已有保存状态，不做任何处理（使用已保存的状态）
        if (savedState !== null) {
            return;
        }

        // 首次加载：展开所有节点
        if (rulesTree && rulesTree.length > 0) {
            const collectAllIds = (nodes) => {
                nodes.forEach(node => {
                    this.expandedGroupIds.add(node.id);
                    if (node.children && node.children.length > 0) {
                        collectAllIds(node.children);
                    }
                });
            };
            collectAllIds(rulesTree);
            this.saveExpandedState();
            console.log('[initDefaultExpandState] 首次加载，已展开所有节点');
        }
    }

    /**
     * Helper to retrieve or generate a unique Client ID for concurrency control.
     */
    getOrGenerateClientId() {
        let id = localStorage.getItem(CLIENT_ID_KEY);
        if (!id) {
            // 生成一个随机字符串作为唯一标识
            id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            localStorage.setItem(CLIENT_ID_KEY, id);
        }
        return id;
    }
}

class MemeApp {
    constructor() {
        const savedHQ = localStorage.getItem('bqbq_prefer_hq');
        
        this.state = new GlobalState();

        this.dom = {
            grid: document.getElementById('meme-grid'),
            
            // Containers for TagInputs
            headerSearchBar: document.getElementById('header-search-bar'),
            tempTagInputContainer: document.getElementById('temp-tag-input-container'),
            
            // FAB Elements
            fabSearch: document.getElementById('fab-search'),
            fabUpload: document.getElementById('fab-upload'),
            fabHQ: document.getElementById('fab-hq'),
            fabSort: document.getElementById('fab-sort'),
            fabTrash: document.getElementById('fab-trash'),
            fabTemp: document.getElementById('fab-temp-tags'),
            fabTempSlash: document.getElementById('fab-temp-tags-slash'), // 临时标签按钮斜杠
            toggleTempPanelBtn: document.getElementById('toggle-temp-panel-btn'), // 临时标签面板显示/隐藏按钮
            fabTagCount: document.getElementById('fab-tag-count'), // 新增：标签数量筛选按钮
            btnClearSearch: document.getElementById('clear-search-btn'),

            // Indicators / Panels
            hqDot: document.getElementById('hq-status-dot'),
            trashDot: document.getElementById('trash-active-dot'),
            sortMenu: document.getElementById('sort-menu'),
            tempPanel: document.getElementById('temp-tag-panel'),
            tagCountPanel: document.getElementById('tag-count-panel'), // 新增：标签数量面板
            
            fileInput: document.getElementById('file-upload'),
            btnReload: document.getElementById('reload-search-btn'),
            
            loader: document.getElementById('loading-indicator'),
            end: document.getElementById('end-indicator'),

            // --- 新增 Rules Tree 相关的 DOM 元素 ---
            fabTree: document.getElementById('fab-tree'),
            rulesPanel: document.getElementById('rules-tree-panel'),
            rulesTreeContainer: document.getElementById('rules-tree-container'),
            rulesPanelToggleBtn: document.getElementById('rules-panel-toggle-btn'),

            // --- 新增 FAB 折叠相关的 DOM 元素 ---
            fabContainer: document.getElementById('fab-container'),
            fabMiniStrip: document.getElementById('fab-mini-strip'),
            fabToggleBtn: document.getElementById('fab-toggle-btn'),
            fabExpandBtn: document.getElementById('fab-expand-btn'),
            fabMiniClear: document.getElementById('fab-mini-clear'),
            fabMiniReload: document.getElementById('fab-mini-reload'),
            fabMiniSearch: document.getElementById('fab-mini-search'),
        };

        // Initialize Tag Inputs
        this.headerTagInput = null;
        this.tempTagInput = null;

        this.init();
    }

    async init() {
        this.initTagInputs();
        this.updateHQVisuals();
        this.bindEvents(); // All event listeners, including delegated ones

        // --- 初始化FAB折叠状态和位置 ---
        this.updateFabCollapsedVisuals();
        this.initFabMiniPosition();
        this.initFabMiniDrag();

        // --- 初始化规则树水平滚动条同步 ---
        this.initRulesTreeHScrollSync();

        // --- 核心修改：先加载规则树，再加载图片元数据 ---
        await this.loadRulesTree(); // 新增加载规则树的调用
        await this.loadMeta();
        this.loadMore();
    }

    /**
     * 将扁平的 groups, keywords, hierarchy 数据组装成嵌套的 Tree 对象。
     * @param {object} data - 包含 groups, keywords, hierarchy 的扁平数据对象。
     * @returns {Array} 嵌套的树结构数组。
     */

    buildTree(data) {
        if (!data || !data.groups) {
            console.error("Invalid data structure for building tree:", data);
            return { rootNodes: [], conflictNodes: [], conflictRelations: [] };
        }

        const groupsMap = new Map();

        // 1. 初始化所有组节点，并构建 Map 方便查找
        data.groups.forEach(g => {
            groupsMap.set(g.group_id, {
                id: g.group_id,
                name: g.group_name,
                isEnabled: g.is_enabled,
                keywords: [], // 存储关键词对象
                children: [],
                parentIds: [], // 改为数组，支持多父节点检测
                isRoot: true,    // 临时标记
                isConflict: false, // 标记冲突节点
                conflictReason: null // 冲突原因
            });
        });

        // 2. 分配关键词到相应的组
        data.keywords.forEach(k => {
            const groupNode = groupsMap.get(k.group_id);
            if (groupNode) {
                groupNode.keywords.push({
                    text: k.keyword,
                    isEnabled: k.is_enabled
                });
            }
        });

        // 3. 检测循环依赖的辅助函数
        const detectCycle = (startId, targetId, visited = new Set()) => {
            if (startId === targetId) return true;
            if (visited.has(startId)) return false;
            visited.add(startId);

            const node = groupsMap.get(startId);
            if (!node) return false;

            for (const child of node.children) {
                if (detectCycle(child.id, targetId, visited)) return true;
            }
            return false;
        };

        // 4. 构建层级关系，同时检测循环依赖
        const conflictRelations = []; // 记录有问题的关系

        data.hierarchy.forEach(h => {
            const parent = groupsMap.get(h.parent_id);
            const child = groupsMap.get(h.child_id);

            if (!parent || !child) {
                // 孤儿关系：父或子节点不存在
                conflictRelations.push({
                    parent_id: h.parent_id,
                    child_id: h.child_id,
                    reason: `节点不存在: ${!parent ? 'parent_id=' + h.parent_id : ''} ${!child ? 'child_id=' + h.child_id : ''}`,
                    type: 'orphan'
                });
                return;
            }

            // 检测自引用
            if (h.parent_id === h.child_id) {
                conflictRelations.push({
                    parent_id: h.parent_id,
                    child_id: h.child_id,
                    reason: `自引用: 节点 ${h.parent_id} 不能作为自己的父节点`,
                    type: 'self_reference'
                });
                child.isConflict = true;
                child.conflictReason = '自引用';
                return;
            }

            // 检测是否会形成循环（child 是否是 parent 的祖先）
            if (detectCycle(child.id, parent.id, new Set())) {
                conflictRelations.push({
                    parent_id: h.parent_id,
                    child_id: h.child_id,
                    reason: `循环依赖: ${h.child_id} → ${h.parent_id} 会形成环路`,
                    type: 'cycle'
                });
                parent.isConflict = true;
                parent.conflictReason = `循环依赖（与节点 ${h.child_id}）`;
                child.isConflict = true;
                child.conflictReason = `循环依赖（与节点 ${h.parent_id}）`;
                return; // 不添加这个关系
            }

            // 正常添加关系
            parent.children.push(child);
            child.parentIds.push(parent.id);
            child.isRoot = false; // 有父节点，不是根节点
        });

        // 5. 提取根节点（冲突节点也应该正常渲染，只是标记为冲突）
        const rootNodes = [];
        const conflictNodes = [];

        groupsMap.forEach(node => {
            // 清理临时标记
            delete node.isRoot;

            // 收集冲突节点（用于底部警告区域显示）
            if (node.isConflict) {
                conflictNodes.push(node);
            }

            // 根节点判断：没有父节点的就是根节点（包括冲突节点）
            if (node.parentIds.length === 0) {
                rootNodes.push(node);
            }
        });

        // 6. 递归清理子节点的临时标记
        const cleanNode = (node, visited = new Set()) => {
            if (visited.has(node.id)) return; // 防止循环
            visited.add(node.id);

            delete node.isRoot;
            // 保留 parentIds 用于调试，但可以清理
            // delete node.parentIds;
            node.children.forEach(c => cleanNode(c, visited));
        };
        rootNodes.forEach(n => cleanNode(n));

        // 7. 输出日志
        if (conflictRelations.length > 0) {
            console.error("⚠️ 检测到冲突关系:", conflictRelations);
        }
        if (conflictNodes.length > 0) {
            console.error("⚠️ 冲突节点:", conflictNodes.map(n => ({ id: n.id, name: n.name, reason: n.conflictReason })));
        }
        console.log("Tree built.", { rootNodes: rootNodes.length, conflictNodes: conflictNodes.length });

        // 返回包含冲突信息的对象
        return { rootNodes, conflictNodes, conflictRelations };
    }

    /**
     * 根据用户输入的关键词/组名，从规则树中膨胀出所有匹配的同义词。
     * - 命中组名：收集该组及其所有子组的同义词
     * - 命中同义词：收集所在组及其所有子组的同义词（与命中组名等效）
     * @param {string} inputText - 单个用户输入的标签文本。
     * @returns {Array<string>} 膨胀后的同义词数组（包含原始输入）。
     */
    expandSingleKeyword(inputText) {
        // 如果膨胀功能关闭，直接返回原始输���
        if (!this.state.isExpansionEnabled) {
            return [inputText];
        }

        if (!this.state.rulesTree) return [inputText];

        const uniqueKeywords = new Set();
        uniqueKeywords.add(inputText); // 始终包含原始输入

        /**
         * 递归收集组及其所有子组下的同义词。
         * @param {Object} node - 当前组节点。
         */
        const recursivelyCollectKeywords = (node) => {
            // 只收集启用组的启用同义词
            if (!node.isEnabled) return;

            node.keywords
                .filter(k => k.isEnabled)
                .forEach(k => uniqueKeywords.add(k.text));

            // 递归进入子组
            node.children.forEach(recursivelyCollectKeywords);
        };

        // 遍历整个规则树进行匹配
        const traverseAndMatch = (nodes) => {
            nodes.forEach(node => {
                if (!node.isEnabled) return; // 跳过禁用的组

                // 1. 检查是否直接命中组名
                if (node.name === inputText) {
                    recursivelyCollectKeywords(node);
                    return;
                }

                // 2. 检查是否命中同义词 - 如果命中，则收集所在组及其所有子组的同义词
                const matchedKeyword = node.keywords.find(k => k.text === inputText && k.isEnabled);
                if (matchedKeyword) {
                    // 命中同义词时，膨胀为该组及其所有子组的所有同义词
                    recursivelyCollectKeywords(node);
                    return; // 找到匹配后不再继续检查此节点的子节点（避免重复）
                }

                // 3. 递归检查子节点
                traverseAndMatch(node.children);
            });
        };

        traverseAndMatch(this.state.rulesTree);

        return Array.from(uniqueKeywords);
    }

    /**
     * 批量膨胀多个标签，返回二维数组格式。
     * 每个输入标签膨胀后的同义词组作为一个并集（组内OR），不同组之间做交集（组间AND）。
     * @param {Array<string>} inputs - 用户输入的标签数组。
     * @returns {Array<Array<string>>} 二维数组，每个子数组是一个标签膨胀后的同义词列表。
     */
    expandKeywordsToGroups(inputs) {
        return inputs.map(input => this.expandSingleKeyword(input));
    }

    /**
     * 核心：处理规则树的写入操作，包含乐观锁、冲突检测和自动重放。
     * @param {object} action - 包含 url 和 method 的操作定义。
     * @param {object} payload - 包含 group_id, keyword 等业务参数。
     * @param {number} retryCount - 当前重试次数（防止无限递归）
     * @returns {Promise<object>} 包含 success 状态和 version_id 的结果对象。
     */

    async handleSave(action, payload, retryCount = 0) {
        const MAX_RETRIES = 3; // 最大重试次数

        // 防止无限递归
        if (retryCount >= MAX_RETRIES) {
            console.error(`Max retries (${MAX_RETRIES}) exceeded for action ${action.type}`);
            this.showToast('保存失败：冲突次数过多，请稍后重试。', 'error');
            await this.loadRulesTree(true); // 强制同步最新数据
            return { success: false, error: 'max_retries_exceeded' };
        }

        let currentVersion = this.state.rulesBaseVersion;
        const client_id = this.state.clientId;

        const actionType = action.type; // 新增：用于识别操作类型

        // --- 1. 乐观更新 ---
        const optimisticSuccess = this.updateRulesTreeOptimistically(actionType, payload);
        if (optimisticSuccess) {
            this.renderRulesTree(); // 渲染新的本地状态
        }

        try {
            const response = await fetch(action.url, {
                method: action.method,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    ...payload,
                    base_version: currentVersion,
                    client_id: client_id
                })
            });

            if (response.status === 409) {
                const conflictData = await response.json();
                console.warn(`Conflict detected (retry ${retryCount + 1}/${MAX_RETRIES})! Base version ${currentVersion}, server has updated. Unique modifiers: ${conflictData.unique_modifiers}`);

                // --- 冲突处理 (409) ---

                // A. 静默更新基准数据
                this.state.rulesBaseVersion = conflictData.latest_data.version_id;
                localStorage.setItem(RULES_VERSION_KEY, conflictData.latest_data.version_id.toString());

                // 重新构建本地规则树 (使用服务器最新的数据)
                const buildResult = this.buildTree(conflictData.latest_data);
                this.state.rulesTree = buildResult.rootNodes;
                this.state.conflictNodes = buildResult.conflictNodes;
                this.state.conflictRelations = buildResult.conflictRelations;

                // B. 预演/检查有效性
                const stillValid = this.checkIfActionStillValid(actionType, payload, buildResult.rootNodes);

                if (stillValid) {
                    // C. 自动重放（递归调用，但带重试计数）
                    console.log(`Action still valid, attempting automatic replay (attempt ${retryCount + 1}/${MAX_RETRIES})`);

                    const replayResult = await this.handleSave(action, payload, retryCount + 1);

                    if (replayResult.success) {
                        // 提示用户合并成功
                        this.showToast(`已自动同步并保存成功！期间有 ${conflictData.unique_modifiers} 人修改过规则。`, 'success');
                    }
                    return replayResult;

                } else {
                    // D. 预演无效，强制刷新 UI 为最新数据
                    console.error("Action is no longer valid. Forcing UI refresh.");
                    this.renderRulesTree(); // 刷新 UI 到服务器最新状态
                    alert(`保存失败！您尝试的操作不再有效，请刷新页面重新编辑。期间有 ${conflictData.unique_modifiers} 人修改过规则。`);
                    return { success: false, conflict: true };
                }

            }

            if (response.ok) {
                const result = await response.json();

                // 2. 写入成功，更新本地版本号
                this.state.rulesBaseVersion = result.version_id;
                localStorage.setItem(RULES_VERSION_KEY, result.version_id.toString());

                console.log(`Save successful. New version: ${result.version_id}`);

                // 3. 关键修复：强制重新加载规则树数据并更新本地缓存
                // 这样刷新页面时 304 返回后能从缓存加载最新数据
                await this.loadRulesTree(true);

                if (retryCount === 0) {
                    this.showToast('规则保存成功！', 'success');
                } // 重试成功的提示已在上面的冲突处理中显示

                return { success: true, version_id: result.version_id, new_id: result.new_id };
            }

            throw new Error(`Server returned error status: ${response.status}`);

        } catch (e) {
            console.error("Save failed (final):", e);
            // E. 最终失败，回滚本地乐观更新 (如果需要)
            // this.revertOptimisticUpdate(actionType, payload);
            this.debouncedRenderRulesTree(); // 使用防抖版本刷新

            this.showToast('保存失败：网络或服务器错误。', 'error');
            return { success: false, error: e.message };
        }
    }
            

    // 新增方法：负责筛选标签和更新 datalist
    filterAndUpdateDatalist(currentInput) {
        const dl = document.getElementById('tag-suggestions');
        if (!dl) return;

        const MAX_SUGGESTIONS = 4;

        // 检测是否以负号开头（排除标签）
        const isExclude = currentInput.startsWith('-');
        const prefix = isExclude ? '-' : '';
        // 去掉负号前缀后的实际搜索内容
        const searchText = isExclude ? currentInput.slice(1) : currentInput;

        // 特殊处理：当输入以 . 开头时（或 -. 开头），显示扩展名建议
        if (searchText.startsWith('.')) {
            const partialExt = searchText.slice(1).toLowerCase();
            const extensionSuggestions = SUPPORTED_EXTENSIONS
                .filter(ext => ext.startsWith(partialExt))
                .map(ext => `${prefix}.${ext}`);
            dl.innerHTML = extensionSuggestions.map(t => `<option value="${t}">`).join('');
            return;
        }

        // 1. 根据当前输入进行动态筛选 (不区分大小写，包含匹配)
        const filtered = this.state.allKnownTags.filter(tag =>
            tag.toLowerCase().includes(searchText.toLowerCase())
        );

        // 2. 限制最多只显示 MAX_SUGGESTIONS 个
        const limitedTags = filtered.slice(0, MAX_SUGGESTIONS);

        // 3. 更新 datalist 的内容（如果是排除模式，添加负号前缀）
        dl.innerHTML = limitedTags.map(t => `<option value="${prefix}${t}">`).join('');
    }

    initTagInputs() {
        // 1. Header Search Bar
        this.headerTagInput = new TagInput({
            container: this.dom.headerSearchBar,
            suggestionsId: 'tag-suggestions',
            placeholder: '输入关键词 (空格生成胶囊)...',
            theme: 'mixed',
            enableExcludes: true,
            onChange: (tags) => {
                this.state.queryTags = tags;
                // 自动检测 trash_bin 标签来更新回收站模式视觉状态
                const hasTrash = tags.some(t => t.text === 'trash_bin' && !t.exclude);
                if (this.state.isTrashMode !== hasTrash) {
                    this.state.isTrashMode = hasTrash;
                    this.updateTrashVisuals();
                }
            },
            onSubmit: () => this.doSearch(),
            // --- NEW: 传递动态筛选方法给 TagInput ---
            onInputUpdate: (val) => this.filterAndUpdateDatalist(val)
            // ----------------------------------------
        });

        // 2. Temp Tag Panel
        this.tempTagInput = new TagInput({
            container: this.dom.tempTagInputContainer,
            suggestionsId: 'tag-suggestions', // Enable Autocomplete for temp tags too!
            placeholder: '输入临时标签...',
            theme: 'purple',
            enableExcludes: false,
            onChange: (tags) => {
                this.state.tempTags = tags;
            },
            // --- NEW: 传递动态筛选方法给 TagInput ---
            onInputUpdate: (val) => this.filterAndUpdateDatalist(val)
            // ----------------------------------------
        });
    }

    bindEvents() {
        // --- FAB Actions ---
        this.dom.fabSearch.onclick = () => {
            this.headerTagInput.focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        this.dom.btnClearSearch.onclick = (e) => {
            e.stopPropagation();
            this.headerTagInput.clear();
            this.state.queryTags = [];
            // 清空搜索时重置回收站模式
            this.state.isTrashMode = false;
            this.updateTrashVisuals();
            this.doSearch();
        };

        this.dom.fabHQ.onclick = () => {
            this.state.preferHQ = !this.state.preferHQ;
            localStorage.setItem('bqbq_prefer_hq', this.state.preferHQ);
            this.updateHQVisuals();
            this.resetSearch();
        };

        this.dom.fabSort.onclick = (e) => {
            e.stopPropagation();
            this.dom.sortMenu.classList.toggle('hidden');
            this.dom.sortMenu.classList.toggle('flex');
        };

        this.dom.fabTrash.onclick = () => {
            // 通过添加/移除 trash_bin 标签来切换回收站模式
            const hasTrash = this.state.queryTags.some(t => t.text === 'trash_bin');
            if (hasTrash) {
                // 移除 trash_bin 标签
                const idx = this.state.queryTags.findIndex(t => t.text === 'trash_bin');
                if (idx !== -1) this.headerTagInput.removeTag(idx);
            } else {
                // 添加 trash_bin 标签
                this.headerTagInput.addTag('trash_bin');
            }
            // 状态更新由 TagInput 的 onChange 回调处理
            this.doSearch();
        };

        this.dom.fabTemp.onclick = () => {
            this.state.isTempTagMode = !this.state.isTempTagMode;
            this.updateTempTagModeVisuals();
            // 显示状态提示
            const statusText = this.state.isTempTagMode ? '已进入批量打标模式' : '已退出批量打标模式';
            this.showToast(statusText, this.state.isTempTagMode ? 'success' : 'info');
        };

        // --- 新增：临时标签面板显示/隐藏按钮事件 ---
        this.dom.toggleTempPanelBtn.onclick = () => {
            const isOpen = !this.dom.tempPanel.classList.contains('hidden');
            if (isOpen) {
                this.dom.tempPanel.classList.add('hidden');
                this.dom.tempPanel.classList.remove('flex');
            } else {
                this.dom.tempPanel.classList.remove('hidden');
                this.dom.tempPanel.classList.add('flex');
                this.tempTagInput.focus();
            }
        };

        // --- 新增：FAB悬浮按钮组折叠/展开事件 ---
        if (this.dom.fabToggleBtn) {
            this.dom.fabToggleBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleFabCollapsed();
            };
        }

        // fab-expand-btn 的点击和拖拽事件在 initFabMiniDrag 中统一处理

        // 折叠状态下的迷你按钮事件
        if (this.dom.fabMiniClear) {
            this.dom.fabMiniClear.onclick = (e) => {
                e.stopPropagation();
                this.headerTagInput.clear();
                this.state.queryTags = [];
                this.state.isTrashMode = false;
                this.updateTrashVisuals();
                this.doSearch();
            };
        }

        if (this.dom.fabMiniReload) {
            this.dom.fabMiniReload.onclick = (e) => {
                e.stopPropagation();
                this.resetSearch();
            };
        }

        if (this.dom.fabMiniSearch) {
            this.dom.fabMiniSearch.onclick = (e) => {
                e.stopPropagation();
                this.headerTagInput.focus();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
        }

        // --- 新增：标签数量筛选按钮事件 ---
        this.dom.fabTagCount.onclick = () => {
            this.state.isTagCountPanelOpen = !this.state.isTagCountPanelOpen;
            if (this.state.isTagCountPanelOpen) {
                this.dom.tagCountPanel.classList.remove('hidden');
                this.dom.tagCountPanel.classList.add('flex');
                this.dom.fabTagCount.classList.add('bg-cyan-100', 'border-cyan-300');
            } else {
                this.dom.tagCountPanel.classList.add('hidden');
                this.dom.tagCountPanel.classList.remove('flex');
                this.dom.fabTagCount.classList.remove('bg-cyan-100', 'border-cyan-300');
            }
        };

        // 初始化标签数量筛选滑块
        this.initTagCountSlider();

        // =========================================================================
        // --- 新增：规则树侧边栏事件 ---
        // =========================================================================

        // FAB Tree: 切换同义词膨胀功能开关
        this.dom.fabTree.onclick = () => {
            this.toggleExpansionMode();
        };

        // 初始化膨胀功能按钮的视觉状态
        this.updateExpansionButtonVisuals();

        // 初始化临时标签模式按钮的视觉状态
        this.updateTempTagModeVisuals();

        // 侧边栏展开/折叠按钮事件（统一按钮）
        if (this.dom.rulesPanelToggleBtn) {
            this.dom.rulesPanelToggleBtn.onclick = () => {
                this.toggleRulesPanel();
            };
        }

        // Rules Panel Backdrop: 点击侧边栏外部区域（如果实现）或侧边栏内部关闭（如果添加按钮）

        // 规则树搜索
        const treeSearchInput = document.getElementById('rules-tree-search');
        const treeSearchClearBtn = document.getElementById('rules-tree-search-clear');

        if (treeSearchInput) {
            treeSearchInput.addEventListener('input', (e) => {
                this.filterRulesTree(e.target.value);
                // 显示/隐藏清空按钮
                if (treeSearchClearBtn) {
                    treeSearchClearBtn.classList.toggle('hidden', !e.target.value);
                }
            });
        }

        if (treeSearchClearBtn) {
            treeSearchClearBtn.onclick = () => {
                if (treeSearchInput) {
                    treeSearchInput.value = '';
                    treeSearchInput.focus();
                    this.filterRulesTree('');
                }
                treeSearchClearBtn.classList.add('hidden');
            };
        }

        // --- 批量编辑模式按钮事件绑定 ---
        const batchModeBtn = document.getElementById('batch-mode-btn');
        if (batchModeBtn) {
            batchModeBtn.onclick = () => this.toggleBatchMode();
        }

        // --- 刷新规则树按钮事件绑定 ---
        const refreshRulesBtn = document.getElementById('refresh-rules-btn');
        if (refreshRulesBtn) {
            refreshRulesBtn.onclick = () => this.refreshRulesTree();
        }

        // --- 批量操作工具栏按钮事件绑定 ---
        const batchSelectAll = document.getElementById('batch-select-all');
        const batchEnableBtn = document.getElementById('batch-enable-btn');
        const batchDisableBtn = document.getElementById('batch-disable-btn');
        const batchDeleteBtn = document.getElementById('batch-delete-btn');

        if (batchSelectAll) batchSelectAll.onclick = () => this.toggleSelectAll();
        if (batchEnableBtn) batchEnableBtn.onclick = () => this.batchEnableGroups();
        if (batchDisableBtn) batchDisableBtn.onclick = () => this.batchDisableGroups();
        if (batchDeleteBtn) batchDeleteBtn.onclick = () => this.batchDeleteGroups();

        // --- 展开/折叠全部按钮事件绑定 ---
        const expandAllBtn = document.getElementById('expand-all-btn');
        const collapseAllBtn = document.getElementById('collapse-all-btn');

        if (expandAllBtn) expandAllBtn.onclick = () => this.expandAllGroups();
        if (collapseAllBtn) collapseAllBtn.onclick = () => this.collapseAllGroups();

        // --- 添加新组按钮事件绑定 ---
        const addRootGroupBtn = document.getElementById('add-root-group-btn');
        if (addRootGroupBtn) addRootGroupBtn.onclick = () => this.showAddGroupDialog();

        // Rules Tree Toggle: 树状结构节点展开/收起（事件委托）
        this.dom.rulesTreeContainer.addEventListener('click', (e) => {
            // 处理复选框点击（批量编辑模式）
            if (e.target.classList.contains('batch-checkbox')) {
                e.stopPropagation();
                const groupId = parseInt(e.target.dataset.groupId);
                if (groupId) {
                    this.toggleGroupSelection(groupId);
                }
                return;
            }

            const headerEl = e.target.closest('.group-header');
            if (headerEl) {
                const groupNode = headerEl.closest('.group-node');
                if (groupNode) {
                    // 批量编辑模式下点击由 header.onclick 处理，这里只处理非批量模式的委托事件
                    // 由于 header 已经有自己的 onclick 处理，这里的委托事件主要做兼容
                    if (!this.state.batchEditMode) {
                        // 切换关键字和子节点容器的显示状态
                        const keywordsContainer = groupNode.querySelector('.flex.flex-wrap.gap-1');
                        const childrenContainer = groupNode.querySelector('.ml-4.border-l');

                        if (keywordsContainer) keywordsContainer.classList.toggle('hidden');
                        if (childrenContainer) childrenContainer.classList.toggle('hidden');

                        // 切换 Chevron 图标方向
                        const chevron = headerEl.querySelector('[data-lucide="chevron-down"]');
                        if (chevron) {
                            chevron.classList.toggle('rotate-180');
                        }
                    }
                }
            }
        });

        // --- Temp Panel Logic ---
        document.getElementById('close-temp-panel').onclick = () => {
            this.dom.tempPanel.classList.add('hidden');
            this.dom.tempPanel.classList.remove('flex');
        };
        document.getElementById('clear-temp-tags').onclick = () => {
            this.tempTagInput.clear();
        };

        // --- Sort Menu ---
        document.querySelectorAll('.sort-option').forEach(btn => {
            btn.onclick = () => {
                this.state.sortBy = btn.dataset.sort;
                // Visual update
                document.querySelectorAll('.sort-option').forEach(b => {
                    b.classList.remove('text-blue-600', 'font-bold');
                    b.classList.add('text-slate-600');
                });
                btn.classList.add('text-blue-600', 'font-bold');
                btn.classList.remove('text-slate-600');
                
                this.dom.sortMenu.classList.add('hidden');
                this.dom.sortMenu.classList.remove('flex');
                this.resetSearch();
            };
        });

        // --- Common ---
        this.dom.fabUpload.onclick = () => this.dom.fileInput.click();
        this.dom.fileInput.onchange = (e) => this.handleUpload(e.target.files);

        // 导出按钮
        const fabExport = document.getElementById('fab-export');
        if (fabExport) {
            fabExport.addEventListener('click', () => {
                this.exportAllData();
            });
        }

        // 导入按钮
        const fabImport = document.getElementById('fab-import');
        const jsonInput = document.getElementById('json-import-input');

        if (fabImport && jsonInput) {
            fabImport.addEventListener('click', () => {
                jsonInput.click();
            });

            jsonInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                    await this.importAllData(file);
                    e.target.value = ''; // 清空以允许重复选择同一文件
                }
            });
        }

        this.dom.btnReload.onclick = (e) => {
            e.stopPropagation();
            this.resetSearch();
        };

        // Close menus when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.dom.sortMenu.contains(e.target) && !this.dom.fabSort.contains(e.target)) {
                this.dom.sortMenu.classList.add('hidden');
                this.dom.sortMenu.classList.remove('flex');
            }
        });

        // Infinite Scroll
        this.dom.grid.parentElement.addEventListener('scroll', () => {
            const el = this.dom.grid.parentElement;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
                this.loadMore();
            }
        });
        
        // =========================================================================
        // --- 3. 优化 JS 事件：事件委托模型 (Event Delegation) ---
        // =========================================================================
        this.dom.grid.addEventListener('click', (e) => {
            const target = e.target;
            
            // 查找最近的卡片父元素
            const cardEl = target.closest('.meme-card');
            if (!cardEl) return;
            
            // 提取图片数据（假设数据存储在 data-* 属性中）
            const md5 = cardEl.dataset.md5;
            if (!md5) return;
            
            const imgEl = cardEl.querySelector('.image-element');
            const tagsContainer = cardEl.querySelector('.tags-container-element');
            // 只需要解析一次数据
            const infoEl = JSON.parse(cardEl.dataset.info || '{}'); 
            
            if (!imgEl || !tagsContainer) return; // Basic elements must exist
            
            // --- A. 图片点击 (Load Original or Apply Temp Tags) ---
            if (target.classList.contains('image-element') || target.closest('.error-overlay')) {
                const originalSrc = imgEl.dataset.original;
                const currentSrc = imgEl.src;
                
                // Remove error overlay if present (in case of retry click)
                const existingError = cardEl.querySelector('.error-overlay');
                if (existingError) existingError.remove();

                if (this.state.isTempTagMode) {
                    // This function needs the full imgData, which is lost. 
                    // We must pass the parsed info.
                    this.applyTempTags(infoEl, cardEl, tagsContainer);
                    return;
                }
                
                // Normal Mode: Load original if not already (or if it failed before)
                if (originalSrc && currentSrc !== originalSrc) {
                    this.loadOriginalImage(originalSrc, imgEl, cardEl);
                }
            }
            
            // --- B. 标签区域点击 (Start Edit Mode) ---
            // 检查点击目标是否位于 tags-container-element 或其子元素内
            if (target.closest('.tags-container-element')) {
                // 获取当前显示的标签列表（用于编辑）
                const currentTags = Array.from(tagsContainer.querySelectorAll('.overlay-tag')).map(el => el.textContent);
                
                // 构造一个临时的 imgData 对象，只包含 startOverlayEdit 需要的属性
                const tempImgData = { 
                    md5: infoEl.md5, 
                    tags: currentTags, 
                    is_trash: infoEl.is_trash || false
                };

                this.startOverlayEdit(tempImgData, cardEl, cardEl.querySelector('.image-overlay'), tagsContainer);
            }
            
            // --- D. 复制按钮 (Copied button logic from createIconBtn)
            if (target.closest('.copy-btn')) {
                 // 找到按钮本身
                const btnCopy = target.closest('.copy-btn');
                this.copyText(infoEl.filename, btnCopy);
            }

            // E. 删除/恢复按钮 (Copied button logic from createIconBtn)
            if (target.closest('.delete-btn')) {
                e.stopPropagation();
                // 构造一个临时的 imgData 对象，只包含 toggleTrash 需要的属性
                const currentTagsInDOM = Array.from(tagsContainer.querySelectorAll('.overlay-tag')).map(el => el.textContent);

                const tempImgData = { 
                    md5: infoEl.md5, 
                    tags: currentTagsInDOM,
                    is_trash: infoEl.is_trash || false,
                };
                
                this.toggleTrash(tempImgData, cardEl, target.closest('.delete-btn'), e);
            }
        });


    }
    // End of bindEvents
    
    // NEW FUNCTION: Handles loading of original image with loading indicator and retry logic
    loadOriginalImage(originalSrc, imgEl, cardEl) {
        // 1. Remove any previous error overlays
        const existingError = cardEl.querySelector('.error-overlay');
        if (existingError) existingError.remove();

        // 2. Show loader
        const loader = cardEl.querySelector('.loader-element');
        if(loader) loader.classList.remove('hidden');

        const tempImg = new Image();
        
        tempImg.onload = () => {
            // SUCCESS: Replace image source and hide loader
            imgEl.src = originalSrc;
            if(loader) loader.classList.add('hidden');
            // Remove error status if it was previously set
            imgEl.classList.remove('opacity-50', 'grayscale', 'cursor-pointer');
            cardEl.classList.remove('load-failed');
        };
        
        tempImg.onerror = () => {
            // ERROR: Hide loader, show error overlay (Fixing bug by ensuring loader is hidden on error)
            if(loader) loader.classList.add('hidden'); 
            
            // Prevent endless load retries if image element itself is failing
            imgEl.classList.add('opacity-50', 'grayscale'); 
            cardEl.classList.add('load-failed');

            // Insert Error Overlay
            const errorOverlay = document.createElement('div');
            // MODIFIED: 移除 bg-red-800/70 红色遮罩，只保留居中布局和文字/图标
            errorOverlay.className = "error-overlay absolute inset-0 text-red-500 flex flex-col items-center justify-center text-center p-4 z-20 cursor-pointer rounded-xl transition-opacity hover:opacity-90";
            errorOverlay.innerHTML = `
                <!-- MODIFIED: 使用 Alert SVG 图标 (w-10 h-10) -->
                ${SVG_ICONS.alert.replace('w-10 h-10', 'w-10 h-10')}
            `;
            
            // The click handler will be managed by the delegated event in bindEvents (target.closest('.error-overlay'))
            
            cardEl.appendChild(errorOverlay);
        };
        
        // Start loading
        tempImg.src = originalSrc;
    }

    doSearch() {
        this.resetSearch();
    }

    // --- Visual Updates ---

    updateHQVisuals() {
        if (this.state.preferHQ) {
            this.dom.hqDot.classList.remove('bg-slate-300');
            this.dom.hqDot.classList.add('bg-blue-600');
            this.dom.fabHQ.classList.add('text-blue-600', 'border-blue-200');
        } else {
            this.dom.hqDot.classList.add('bg-slate-300');
            this.dom.hqDot.classList.remove('bg-blue-600');
            this.dom.fabHQ.classList.remove('text-blue-600', 'border-blue-200');
        }
    }

    updateTrashVisuals() {
        if (this.state.isTrashMode) {
            this.dom.fabTrash.classList.add('text-red-500', 'bg-red-50', 'border-red-200');
            this.dom.trashDot.classList.remove('hidden');
            this.dom.grid.classList.add('trash-mode-active');
        } else {
            this.dom.fabTrash.classList.remove('text-red-500', 'bg-red-50', 'border-red-200');
            this.dom.trashDot.classList.add('hidden');
            this.dom.grid.classList.remove('trash-mode-active');
        }
    }

    // --- 新增：同义词膨胀功能开关 ---

    /**
     * 切换同义词膨胀功能的开启/关闭状态
     */
    toggleExpansionMode() {
        this.state.isExpansionEnabled = !this.state.isExpansionEnabled;
        this.state.saveExpansionState();
        this.updateExpansionButtonVisuals();

        // 显示状态提示
        const statusText = this.state.isExpansionEnabled ? '同义词膨胀已开启' : '同义词膨胀已关闭';
        this.showToast(statusText, this.state.isExpansionEnabled ? 'success' : 'info');

        // 如果有搜索条件，重新执行搜索以应用新的膨胀设置
        if (this.state.queryTags.length > 0) {
            this.resetSearch();
        }
    }

    /**
     * 更新膨胀功能按钮的视觉状态
     */
    updateExpansionButtonVisuals() {
        const slashEl = document.getElementById('fab-tree-slash');

        if (this.state.isExpansionEnabled) {
            // 膨胀功能开启：绿色高亮
            this.dom.fabTree.classList.add('bg-green-100', 'border-green-400', 'text-green-700');
            this.dom.fabTree.classList.remove('bg-white', 'border-yellow-300', 'text-yellow-600');
            this.dom.fabTree.title = '同义词膨胀：已开启（点击关闭）';
            // 隐藏斜杠
            if (slashEl) {
                slashEl.classList.add('hidden');
                slashEl.classList.remove('flex');
            }
        } else {
            // 膨胀功能关闭：白色背景，黄色图标，红色斜杠
            this.dom.fabTree.classList.remove('bg-green-100', 'border-green-400', 'text-green-700');
            this.dom.fabTree.classList.add('bg-white', 'border-yellow-300', 'text-yellow-600');
            this.dom.fabTree.title = '同义词膨胀：已关闭（点击开启）';
            // 显示斜杠
            if (slashEl) {
                slashEl.classList.remove('hidden');
                slashEl.classList.add('flex');
            }
        }
    }

    /**
     * 更新临时标签模式按钮的视觉状态
     */
    updateTempTagModeVisuals() {
        const slashEl = this.dom.fabTempSlash;

        if (this.state.isTempTagMode) {
            // 批量打标模式开启：紫色高亮
            this.dom.fabTemp.classList.add('bg-purple-100', 'border-purple-400', 'text-purple-700');
            this.dom.fabTemp.classList.remove('bg-white', 'border-purple-100', 'text-purple-600');
            this.dom.fabTemp.title = '批量打标粘贴模式：已开启（点击关闭）';
            // 隐藏斜杠
            if (slashEl) {
                slashEl.classList.add('hidden');
                slashEl.classList.remove('flex');
            }
        } else {
            // 批量打标模式关闭：白色背景，紫色图标，红色斜杠
            this.dom.fabTemp.classList.remove('bg-purple-100', 'border-purple-400', 'text-purple-700');
            this.dom.fabTemp.classList.add('bg-white', 'border-purple-100', 'text-purple-600');
            this.dom.fabTemp.title = '批量打标粘贴模式：已关闭（点击开启）';
            // 显示斜杠
            if (slashEl) {
                slashEl.classList.remove('hidden');
                slashEl.classList.add('flex');
            }
        }
    }

    /**
     * 切换FAB悬浮按钮组的折叠/展开状态
     */
    toggleFabCollapsed() {
        this.state.isFabCollapsed = !this.state.isFabCollapsed;
        this.state.saveFabCollapsedState();
        this.updateFabCollapsedVisuals();
    }

    /**
     * 更新FAB悬浮按钮组的折叠/展开视觉状态
     */
    updateFabCollapsedVisuals() {
        if (this.state.isFabCollapsed) {
            // 折叠状态：隐藏主容器，显示迷你按钮条
            this.dom.fabContainer.classList.add('hidden');
            this.dom.fabMiniStrip.classList.remove('hidden');
        } else {
            // 展开状态：显示主容器，隐藏迷你按钮条
            this.dom.fabContainer.classList.remove('hidden');
            this.dom.fabMiniStrip.classList.add('hidden');
        }
    }

    /**
     * 初始化FAB迷你按钮组的位置
     */
    initFabMiniPosition() {
        const savedPosition = this.state.fabMiniTopPosition;
        if (savedPosition !== null) {
            this.dom.fabMiniStrip.style.top = `${savedPosition}px`;
        }
    }

    /**
     * 初始化FAB迷你按钮组的拖拽功能（绑定到展开按钮，同时支持点击和拖拽）
     */
    initFabMiniDrag() {
        const expandBtn = this.dom.fabExpandBtn;
        const miniStrip = this.dom.fabMiniStrip;

        if (!expandBtn || !miniStrip) return;

        let isDragging = false;
        let hasMoved = false; // 用于区分点击和拖拽
        let startY = 0;
        let startTop = 0;
        let dragStartTime = 0;

        const DRAG_THRESHOLD = 5; // 移动超过5px才算拖拽

        const handlePointerDown = (e) => {
            // 记录起始位置
            isDragging = true;
            hasMoved = false;
            dragStartTime = Date.now();
            startY = e.clientY || (e.touches && e.touches[0].clientY);

            // 获取当前 top 值
            const rect = miniStrip.getBoundingClientRect();
            startTop = rect.top;

            // 防止文本选择
            e.preventDefault();
        };

        const handlePointerMove = (e) => {
            if (!isDragging) return;

            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            const deltaY = clientY - startY;

            // 判断是否超过拖拽阈值
            if (Math.abs(deltaY) > DRAG_THRESHOLD) {
                hasMoved = true;
            }

            if (!hasMoved) return;

            let newTop = startTop + deltaY;

            // 限制范围：最小 80px（顶部），最大为视窗高度减去按钮组高度
            const minTop = 80;
            const maxTop = window.innerHeight - miniStrip.offsetHeight - 16;
            newTop = Math.max(minTop, Math.min(maxTop, newTop));

            miniStrip.style.top = `${newTop}px`;
        };

        const handlePointerUp = (e) => {
            if (!isDragging) return;

            isDragging = false;

            if (hasMoved) {
                // 是拖拽操作，保存位置
                const rect = miniStrip.getBoundingClientRect();
                const topPosition = Math.round(rect.top);
                this.state.fabMiniTopPosition = topPosition;
                this.state.saveFabMiniPosition();
            } else {
                // 是点击操作，展开FAB
                this.toggleFabCollapsed();
            }
        };

        // 鼠标事件
        expandBtn.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('mousemove', handlePointerMove);
        document.addEventListener('mouseup', handlePointerUp);

        // 触摸事件
        expandBtn.addEventListener('touchstart', (e) => {
            handlePointerDown(e);
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            handlePointerMove(e);
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            handlePointerUp(e);
        });
    }

    /**
     * 初始化规则树自定义滚动条（支持 Pointer Capture，解决触屏拖拽丢失问题）
     */
    initRulesTreeHScrollSync() {
        const wrapper = document.getElementById('rules-tree-scroll-wrapper');
        const content = document.getElementById('rules-tree-content');
        const container = document.getElementById('rules-tree-container');

        if (!wrapper || !content || !container) return;

        // 创建自定义滚动条元素
        const vScrollbar = document.createElement('div');
        vScrollbar.className = 'custom-scrollbar-v';
        vScrollbar.innerHTML = '<div class="scrollbar-track"></div><div class="scrollbar-thumb"></div>';

        const hScrollbar = document.createElement('div');
        hScrollbar.className = 'custom-scrollbar-h';
        hScrollbar.innerHTML = '<div class="scrollbar-track"></div><div class="scrollbar-thumb"></div>';

        const corner = document.createElement('div');
        corner.className = 'scrollbar-corner';

        wrapper.appendChild(vScrollbar);
        wrapper.appendChild(hScrollbar);
        wrapper.appendChild(corner);

        const vThumb = vScrollbar.querySelector('.scrollbar-thumb');
        const hThumb = hScrollbar.querySelector('.scrollbar-thumb');

        // 更新滑块位置和大小
        const updateScrollbars = () => {
            const contentHeight = container.scrollHeight;
            const viewportHeight = content.clientHeight;

            // 垂直滚动条
            if (contentHeight > viewportHeight) {
                vScrollbar.style.display = 'block';
                const trackHeight = vScrollbar.clientHeight;
                const thumbHeight = Math.max(30, (viewportHeight / contentHeight) * trackHeight);
                const scrollRatio = content.scrollTop / (contentHeight - viewportHeight);
                const thumbTop = scrollRatio * (trackHeight - thumbHeight);

                vThumb.style.height = `${thumbHeight}px`;
                vThumb.style.top = `${thumbTop}px`;
            } else {
                vScrollbar.style.display = 'none';
            }

            // 水平滚动条 - 使用 content.scrollWidth
            const contentWidth = content.scrollWidth;
            const viewportWidth = content.clientWidth;

            if (contentWidth > viewportWidth) {
                hScrollbar.style.display = 'block';
                const trackWidth = hScrollbar.clientWidth;
                const thumbWidth = Math.max(30, (viewportWidth / contentWidth) * trackWidth);
                const scrollRatio = content.scrollLeft / (contentWidth - viewportWidth);
                const thumbLeft = scrollRatio * (trackWidth - thumbWidth);

                hThumb.style.width = `${thumbWidth}px`;
                hThumb.style.left = `${thumbLeft}px`;
            } else {
                hScrollbar.style.display = 'none';
            }

            // 角落显示（两个滚动条都显示时才显示角落）
            corner.style.display = (vScrollbar.style.display !== 'none' && hScrollbar.style.display !== 'none') ? 'block' : 'none';
        };

        // 监听内容滚动
        content.addEventListener('scroll', updateScrollbars);

        // 监听内容大小变化
        const resizeObserver = new ResizeObserver(updateScrollbars);
        resizeObserver.observe(container);
        resizeObserver.observe(content);

        // 初始更新
        setTimeout(updateScrollbars, 100);

        // ========== Pointer Capture 拖拽逻辑 ==========

        const setupDrag = (thumb, scrollbar, isVertical) => {
            let startPos = 0;
            let startScroll = 0;

            thumb.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                thumb.setPointerCapture(e.pointerId);
                thumb.classList.add('dragging');

                startPos = isVertical ? e.clientY : e.clientX;
                startScroll = isVertical ? content.scrollTop : content.scrollLeft;
            });

            thumb.addEventListener('pointermove', (e) => {
                if (!thumb.hasPointerCapture(e.pointerId)) return;

                const currentPos = isVertical ? e.clientY : e.clientX;
                const delta = currentPos - startPos;

                const trackSize = isVertical ? scrollbar.clientHeight : scrollbar.clientWidth;
                const thumbSize = isVertical ? thumb.offsetHeight : thumb.offsetWidth;
                const contentSize = isVertical ? container.scrollHeight : container.scrollWidth;
                const viewportSize = isVertical ? content.clientHeight : content.clientWidth;

                const scrollRange = contentSize - viewportSize;
                const trackRange = trackSize - thumbSize;
                const scrollDelta = (delta / trackRange) * scrollRange;

                if (isVertical) {
                    content.scrollTop = startScroll + scrollDelta;
                } else {
                    content.scrollLeft = startScroll + scrollDelta;
                }
            });

            thumb.addEventListener('pointerup', (e) => {
                thumb.releasePointerCapture(e.pointerId);
                thumb.classList.remove('dragging');
            });

            thumb.addEventListener('pointercancel', (e) => {
                thumb.releasePointerCapture(e.pointerId);
                thumb.classList.remove('dragging');
            });

            // 点击轨道跳转
            scrollbar.addEventListener('pointerdown', (e) => {
                if (e.target === thumb) return;

                const rect = scrollbar.getBoundingClientRect();
                const clickPos = isVertical ? (e.clientY - rect.top) : (e.clientX - rect.left);
                const trackSize = isVertical ? scrollbar.clientHeight : scrollbar.clientWidth;
                const thumbSize = isVertical ? thumb.offsetHeight : thumb.offsetWidth;
                const contentSize = isVertical ? container.scrollHeight : container.scrollWidth;
                const viewportSize = isVertical ? content.clientHeight : content.clientWidth;

                const scrollRange = contentSize - viewportSize;
                const targetScroll = ((clickPos - thumbSize / 2) / (trackSize - thumbSize)) * scrollRange;

                if (isVertical) {
                    content.scrollTop = Math.max(0, Math.min(scrollRange, targetScroll));
                } else {
                    content.scrollLeft = Math.max(0, Math.min(scrollRange, targetScroll));
                }
            });
        };

        setupDrag(vThumb, vScrollbar, true);
        setupDrag(hThumb, hScrollbar, false);
    }

    /**
     * 切换侧边栏的显示/隐藏状态
     * @param {boolean|undefined} forceOpen - 强制打开(true)/关闭(false)，不传则切换
     */
    toggleRulesPanel(forceOpen) {
        const isCurrentlyOpen = !this.dom.rulesPanel.classList.contains('-translate-x-full');
        const shouldOpen = forceOpen !== undefined ? forceOpen : !isCurrentlyOpen;
        const toggleBtn = this.dom.rulesPanelToggleBtn;
        const panelWidth = 288; // w-72 = 18rem = 288px

        if (shouldOpen) {
            // 打开侧边栏
            this.dom.rulesPanel.classList.remove('-translate-x-full');
            if (toggleBtn) {
                toggleBtn.style.left = `${panelWidth}px`;
                toggleBtn.title = '关闭同义词规则侧边栏';
                // 更新图标方向
                const icon = toggleBtn.querySelector('i');
                if (icon) {
                    icon.setAttribute('data-lucide', 'chevron-left');
                    lucide.createIcons({ nodes: [icon] });
                }
            }
        } else {
            // 关闭侧边栏
            this.dom.rulesPanel.classList.add('-translate-x-full');
            if (toggleBtn) {
                toggleBtn.style.left = '0px';
                toggleBtn.title = '打开同义词规则侧边栏';
                // 更新图标方向
                const icon = toggleBtn.querySelector('i');
                if (icon) {
                    icon.setAttribute('data-lucide', 'chevron-right');
                    lucide.createIcons({ nodes: [icon] });
                }
            }
        }
    }

    // --- 新增：标签数量筛选滑块初始化 ---
    initTagCountSlider() {
        const sliderEl = document.getElementById('tag-slider');
        const inputMin = document.getElementById('input-min-tags');
        const inputMax = document.getElementById('input-max-tags');
        const display = document.getElementById('tag-count-display');
        const badge = document.getElementById('tag-count-badge');
        const closeBtn = document.getElementById('close-tag-count-panel');

        if (!sliderEl || !inputMin || !inputMax) {
            console.warn('Tag count slider elements not found');
            return;
        }

        // 滑块视觉最大值 (超过此值需使用输入框)
        const SLIDER_MAX_VAL = 6;

        // 创建 noUiSlider
        noUiSlider.create(sliderEl, {
            start: [0, SLIDER_MAX_VAL],
            connect: true,
            step: 1,
            range: { 'min': 0, 'max': SLIDER_MAX_VAL }
        });

        // 防抖加载函数
        const debouncedSearch = debounce(() => this.resetSearch(), 300);

        // 更新显示和徽章
        const updateDisplay = () => {
            const minText = this.state.minTags;
            const maxText = (this.state.maxTags === -1) ? '∞' : this.state.maxTags;
            display.textContent = `${minText} - ${maxText}`;

            // 更新徽章
            if (this.state.minTags === 0 && this.state.maxTags === -1) {
                badge.classList.add('hidden');
                this.dom.fabTagCount.classList.remove('bg-cyan-100', 'border-cyan-300');
            } else {
                badge.textContent = `${minText}-${maxText}`;
                badge.classList.remove('hidden');
                this.dom.fabTagCount.classList.add('bg-cyan-100', 'border-cyan-300');
            }
        };

        // 滑块拖动事件
        sliderEl.noUiSlider.on('update', (values, handle) => {
            const v = parseInt(values[handle]);

            if (handle === 0) { // 左手柄 (Min)
                const currentInputVal = parseInt(inputMin.value) || 0;
                if (v < SLIDER_MAX_VAL || currentInputVal <= SLIDER_MAX_VAL) {
                    inputMin.value = v;
                    this.state.minTags = v;
                }
            } else { // 右手柄 (Max)
                if (v < SLIDER_MAX_VAL) {
                    inputMax.value = v;
                    this.state.maxTags = v;
                } else {
                    const currentVal = parseInt(inputMax.value);
                    if (!isNaN(currentVal) && currentVal > SLIDER_MAX_VAL) {
                        this.state.maxTags = currentVal;
                    } else {
                        inputMax.value = '∞';
                        this.state.maxTags = -1;
                    }
                }
            }

            updateDisplay();
        });

        // 滑块拖动结束触发搜索
        sliderEl.noUiSlider.on('change', () => {
            debouncedSearch();
        });

        // 最小值输入框事件
        inputMin.onchange = () => {
            let val = parseInt(inputMin.value);
            if (isNaN(val) || val < 0) val = 0;

            this.state.minTags = val;
            inputMin.value = val;

            const visualVal = (val > SLIDER_MAX_VAL) ? SLIDER_MAX_VAL : val;
            sliderEl.noUiSlider.set([visualVal, null]);

            updateDisplay();
            this.resetSearch();
        };

        // 最大值输入框事件
        inputMax.onchange = () => {
            let raw = inputMax.value.trim();
            let val;

            if (raw === '∞' || raw === '' || raw.toLowerCase() === 'inf') {
                val = -1;
                inputMax.value = '∞';
                sliderEl.noUiSlider.set([null, SLIDER_MAX_VAL]);
            } else {
                val = parseInt(raw);
                if (isNaN(val) || val < 0) val = -1;

                if (val === -1) {
                    inputMax.value = '∞';
                } else {
                    inputMax.value = val;
                }

                this.state.maxTags = val;
                const visualVal = (val > SLIDER_MAX_VAL || val === -1) ? SLIDER_MAX_VAL : val;
                sliderEl.noUiSlider.set([null, visualVal]);
            }

            this.state.maxTags = val;
            updateDisplay();
            this.resetSearch();
        };

        // 关闭按钮
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.state.isTagCountPanelOpen = false;
                this.dom.tagCountPanel.classList.add('hidden');
                this.dom.tagCountPanel.classList.remove('flex');
                if (this.state.minTags === 0 && this.state.maxTags === -1) {
                    this.dom.fabTagCount.classList.remove('bg-cyan-100', 'border-cyan-300');
                }
            };
        }

        // 初始化显示
        updateDisplay();
    }

    // --- Data Loading & Rendering ---



    async loadMeta() {
        let tags = [];
        const cachedData = localStorage.getItem(TAGS_CACHE_KEY);
        const cachedTime = localStorage.getItem(TAGS_TIME_KEY);
        const now = new Date().getTime();

        // 1. 检查本地存储中的缓存是否有效
        if (cachedData && cachedTime && (now - parseInt(cachedTime) < CACHE_DURATION)) {
            try {
                // 使用缓存数据
                tags = JSON.parse(cachedData);
                console.log("Tags loaded from localStorage cache.");
            } catch(e) {
                console.error("Failed to parse cached tags, fetching from API.", e);
                // 解析失败则强制从 API 拉取
                tags = await this.fetchTagsFromApi();
            }
        } else {
            // 2. 缓存无效或不存在，从 API 拉取并更新缓存
            tags = await this.fetchTagsFromApi();

            // 缓存到本地存储
            if (tags.length > 0) {
                try {
                    localStorage.setItem(TAGS_CACHE_KEY, JSON.stringify(tags));
                    localStorage.setItem(TAGS_TIME_KEY, now.toString());
                    console.log("Tags fetched from API and cached to localStorage.");
                } catch(e) {
                    console.error("Failed to save tags to localStorage.", e);
                }
            }
        }

        // 3. 合并规则树关键词
        const rulesKeywords = new Set();
        if (this.state.rulesTree) {
            const collectKeywords = (nodes) => {
                nodes.forEach(group => {
                    rulesKeywords.add(group.name); // 添加组名
                    group.keywords.forEach(kw => rulesKeywords.add(kw.text)); // 添加关键词
                    collectKeywords(group.children); // 递归子节点
                });
            };
            collectKeywords(this.state.rulesTree);
        }

        // 4. 合并去重
        const allSuggestions = Array.from(new Set([...tags, ...rulesKeywords]));

        // 5. 更新内存状态和 datalist
        this.state.allKnownTags = allSuggestions;
        this.filterAndUpdateDatalist('');

        console.log(`[Suggestions] Loaded ${allSuggestions.length} suggestions (${tags.length} from images, ${rulesKeywords.size} from rules)`);
    }
    
    // --- 新增辅助函数：将 API 调用逻辑封装，提高可读性 ---
    async fetchTagsFromApi() {
        try {
            const res = await fetch('/api/meta/tags').then(r => r.json());
            return res;
        } catch(e) {
            console.error("Meta load failed from API", e);
            return [];
        }
    }
    
    

    resetSearch() {
        this.state.offset = 0;
        this.state.hasMore = true;
        this.dom.grid.innerHTML = '';
        this.dom.end.classList.add('hidden');
        this.loadMore(true);
    }

    async loadMore(isJump = false) {
        if (this.state.loading || (!this.state.hasMore && !isJump)) return;
        this.state.loading = true;
        this.dom.loader.classList.remove('hidden');

        // 辅助函数：判断是否是扩展名标签（以.开头且是支持的扩展名）
        const isExtensionTag = (text) => {
            if (!text.startsWith('.')) return false;
            const ext = text.slice(1).toLowerCase();
            return SUPPORTED_EXTENSIONS.includes(ext);
        };

        // 分离标签类型：
        // 1. 扩展名标签（以.开头的扩展名，如 .gif, .png）
        // 2. 普通包含标签（非排除、非同义词组、非扩展名）- 需要通过规则树膨胀
        // 3. 同义词组包含标签（非排除、是同义词组）- 每个词经过规则树膨胀后合并为一个OR组
        // 4. 普通排除标签（排除、非同义词组、非扩展名）- 需要通过规则树膨胀
        // 5. 同义词组排除标签（排除、是同义词组）- 每个词经过规则树膨胀后合并为一个OR组

        // 提取扩展名标签
        const extensionIncludes = this.state.queryTags
            .filter(t => !t.exclude && !t.synonym && isExtensionTag(t.text))
            .map(t => t.text.slice(1).toLowerCase()); // 移除点号

        const extensionExcludes = this.state.queryTags
            .filter(t => t.exclude && !t.synonym && isExtensionTag(t.text))
            .map(t => t.text.slice(1).toLowerCase()); // 移除点号

        // 普通标签（排除扩展名标签）
        const normalIncludes = this.state.queryTags
            .filter(t => !t.exclude && !t.synonym && !isExtensionTag(t.text))
            .map(t => t.text);
        const synonymIncludes = this.state.queryTags.filter(t => !t.exclude && t.synonym);
        const normalExcludes = this.state.queryTags
            .filter(t => t.exclude && !t.synonym && !isExtensionTag(t.text))
            .map(t => t.text);
        const synonymExcludes = this.state.queryTags.filter(t => t.exclude && t.synonym);

        // 膨胀普通包含标签（返回二维数组：每个标签膨胀后的同义词组）
        const expandedNormalIncludes = this.expandKeywordsToGroups(normalIncludes);

        // 同义词组包含标签：每个词经过规则树膨胀，然后将所有结果合并为一个OR组
        const synonymIncludeGroups = synonymIncludes.map(t => {
            // 对同义词组中的每个词进行膨胀
            const expandedWords = t.synonymWords.flatMap(word => this.expandSingleKeyword(word));
            // 去重后返回为一个OR组
            return [...new Set(expandedWords)];
        });

        // 合并包含标签：普通膨胀结果 + 同义词组
        const expandedIncludesGroups = [...expandedNormalIncludes, ...synonymIncludeGroups];

        // 膨胀普通排除标签
        const expandedNormalExcludes = this.expandKeywordsToGroups(normalExcludes);

        // 同义词组排除标签（交集排除）：
        // 每个词独立膨胀，保持为三维数组结构 [胶囊[关键词[膨胀词组]]]
        // 后端需要对每个胶囊内的关键词组做交集处理
        const synonymExcludeAndGroups = synonymExcludes.map(t => {
            // 对同义词组中的每个词独立膨胀，返回二维数组
            return t.synonymWords.map(word => {
                const expanded = this.expandSingleKeyword(word);
                return [...new Set(expanded)]; // 每个词膨胀后去重
            });
        });

        // 合并排除标签：普通膨胀结果（OR排除）
        const expandedExcludesGroups = [...expandedNormalExcludes];

        // 计算膨胀后的总关键词数（用于用户反馈）
        const totalExpandedIncludes = expandedIncludesGroups.reduce((sum, g) => sum + g.length, 0);
        const totalExpandedExcludes = expandedExcludesGroups.reduce((sum, g) => sum + g.length, 0);
        const totalExpandedAndExcludes = synonymExcludeAndGroups.reduce((sum, capsule) =>
            sum + capsule.reduce((s, g) => s + g.length, 0), 0);

        // 统计原始标签数（所有种类）
        const totalOriginalIncludes = normalIncludes.length + synonymIncludes.reduce((sum, t) => sum + t.synonymWords.length, 0);
        const totalOriginalExcludes = normalExcludes.length + synonymExcludes.reduce((sum, t) => sum + t.synonymWords.length, 0);

        // 合计所有种类的原始和膨胀数量
        const totalOriginal = totalOriginalIncludes + totalOriginalExcludes;
        const totalExpanded = totalExpandedIncludes + totalExpandedExcludes + totalExpandedAndExcludes;

        // 用户反馈：显示膨胀信息（当有任何膨胀发生时）
        if (totalOriginal > 0 && totalExpanded > totalOriginal) {
            console.log(`[关键词膨胀] 总计: ${totalOriginal} 个标签 → ${totalExpanded} 个关键词`);
            if (totalOriginalIncludes > 0 && totalExpandedIncludes > totalOriginalIncludes) {
                console.log(`  - 包含: ${totalOriginalIncludes} → ${totalExpandedIncludes}`);
            }
            if (totalOriginalExcludes > 0 && (totalExpandedExcludes + totalExpandedAndExcludes) > totalOriginalExcludes) {
                console.log(`  - 排除: ${totalOriginalExcludes} → ${totalExpandedExcludes + totalExpandedAndExcludes}`);
            }
            this.showExpandedKeywordsBadge(totalOriginal, totalExpanded);
        } else {
            this.hideExpandedKeywordsBadge();
        }

        const payload = {
            offset: this.state.offset,
            limit: this.state.limit,
            sort_by: this.state.sortBy,
            keywords: expandedIncludesGroups,  // 二维数组
            excludes: expandedExcludesGroups,  // 二维数组（OR排除）
            excludes_and: synonymExcludeAndGroups,  // 三维数组（交集排除）
            extensions: extensionIncludes,     // 包含的扩展名
            exclude_extensions: extensionExcludes,  // 排除的扩展名
            min_tags: this.state.minTags,      // 新增：最小标签数
            max_tags: this.state.maxTags       // 新增：最大标签数 (-1 表示无限制)
        };

        try {
            const res = await fetch('/api/search', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            }).then(r => r.json());

            this.state.totalItems = res.total;

            if (res.results.length < this.state.limit) {
                this.state.hasMore = false;
                this.dom.end.classList.remove('hidden');
            } else {
                this.dom.end.classList.add('hidden');
            }

            this.renderPageBlock(res.results);
            this.state.offset += res.results.length;

        } catch (e) {
            console.error(e);
        } finally {
            this.state.loading = false;
            this.dom.loader.classList.add('hidden');
        }
    }

    /**
     * [重构] 显示关键词膨胀提示徽章（移到 fab-tree 按钮上）
     * @param {number} original - 原始关键词数量
     * @param {number} expanded - 膨胀后关键词数量
     */
    showExpandedKeywordsBadge(original, expanded) {
        const badge = document.getElementById('expansion-badge');
        if (!badge) return;

        badge.textContent = `${original}→${expanded}`;
        badge.title = `原始 ${original} 个关键词已通过规则树膨胀为 ${expanded} 个搜索关键词`;
        badge.classList.remove('hidden');
    }

    /**
     * [重构] 隐藏关键词膨胀提示徽章
     */
    hideExpandedKeywordsBadge() {
        const badge = document.getElementById('expansion-badge');
        if (badge) {
            badge.classList.add('hidden');
        }
    }

    /**
     * [新增] 防抖渲染规则树，避免频繁更新导致的性能问题和版本冲突
     */
    debouncedRenderRulesTree() {
        // 清除之前的待执行渲染
        if (this.state.pendingRulesRender) {
            clearTimeout(this.state.pendingRulesRender);
        }

        // 设置新的延迟渲染
        this.state.pendingRulesRender = setTimeout(() => {
            this.renderRulesTree(true); // 跳过建议更新，避免循环
            this.state.pendingRulesRender = null;
        }, this.state.rulesRenderDebounceMs);
    }

    /**
     * 根据搜索标签过滤规则树，保留命中节点及其父路径。
     * @param {Array} tree - 规则树结构。
     * @param {Array<string>} searchTags - 用户输入的搜索标签数组 (已清理)。
     * @returns {Array} 过滤后的新树结构。
     */

    filterTree(tree, searchTags) {
        // 处理 tree 为 null 或 undefined 的情况
        if (!tree) {
            return [];
        }

        if (!searchTags || searchTags.length === 0) {
            return JSON.parse(JSON.stringify(tree)); // 无标签，返回完整副本
        }

        const lowerSearchTags = searchTags.map(t => t.toLowerCase());

        /**
         * 递归过滤函数
         * @param {Array} nodes - 待过滤的节点数组。
         * @returns {Array} 过滤后的节点数组副本。
         */
        const filterRecursive = (nodes) => {
            const filteredNodes = [];

            for (const node of nodes) {
                // 1. 递归过滤子节点
                const filteredChildren = filterRecursive(node.children);

                // 2. 检查当前节点是否命中 (组名或关键词)
                // 处理空名组的情况：空名组也应该在搜索时显示（如果搜索"空"或"无名"）
                const nodeName = node.name || '';
                const isEmptyNameGroup = !nodeName || nodeName.trim() === '';

                // 空名组匹配条件：搜索"空"、"无名"、"empty"等关键词
                const emptyGroupMatch = isEmptyNameGroup && lowerSearchTags.some(tag =>
                    ['空', '无名', 'empty', '空组', '无名组'].some(keyword => keyword.includes(tag) || tag.includes(keyword))
                );

                const groupNameMatch = nodeName && lowerSearchTags.some(tag => nodeName.toLowerCase().includes(tag));
                const keywordMatch = node.keywords.some(k =>
                    lowerSearchTags.some(tag => k.text.toLowerCase().includes(tag))
                );

                const isMatch = groupNameMatch || keywordMatch || emptyGroupMatch;

                // 3. 判断是否保留：如果自身匹配或子节点中包含匹配项
                if (isMatch || filteredChildren.length > 0) {
                    const nodeCopy = {
                        ...node,
                        children: filteredChildren,
                        isMatch: isMatch // 标记自身是否命中 (用于 UI 高亮)
                    };
                    // 移除对子节点的引用，确保返回的是副本
                    nodeCopy.children = filteredChildren;

                    filteredNodes.push(nodeCopy);
                }
            }

            return filteredNodes;
        };

        return filterRecursive(tree);
    }

    /**
     * 渲染侧边栏的规则树 UI
     * @param {boolean} skipSuggestionUpdate - 是否跳过建议更新（避免循环调用）
     */
    renderRulesTree(skipSuggestionUpdate = false) {
        const container = document.getElementById('rules-tree-container');
        const versionInfo = document.getElementById('rules-version-info');

        if (!container) return;

        versionInfo.textContent = `v${this.state.rulesBaseVersion}`;

        // 1. 获取规则树搜索框的内容进行过滤（与主搜索栏解耦）
        const treeSearchInput = document.getElementById('rules-tree-search');
        const treeSearchText = treeSearchInput ? treeSearchInput.value.trim() : '';
        const searchInputTexts = treeSearchText ? [treeSearchText] : [];

        const treeToRender = this.filterTree(this.state.rulesTree, searchInputTexts);

        container.innerHTML = '';

        // 标记是否有正常树数据
        const hasTreeData = treeToRender && treeToRender.length > 0;

        if (!hasTreeData) {
            // 使用 DOM 方式添加提示，避免 innerHTML 覆盖工具栏
            const emptyMsg = document.createElement('p');
            emptyMsg.className = 'text-sm text-slate-400 text-center mt-4';
            emptyMsg.textContent = '暂无规则数据。';
            container.appendChild(emptyMsg);
            // 注意：不要 return，继续执行以渲染冲突区域
        }

        /**
         * 递归渲染节点
         * @param {Array} nodes - 要渲染的节点数组
         * @param {HTMLElement} parentEl - 父容器元素
         * @param {number} parentId - 父节点ID（0表示根级别）
         */
        const isBatchMode = this.state.batchEditMode;
        const selectedIds = this.state.selectedGroupIds;
        const expandedIds = this.state.expandedGroupIds;

        const renderRecursive = (nodes, parentEl, parentId = 0) => {
            nodes.forEach((node) => {
                // [新增] 在每个节点前添加间隙放置区
                const dropGap = this.createDropGap(node.id, parentId);
                parentEl.appendChild(dropGap);

                const isEnabled = node.isEnabled || (node.isEnabled === undefined ? true : false);
                const isSelected = selectedIds.has(node.id);
                const isConflict = node.isConflict || false; // 检测是否是冲突节点
                const isExpanded = expandedIds.has(node.id); // 检查是否已展开

                const groupEl = document.createElement('div');
                // 冲突节点添加红色边框和背景，选中状态添加蓝色边框
                const conflictClass = isConflict ? 'border-2 border-red-400 bg-red-50' : '';
                const selectedClass = (isBatchMode && isSelected) ? 'ring-2 ring-blue-500 bg-blue-50' : '';
                groupEl.className = `group-node group relative ${isEnabled ? '' : 'opacity-50 italic'} ${node.isMatch ? 'bg-blue-50 border-blue-400' : ''} ${conflictClass} ${selectedClass}`;
                groupEl.dataset.id = node.id;
                groupEl.dataset.name = node.name || '';  // 处理空名组

                // 批量编辑模式下也允许拖拽
                groupEl.draggable = "true";
                this.bindDragEvents(groupEl);

                const header = document.createElement('div');
                // 批量模式下 header 保持 cursor-pointer（点击展开/折叠），复选框区域单独设置 cursor-grab
                const batchModeClass = isBatchMode ? 'batch-mode' : '';
                header.className = `group-header flex items-center justify-between p-2 rounded cursor-pointer ${batchModeClass} ${node.isMatch ? 'hover:bg-blue-100' : (isConflict ? 'hover:bg-red-100' : 'hover:bg-slate-100')}`;

                const nameDisplay = document.createElement('div');
                nameDisplay.className = "flex items-center gap-1 font-bold text-sm";

                // 批量编辑模式下添加复选框（增大尺寸和点击区域，避免误触发拖拽）
                const checkboxHtml = isBatchMode ? `
                    <label class="batch-checkbox-wrapper flex items-center justify-center w-7 h-7 -ml-1 mr-1 cursor-pointer">
                        <input type="checkbox" class="batch-checkbox w-5 h-5 accent-blue-600 cursor-pointer"
                               data-group-id="${node.id}" ${isSelected ? 'checked' : ''} />
                    </label>
                ` : '';

                // 处理空名组和冲突节点：特殊样式标识
                const isEmptyNameGroup = !node.name || node.name.trim() === '';
                let displayName;
                if (isConflict) {
                    // 冲突节点显示红色警告
                    displayName = `<span class="text-red-600">${node.name || '[空名组]'}</span>
                                   <span class="text-xs text-red-500 bg-red-100 px-1 rounded ml-1" title="${node.conflictReason || '循环依赖'}">⚠️冲突</span>`;
                } else if (isEmptyNameGroup) {
                    displayName = `<span class="text-red-500 bg-red-50 px-1 rounded">[空名组 #${node.id}]</span>`;
                } else {
                    displayName = `<span class="group-name-text ${node.isMatch ? 'text-blue-700' : 'text-slate-700'}">${node.name}</span>`;
                }

                // 图标选择：冲突节点用警告图标
                const folderIcon = isConflict
                    ? 'alert-triangle'
                    : (isEmptyNameGroup ? 'alert-triangle' : (isEnabled ? 'folder' : 'folder-x'));
                const iconColor = isConflict
                    ? 'text-red-500'
                    : (isEmptyNameGroup ? 'text-red-500' : (node.isMatch ? 'text-blue-600' : 'text-slate-500'));

                nameDisplay.innerHTML = `
                    ${checkboxHtml}
                    <i data-lucide="${folderIcon}" class="w-4 h-4 ${iconColor}"></i>
                    ${displayName}
                `;

                const actionButtons = document.createElement('div');
                actionButtons.className = "flex items-center gap-1";

                const chevron = document.createElement('i');
                chevron.dataset.lucide = "chevron-down";
                chevron.className = `w-4 h-4 text-slate-400 transition transform ${isExpanded ? 'rotate-180' : ''}`;

                // 批量编辑模式下隐藏单个操作按钮，只显示 chevron
                if (!isBatchMode) {
                    // 添加子组按钮 (新增)
                    const addChildGroupBtn = document.createElement('button');
                    addChildGroupBtn.className = "p-1 text-blue-500 hover:text-blue-700 opacity-0 group-hover:opacity-100 transition-opacity";
                    addChildGroupBtn.innerHTML = `<i data-lucide="folder-plus" class="w-4 h-4"></i>`;
                    addChildGroupBtn.title = "添加子组";
                    addChildGroupBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.startChildGroupAdd(node.id, keywordsContainer, childrenContainer);
                    };

                    // 添加同义词按钮
                    const addKeywordBtn = document.createElement('button');
                    addKeywordBtn.className = "p-1 text-green-500 hover:text-green-700 opacity-0 group-hover:opacity-100 transition-opacity";
                    addKeywordBtn.innerHTML = `<i data-lucide="plus" class="w-4 h-4"></i>`;
                    addKeywordBtn.title = "添加同义词";
                    addKeywordBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.startKeywordAdd(node.id, keywordsContainer);
                    };

                    // 启用/禁用按钮（配色对调：启用状态显示绿色眼睛，禁用状态显示黄色闭眼）
                    const toggleEnableBtn = document.createElement('button');
                    toggleEnableBtn.className = `p-1 opacity-0 group-hover:opacity-100 transition-opacity ${isEnabled ? 'text-emerald-500 hover:text-emerald-700' : 'text-yellow-500 hover:text-yellow-700'}`;
                    toggleEnableBtn.innerHTML = `<i data-lucide="${isEnabled ? 'eye' : 'eye-off'}" class="w-4 h-4"></i>`;
                    toggleEnableBtn.title = isEnabled ? "禁用组" : "启用组";
                    toggleEnableBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.toggleGroupEnabled(node);
                    };

                    // 硬删除按钮
                    const deleteGroupBtn = document.createElement('button');
                    deleteGroupBtn.className = "p-1 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity";
                    deleteGroupBtn.innerHTML = `<i data-lucide="trash-2" class="w-4 h-4"></i>`;
                    deleteGroupBtn.title = "彻底删除组";
                    deleteGroupBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.deleteGroup(node.id);
                    };

                    actionButtons.appendChild(addChildGroupBtn);
                    actionButtons.appendChild(addKeywordBtn);
                    actionButtons.appendChild(toggleEnableBtn);
                    actionButtons.appendChild(deleteGroupBtn);
                }

                actionButtons.appendChild(chevron);

                header.appendChild(nameDisplay);
                header.appendChild(actionButtons);

                header.onclick = (e) => {
                    // 如果点击的是复选框，不阻止冒泡，让事件委托处理
                    if (e.target.classList.contains('batch-checkbox')) {
                        // 不调用 stopPropagation，让事件冒泡到 rulesTreeContainer 的事件委托
                        return;
                    }

                    e.stopPropagation();

                    // 展开/折叠（批量模式和正常模式都可以，选中状态只通过复选框控制）
                    keywordsContainer.classList.toggle('hidden');
                    childrenContainer.classList.toggle('hidden');
                    chevron.classList.toggle('rotate-180');

                    // 更新展开状态存储
                    if (expandedIds.has(node.id)) {
                        expandedIds.delete(node.id);
                    } else {
                        expandedIds.add(node.id);
                    }
                    // 保存到 sessionStorage
                    this.state.saveExpandedState();
                };

                header.ondblclick = (e) => {
                    e.stopPropagation();
                    // 批量编辑模式下禁用双击编辑
                    if (isBatchMode) return;
                    this.startGroupEdit(node, nameDisplay, keywordsContainer, childrenContainer);
                };

                const keywordsContainer = document.createElement('div');
                keywordsContainer.className = `flex flex-wrap gap-1 pl-6 pt-1 pb-2 border-l border-slate-200 ml-2 ${isExpanded ? '' : 'hidden'}`;

                node.keywords.forEach(k => {
                    const isKeywordMatch = searchInputTexts.some(tag => k.text.toLowerCase().includes(tag.toLowerCase()));
                    const keywordEl = document.createElement('span');
                    keywordEl.className = `keyword-capsule flex items-center gap-1 px-2 py-0.5 text-xs rounded-full cursor-pointer transition-colors
                                            ${k.isEnabled ? (isKeywordMatch ? 'bg-purple-500 text-white hover:bg-purple-600' : 'bg-blue-500 text-white hover:bg-blue-600') : 'bg-slate-300 text-slate-600 hover:bg-slate-400'}`;

                    const textSpan = document.createElement('span');
                    textSpan.textContent = k.text;

                    const delBtn = document.createElement('button');
                    delBtn.className = "ml-1 text-lg leading-none rounded-full hover:opacity-70 text-white/80 transition-opacity";
                    delBtn.innerHTML = '&times;';
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.removeKeyword(node.id, k.text);
                    };

                    keywordEl.appendChild(textSpan);
                    keywordEl.appendChild(delBtn);
                    keywordsContainer.appendChild(keywordEl);
                });

                const childrenContainer = document.createElement('div');
                childrenContainer.className = `ml-4 border-l border-slate-200 ${isExpanded ? '' : 'hidden'}`;
                // [修改] 递归渲染子节点时传递当前节点ID作为父ID
                renderRecursive(node.children, childrenContainer, node.id);

                groupEl.appendChild(header);
                groupEl.appendChild(keywordsContainer);
                groupEl.appendChild(childrenContainer);
                parentEl.appendChild(groupEl);
            });

            // [新增] 在所有节点渲染完成后，添加最后一个间隙放置区
            if (nodes.length > 0) {
                const lastDropGap = this.createDropGap(null, parentId);
                parentEl.appendChild(lastDropGap);
            }
        };

        // 只有有数据时才调用渲染
        if (hasTreeData) {
            // 添加根目录放置区（小型，只在拖拽时可见）
            const rootDropZone = this.createRootDropZone();
            container.appendChild(rootDropZone);

            renderRecursive(treeToRender, container, 0);
        }

        // ========== 渲染冲突节点区域 ==========
        const conflictNodes = this.state.conflictNodes || [];
        const conflictRelations = this.state.conflictRelations || [];

        if (conflictNodes.length > 0 || conflictRelations.length > 0) {
            console.log('[renderRulesTree] 冲突检测:', { conflictNodes: conflictNodes.length, conflictRelations: conflictRelations.length });
            // 首次发现冲突时弹出 Toast 提醒用户
            if (!this._hasShownConflictWarning) {
                this._hasShownConflictWarning = true;
                this.showToast(`⚠️ 检测到 ${conflictRelations.length} 条数据冲突，请在规则树底部查看并修复`, 'error');
            }

            // 分隔线
            const separator = document.createElement('div');
            separator.className = 'my-4 border-t-2 border-red-300';
            container.appendChild(separator);

            // 冲突区域标题
            const conflictHeader = document.createElement('div');
            conflictHeader.className = 'flex items-center gap-2 p-2 bg-red-100 rounded-lg mb-2';
            conflictHeader.innerHTML = `
                <i data-lucide="alert-triangle" class="w-5 h-5 text-red-600"></i>
                <span class="font-bold text-red-700">⚠️ 检测到数据冲突 (${conflictNodes.length} 个节点, ${conflictRelations.length} 条关系)</span>
            `;
            container.appendChild(conflictHeader);

            // 渲染冲突关系列表
            if (conflictRelations.length > 0) {
                const relationsContainer = document.createElement('div');
                relationsContainer.className = 'mb-3 p-2 bg-red-50 rounded border border-red-200';

                const relationsTitle = document.createElement('div');
                relationsTitle.className = 'text-sm font-bold text-red-700 mb-2';
                relationsTitle.textContent = '冲突的层级关系：';
                relationsContainer.appendChild(relationsTitle);

                conflictRelations.forEach(rel => {
                    const relItem = document.createElement('div');
                    relItem.className = 'flex items-center justify-between p-2 mb-1 bg-white rounded border border-red-200 text-sm';

                    const infoSpan = document.createElement('span');
                    infoSpan.className = 'text-red-800';
                    infoSpan.innerHTML = `
                        <span class="font-mono bg-red-100 px-1 rounded">parent_id: ${rel.parent_id}</span>
                        →
                        <span class="font-mono bg-red-100 px-1 rounded">child_id: ${rel.child_id}</span>
                        <br><span class="text-red-600 text-xs">${rel.reason}</span>
                    `;

                    const fixBtn = document.createElement('button');
                    fixBtn.className = 'px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition whitespace-nowrap';
                    fixBtn.innerHTML = `<i data-lucide="trash-2" class="w-3 h-3 inline"></i> 删除此关系`;
                    fixBtn.onclick = () => this.removeConflictHierarchy(rel.parent_id, rel.child_id);

                    relItem.appendChild(infoSpan);
                    relItem.appendChild(fixBtn);
                    relationsContainer.appendChild(relItem);
                });

                container.appendChild(relationsContainer);
            }

            // 渲染冲突节点列表
            if (conflictNodes.length > 0) {
                const nodesContainer = document.createElement('div');
                nodesContainer.className = 'p-2 bg-red-50 rounded border border-red-200';

                const nodesTitle = document.createElement('div');
                nodesTitle.className = 'text-sm font-bold text-red-700 mb-2';
                nodesTitle.textContent = '受影响的节点：';
                nodesContainer.appendChild(nodesTitle);

                conflictNodes.forEach(node => {
                    const nodeItem = document.createElement('div');
                    nodeItem.className = 'flex items-center justify-between p-2 mb-1 bg-white rounded border border-red-200';

                    const nodeInfo = document.createElement('div');
                    nodeInfo.className = 'flex items-center gap-2';
                    nodeInfo.innerHTML = `
                        <i data-lucide="folder-x" class="w-4 h-4 text-red-500"></i>
                        <span class="font-bold text-red-800">${node.name || '[空名组]'}</span>
                        <span class="text-xs text-red-500 bg-red-100 px-1 rounded">ID: ${node.id}</span>
                        <span class="text-xs text-red-600">${node.conflictReason || ''}</span>
                    `;

                    const nodeActions = document.createElement('div');
                    nodeActions.className = 'flex gap-1';

                    // 移到根目录按钮
                    const moveToRootBtn = document.createElement('button');
                    moveToRootBtn.className = 'px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition';
                    moveToRootBtn.innerHTML = `<i data-lucide="home" class="w-3 h-3 inline"></i> 移到根目录`;
                    moveToRootBtn.onclick = () => this.moveConflictNodeToRoot(node.id);

                    // 删除节点按钮
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition';
                    deleteBtn.innerHTML = `<i data-lucide="trash-2" class="w-3 h-3 inline"></i> 删除`;
                    deleteBtn.onclick = () => this.deleteGroup(node.id);

                    nodeActions.appendChild(moveToRootBtn);
                    nodeActions.appendChild(deleteBtn);

                    nodeItem.appendChild(nodeInfo);
                    nodeItem.appendChild(nodeActions);
                    nodesContainer.appendChild(nodeItem);
                });

                container.appendChild(nodesContainer);
            }
        }

        lucide.createIcons();

        // 只在非跳过模式时更新建议（避免循环调用）
        if (!skipSuggestionUpdate) {
            this.updateTreeSearchSuggestions();
        }
    }

    /**
     * 删除冲突的层级关系
     */
    async removeConflictHierarchy(parentId, childId) {
        if (!confirm(`确定要删除这条冲突关系吗？\n(parent_id: ${parentId} → child_id: ${childId})`)) {
            return;
        }

        const action = {
            url: '/api/rules/hierarchy/remove',
            method: 'POST',
            type: 'hierarchy/remove'
        };
        const payload = {
            parent_id: parentId,
            child_id: childId
        };

        const result = await this.handleSave(action, payload);
        if (result.success) {
            this.showToast('冲突关系已删除', 'success');
        }
    }

    /**
     * 将冲突节点移到根目录（删除其所有父关系）
     */
    async moveConflictNodeToRoot(nodeId) {
        if (!confirm(`确定要将节点 ${nodeId} 的所有父关系删除，使其成为根节点吗？`)) {
            return;
        }

        // 从冲突关系中找出该节点作为 child 的所有关系
        const relationsToRemove = (this.state.conflictRelations || [])
            .filter(rel => rel.child_id === nodeId);

        if (relationsToRemove.length === 0) {
            this.showToast('未找到需要删除的父关系', 'info');
            return;
        }

        for (const rel of relationsToRemove) {
            const action = {
                url: '/api/rules/hierarchy/remove',
                method: 'POST',
                type: 'hierarchy/remove'
            };
            const payload = {
                parent_id: rel.parent_id,
                child_id: rel.child_id
            };
            await this.handleSave(action, payload);
        }

        this.showToast(`已删除 ${relationsToRemove.length} 条父关系，节点已移到根目录`, 'success');
    }

    // [重构] 绑定拖拽事件 - 支持间隙放置和嵌套放置
    bindDragEvents(el, isRootContainer = false) {
        if (!el.dataset.id && !isRootContainer) return;

        el.addEventListener('dragstart', (e) => {
            // 允许输入框中的文本选择拖拽（修复编辑模式下无法选中文本的问题）
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return; // 不拦截，允许原生行为
            }

            // 存储被拖拽元素的 ID
            e.stopPropagation();

            const draggedId = parseInt(el.dataset.id);

            // 批量模式下：如果拖拽的是已选中的组，传递所有选中的组ID
            // 否则只传递当前拖拽的组ID
            let dragIds = [draggedId];
            if (this.state.batchEditMode && this.state.selectedGroupIds.size > 0) {
                if (this.state.selectedGroupIds.has(draggedId)) {
                    // 拖拽的是已选中的组，移动所有选中的组
                    dragIds = Array.from(this.state.selectedGroupIds);
                }
                // 否则只移动当前拖拽的组（不在选中列表中）
            }

            e.dataTransfer.setData('text/plain', JSON.stringify(dragIds));
            e.dataTransfer.effectAllowed = 'move';

            // 添加拖拽中样式
            el.classList.add('dragging');
            document.body.classList.add('is-dragging');

            // 显示根目录放置区
            document.querySelectorAll('.root-drop-zone').forEach(zone => {
                zone.classList.remove('hidden');
            });

            // 批量模式下给所有选中的组添加视觉反馈
            if (this.state.batchEditMode && dragIds.length > 1) {
                dragIds.forEach(id => {
                    const groupEl = document.querySelector(`.group-node[data-id="${id}"]`);
                    if (groupEl && groupEl !== el) {
                        groupEl.classList.add('dragging');
                    }
                });
            }
        });

        el.addEventListener('dragend', (e) => {
            // 拖拽结束时移除所有反馈类
            e.stopPropagation();
            el.classList.remove('dragging');
            document.body.classList.remove('is-dragging');

            // 移除所有组的拖拽视觉反馈
            document.querySelectorAll('.group-node.dragging').forEach(node => {
                node.classList.remove('dragging');
            });

            // 清除所有间隙和放置区的高亮
            document.querySelectorAll('.drop-gap.drag-over').forEach(gap => {
                gap.classList.remove('drag-over');
            });
            document.querySelectorAll('.root-drop-zone.drag-over').forEach(zone => {
                zone.classList.remove('drag-over');
            });
            document.querySelectorAll('.group-node.drop-target-child').forEach(node => {
                node.classList.remove('drop-target-child');
            });

            // 隐藏根目录放置区
            document.querySelectorAll('.root-drop-zone').forEach(zone => {
                zone.classList.add('hidden');
            });
        });

        // 对于组节点，添加"作为子节点"的放置处理
        if (!isRootContainer && el.classList.contains('group-node')) {
            el.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';

                // 如果是拖到组节点上（而非间隙），显示嵌套放置视觉
                el.classList.add('drop-target-child');
            });

            el.addEventListener('dragleave', (e) => {
                // 只有当真正离开组节点时才移除样式
                // 使用 relatedTarget 判断是否移动到子元素
                if (!el.contains(e.relatedTarget)) {
                    el.classList.remove('drop-target-child');
                }
            });

            el.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();

                el.classList.remove('drop-target-child');

                let childIds = this._parseDragData(e);
                const parentId = parseInt(el.dataset.id);

                // 过滤掉无效的ID和自身
                childIds = childIds.filter(id => id && id !== parentId);

                if (childIds.length > 0) {
                    this.handleBatchHierarchyChange(parentId, childIds);
                } else {
                    this.showToast('无法将组拖拽到自身。', 'error');
                }
            });
        }
    }

    /**
     * [新增] 解析拖拽传输的数据
     * @param {DragEvent} e - 拖拽事件
     * @returns {number[]} 被拖拽的组ID数组
     */
    _parseDragData(e) {
        let childIds = [];
        try {
            const data = e.dataTransfer.getData('text/plain');
            childIds = JSON.parse(data);
            if (!Array.isArray(childIds)) {
                childIds = [parseInt(data)];
            }
        } catch {
            childIds = [parseInt(e.dataTransfer.getData('text/plain'))];
        }
        return childIds.filter(id => !isNaN(id));
    }

    /**
     * [新增] 创建间隙放置区元素
     * @param {number|null} siblingId - 放置后成为哪个节点的下一个兄弟节点（null表示放在最前面）
     * @param {number} parentId - 父节点ID（0表示根级别）
     * @returns {HTMLElement} 间隙放置区元素
     */
    createDropGap(siblingId, parentId) {
        const gap = document.createElement('div');
        gap.className = 'drop-gap';
        gap.dataset.siblingId = siblingId || '';
        gap.dataset.parentId = parentId;

        gap.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            gap.classList.add('drag-over');
        });

        gap.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            gap.classList.remove('drag-over');
        });

        gap.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            gap.classList.remove('drag-over');

            const childIds = this._parseDragData(e);
            const targetParentId = parseInt(gap.dataset.parentId) || 0;

            // 过滤掉无效的ID
            const validChildIds = childIds.filter(id => id && id !== targetParentId);

            if (validChildIds.length > 0) {
                // 调用移动到指定父节点的方法
                this.handleBatchHierarchyChange(targetParentId, validChildIds);
            }
        });

        return gap;
    }

    /**
     * [新增] 创建根目录放置区（紧凑设计，仅拖拽时显示）
     * @returns {HTMLElement} 根目录放置区元素
     */
    createRootDropZone() {
        const zone = document.createElement('div');
        // 默认隐藏，通过 CSS .is-dragging 类控制显示
        zone.className = 'root-drop-zone hidden';
        zone.innerHTML = '<span class="text-xs">📁 移至根目录</span>';

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('drag-over');

            const childIds = this._parseDragData(e);
            const validChildIds = childIds.filter(id => id);

            if (validChildIds.length > 0) {
                // 移动到根目录（parentId = 0）
                this.handleBatchHierarchyChange(0, validChildIds);
            }
        });

        return zone;
    }

    /**
     * [新增] 批量处理层级关系的修改(支持批量拖拽)。
     * 使用统一的 handleSave 方法处理版本控制和冲突。
     * @param {number} parentId - 目标父组 ID (0 代表根节点)。
     * @param {number[]} childIds - 被拖拽的子组 ID 数组。
     */
    async handleBatchHierarchyChange(parentId, childIds) {
        // 防止重复触发
        if (this._isHandlingHierarchyChange) {
            console.log('[handleBatchHierarchyChange] 已在处理中，跳过重复调用');
            return;
        }
        this._isHandlingHierarchyChange = true;

        try {
            // ★ 前端循环检测
            const cycleErrors = [];
            for (const childId of childIds) {
                if (this.wouldCreateCycle(parentId, childId)) {
                    cycleErrors.push(childId);
                }
            }
            if (cycleErrors.length > 0) {
                this.showToast(`❌ 无法移动：${cycleErrors.length} 个组会形成循环依赖！`, 'error');
                console.error(`[handleBatchHierarchyChange] 循环检测失败的节点:`, cycleErrors);
                return;
            }

            this.showToast(`正在移动 ${childIds.length} 个组...`, 'info');

            // ★ 乐观更新：先清空选中状态，这样 handleSave 内部渲染时就是正确的状态
            const previousSelectedIds = this.state.batchEditMode ? new Set(this.state.selectedGroupIds) : null;
            if (this.state.batchEditMode) {
                this.state.selectedGroupIds.clear();
                this.updateBatchToolbarUI();
            }

            // ★ 使用统一的 handleSave 方法处理版本控制
            const action = {
                url: '/api/rules/hierarchy/batch_move',
                method: 'POST',
                type: 'hierarchy/batch_move'
            };
            const payload = {
                parent_id: parentId,
                child_ids: childIds
            };

            const result = await this.handleSave(action, payload);

            if (result.success) {
                const movedCount = result.new_id?.moved || childIds.length;
                const errors = result.new_id?.errors || [];

                if (errors.length === 0) {
                    this.showToast(`已移动 ${movedCount} 个组`, 'success');
                } else {
                    this.showToast(`移动完成：${movedCount} 成功，${errors.length} 失败`, 'warning');
                    console.log('[handleBatchHierarchyChange] 部分失败:', errors);
                }
                // 选中状态已在上面清空
            } else {
                // 全部失败时显示具体错误并恢复选中状态
                const errors = result.new_id?.errors || [];
                if (errors.length > 0) {
                    // 提取错误原因
                    const cycleErrors = errors.filter(e => e.error === 'Would create cycle');
                    if (cycleErrors.length === errors.length) {
                        this.showToast(`❌ 移动失败：会形成循环依赖`, 'error');
                    } else {
                        this.showToast(`❌ 移动失败：${errors.length} 个错误`, 'error');
                    }
                    console.error('[handleBatchHierarchyChange] 全部失败:', errors);
                }

                // 恢复之前的选中状态
                if (previousSelectedIds && previousSelectedIds.size > 0) {
                    this.state.selectedGroupIds = previousSelectedIds;
                    this.updateBatchToolbarUI();
                    this.renderRulesTree(true);
                }
            }

        } catch (error) {
            console.error('[handleBatchHierarchyChange] 请求失败:', error);
            this.showToast('网络错误，请重试', 'error');
        } finally {
            this._isHandlingHierarchyChange = false;
        }
    }

    /**
     * [新增] 前端本地循环检测：检查将 childId 设为 parentId 的子节点是否会形成环路
     * @param {number} parentId - 目标父组 ID
     * @param {number} childId - 被拖拽的子组 ID
     * @returns {boolean} true 表示会形成环路，false 表示安全
     */
    wouldCreateCycle(parentId, childId) {
        if (parentId === childId) return true;  // 自引用
        if (parentId === 0) return false;       // 移动到根节点不可能成环

        // 从 parentId 向上查找所有祖先，如果 childId 在祖先链中，则会形成环
        const visited = new Set();

        const findNodeById = (nodes, targetId) => {
            if (!nodes) return null;
            for (const node of nodes) {
                if (node.id === targetId) return node;
                const found = findNodeById(node.children, targetId);
                if (found) return found;
            }
            return null;
        };

        // 构建父节点映射（每个节点的直接父节点）
        const parentMap = new Map();
        const buildParentMap = (nodes, parentNode = null) => {
            nodes.forEach(node => {
                if (parentNode) {
                    // 一个节点可能有多个父节点（在你的数据模型中），这里收集所有
                    if (!parentMap.has(node.id)) {
                        parentMap.set(node.id, []);
                    }
                    parentMap.get(node.id).push(parentNode.id);
                }
                buildParentMap(node.children, node);
            });
        };
        buildParentMap(this.state.rulesTree || []);

        // 从 parentId 向上遍历，检查是否能到达 childId
        const checkAncestors = (currentId) => {
            if (currentId === childId) return true;  // 找到了！会形成环
            if (visited.has(currentId)) return false;
            visited.add(currentId);

            const parents = parentMap.get(currentId) || [];
            for (const pid of parents) {
                if (checkAncestors(pid)) return true;
            }
            return false;
        };

        return checkAncestors(parentId);
    }

    /**
     * [优化] 处理单个层级关系的修改(拖拽成功)。
     * 此方法已废弃，保留仅为兼容性。所有调用都会转发到 handleBatchHierarchyChange。
     * @param {number} parentId - 目标父组 ID (0 代表根节点)。
     * @param {number} childId - 被拖拽的子组 ID。
     * @deprecated 使用 handleBatchHierarchyChange(parentId, [childId]) 代替
     */
    async handleHierarchyChange(parentId, childId) {
        // 直接调用批量处理方法（传入单个元素的数组）
        // 注意：handleBatchHierarchyChange 已移除对此方法的回调，避免循环
        return this.handleBatchHierarchyChange(parentId, [childId]);
    }

    /**
     * [新增] 启动子组添加模式。
     * @param {number} parentId - 父组 ID。
     * @param {HTMLElement} keywordsContainer - 关键词容器 (用于隐藏)。
     * @param {HTMLElement} childrenContainer - 子节点容器 (用于显示和添加新组)。
     */
    startChildGroupAdd(parentId, keywordsContainer, childrenContainer) {
        // 检查是否已有编辑框存在，避免重复点击
        if (childrenContainer.querySelector('.child-group-add-wrapper')) {
            return;
        }

        // 确保子节点容器可见
        if (keywordsContainer) keywordsContainer.classList.add('hidden');
        childrenContainer.classList.remove('hidden');

        // 创建临时容器
        const editorContainer = document.createElement('div');
        editorContainer.className = "child-group-add-wrapper p-2 bg-white rounded shadow-md flex flex-col gap-2 mb-2";

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '输入新子组名称...';
        input.className = "w-full p-1 border border-blue-400 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500";

        const actionBtns = document.createElement('div');
        actionBtns.className = "flex justify-between items-center text-xs";

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '创建';
        saveBtn.className = "px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition";

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.className = "px-3 py-1 bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition";

        actionBtns.appendChild(cancelBtn);
        actionBtns.appendChild(saveBtn);

        editorContainer.appendChild(input);
        editorContainer.appendChild(actionBtns);

        childrenContainer.insertBefore(editorContainer, childrenContainer.firstChild);
        input.focus();

        const cleanup = () => {
            editorContainer.remove();
        };

        const save = async () => {
            const groupName = input.value.trim();
            if (!groupName) {
                this.showToast('组名不能为空！', 'error');
                return;
            }

            // 1. 创建新组
            const addGroupAction = {
                url: '/api/rules/group/add',
                method: 'POST',
                type: 'group/add'
            };
            const addGroupPayload = {
                group_name: groupName,
                is_enabled: 1
            };

            const groupResult = await this.handleSave(addGroupAction, addGroupPayload);

            if (!groupResult.success) {
                this.showToast('创建组失败', 'error');
                cleanup();
                return;
            }

            const newGroupId = groupResult.new_id;

            // 2. 建立父子关系
            const addHierarchyAction = {
                url: '/api/rules/hierarchy/add',
                method: 'POST',
                type: 'hierarchy/add'
            };
            const addHierarchyPayload = {
                parent_id: parentId,
                child_id: newGroupId
            };

            const hierarchyResult = await this.handleSave(addHierarchyAction, addHierarchyPayload);

            if (hierarchyResult.success) {
                this.showToast(`子组「${groupName}」已创建`, 'success');
            } else {
                this.showToast('建立关系失败', 'error');
            }
        };

        saveBtn.onclick = save;
        cancelBtn.onclick = cleanup;

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
            }
        });
    }

    /**
     * [新增] 启动关键词添加模式。
     * @param {number} groupId - 目标组 ID。
     * @param {HTMLElement} keywordsContainer - 关键词容器 DOM 元素。
     */
    startKeywordAdd(groupId, keywordsContainer) {
        // 避免重复添加输入框
        if (keywordsContainer.querySelector('.keyword-add-input-wrapper')) return;

        keywordsContainer.classList.remove('hidden'); // 确保容器可见

        const wrapper = document.createElement('div');
        wrapper.className = "keyword-add-input-wrapper flex items-center gap-1 w-full bg-white rounded p-1 shadow-inner";
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '输入关键词 (Enter)...';
        input.className = "flex-1 p-0.5 text-xs focus:outline-none";
        input.setAttribute('list', 'tag-suggestions'); // 启用标签建议

        wrapper.appendChild(input);
        keywordsContainer.appendChild(wrapper);

        input.focus();

        // 先声明 handleClickOutside 变量，稍后定义
        let handleClickOutside = null;

        const cleanup = () => {
            if (handleClickOutside) {
                document.removeEventListener('click', handleClickOutside);
            }
            wrapper.remove();
        };

        const save = async () => {
            // 保存时立即移除监听器，防止重复触发
            if (handleClickOutside) {
                document.removeEventListener('click', handleClickOutside);
                handleClickOutside = null; // 清空引用防止再次移除
            }

            const keyword = input.value.trim();
            if (!keyword) {
                cleanup();
                return;
            }

            const payload = {
                group_id: groupId,
                keyword: keyword
            };

            const action = {
                url: '/api/rules/keyword/add',
                method: 'POST',
                type: 'keyword/add'
            };

            const result = await this.handleSave(action, payload);
            if (result.success) {
                // 成功后，由 handleSave 内部刷新 UI
            } else {
                // 失败后，手动清理输入框
                cleanup();
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
            }
        };
        input.addEventListener('keydown', handleKeyDown);

        // 点击外部保存逻辑
        handleClickOutside = (e) => {
             if (!wrapper.contains(e.target)) {
                 save();
             }
        };
        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }


    /**
     * [新增] 移除关键词。
     * @param {number} groupId - 目标组 ID。
     * @param {string} keyword - 目标关键词。
     */
    async removeKeyword(groupId, keyword) {
        if (!confirm(`确定要从该组移除关键词 "${keyword}" 吗?`)) {
            return;
        }

        const payload = {
            group_id: groupId,
            keyword: keyword
        };

        const action = {
            url: '/api/rules/keyword/remove',
            method: 'POST',
            type: 'keyword/remove'
        };

        const result = await this.handleSave(action, payload);
        if (result.success) {
            this.showToast(`关键词 "${keyword}" 已移除。`, 'success');
        }
    }


    /**
     * [新增] 启动组名编辑模式或新建根组模式。
     * @param {object|null} node - 当前组节点对象，null 表示新建根组。
     * @param {HTMLElement} displayEl - 组名显示的 DOM 元素（或容器）。
     * @param {HTMLElement} keywordsContainer - 关键词容器 (用于隐藏)。
     * @param {HTMLElement} childrenContainer - 子节点容器 (用于隐藏)。
     */
    /**
     * 显示添加新组的对话框
     */
    showAddGroupDialog() {
        const container = document.getElementById('rules-tree-container');

        if (!container) return;

        // 检查是否已有编辑框存在
        if (container.querySelector('.new-group-editor')) {
            return;
        }

        // 创建编辑框
        const editorWrapper = document.createElement('div');
        editorWrapper.className = 'new-group-editor mb-2 p-2 bg-white border border-blue-300 rounded-lg shadow-md flex flex-col gap-2';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '输入新组名...';
        input.className = 'w-full p-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400';

        const actionBtns = document.createElement('div');
        actionBtns.className = 'flex justify-end gap-2';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.className = 'px-3 py-1 text-xs bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '创建';
        saveBtn.className = 'px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition';

        actionBtns.appendChild(cancelBtn);
        actionBtns.appendChild(saveBtn);

        editorWrapper.appendChild(input);
        editorWrapper.appendChild(actionBtns);

        // 插入到规则树容器的顶部
        container.insertBefore(editorWrapper, container.firstChild);
        input.focus();

        // 清理函数
        const cleanup = () => {
            editorWrapper.remove();
        };

        // 保存函数
        const save = async () => {
            const groupName = input.value.trim();
            if (!groupName) {
                this.showToast('组名不能为空！', 'error');
                return;
            }

            const action = {
                url: '/api/rules/group/add',
                method: 'POST',
                type: 'group/add'
            };
            const payload = { group_name: groupName };

            const result = await this.handleSave(action, payload);
            if (result.success) {
                cleanup();
                this.showToast(`已创建组: ${groupName}`, 'success');
            }
        };

        // 绑定事件
        saveBtn.onclick = save;
        cancelBtn.onclick = cleanup;

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape') {
                cleanup();
            }
        });

        // 点击外部关闭
        const handleClickOutside = (e) => {
            if (!editorWrapper.contains(e.target) && e.target.id !== 'add-root-group-btn') {
                cleanup();
                document.removeEventListener('click', handleClickOutside);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 100);
    }

    /**
     * 启动组名编辑模式（仅用于编辑已有组）
     */
    startGroupEdit(node, displayEl, keywordsContainer, childrenContainer) {
        if (!node) return; // 新建组请使用 showAddGroupDialog

        const originalName = node.name || '';  // 处理空名组
        const originalIsEnabled = node.isEnabled;
        const isEmptyNameGroup = !originalName || originalName.trim() === '';

        // 隐藏其他内容
        displayEl.classList.add('hidden');
        if(keywordsContainer) keywordsContainer.classList.add('hidden');
        if(childrenContainer) childrenContainer.classList.add('hidden');

        // 创建输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalName;
        input.placeholder = isEmptyNameGroup ? '请输入组名以修复空名组...' : '输入组名...';
        input.className = `w-full p-1 border rounded text-sm font-medium focus:outline-none focus:ring-1 ${isEmptyNameGroup ? 'border-red-400 focus:ring-red-500 bg-red-50' : 'border-blue-400 focus:ring-blue-500'}`;

        const editorWrapper = document.createElement('div');
        editorWrapper.className = "group-editor-wrapper p-2 bg-white rounded shadow-md flex flex-col gap-2";

        // 组装操作按钮
        const actionBtns = document.createElement('div');
        actionBtns.className = "flex justify-between items-center text-xs";

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.className = "px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition";

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.className = "px-3 py-1 bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition";

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = originalIsEnabled ? '软删' : '恢复';
        deleteBtn.className = `px-3 py-1 text-white rounded transition ${originalIsEnabled ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`;
        deleteBtn.style.marginLeft = 'auto'; // 推到右边

        actionBtns.appendChild(cancelBtn);
        actionBtns.appendChild(deleteBtn);
        actionBtns.appendChild(saveBtn);

        editorWrapper.appendChild(input);
        editorWrapper.appendChild(actionBtns);

        // 替换组名显示区
        displayEl.parentElement.replaceChild(editorWrapper, displayEl);

        input.focus();

        // 先声明 handleClickOutside 变量，稍后定义
        let handleClickOutside = null;
        let isSaving = false; // 防止重复保存

        const cleanup = () => {
             // 清除事件监听器
             if (handleClickOutside) {
                 document.removeEventListener('click', handleClickOutside);
                 handleClickOutside = null;
             }
             input.removeEventListener('keydown', handleKeyDown);

             // 恢复 UI
             editorWrapper.remove();
             // 恢复组名显示
             editorWrapper.parentElement?.appendChild(displayEl);
             displayEl.classList.remove('hidden');
             this.debouncedRenderRulesTree(); // 使用防抖刷新
        };

        const save = async () => {
            // 防止重复保存
            if (isSaving) return;
            isSaving = true;

            // 立即移除监听器，防止重复触发
            if (handleClickOutside) {
                document.removeEventListener('click', handleClickOutside);
                handleClickOutside = null;
            }

            const newName = input.value.trim();
            if (!newName) {
                this.showToast('组名不能为空！', 'error');
                isSaving = false;
                return;
            }

            // 如果组名没有变化，直接清理不发请求
            if (newName === originalName) {
                cleanup();
                return;
            }

            const payload = {
                group_id: node.id,
                group_name: newName,
                is_enabled: originalIsEnabled
            };

            const action = {
                url: '/api/rules/group/update',
                method: 'POST',
                type: 'group/update'
            };

            const result = await this.handleSave(action, payload);
            if (!result.success) {
                cleanup(); // 如果保存失败，手动清理
            }
        };

        // 绑定事件
        saveBtn.onclick = save;
        cancelBtn.onclick = cleanup;
        deleteBtn.onclick = async () => {
            await this.toggleGroupEnabled(node);
            cleanup();
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
            }
        };
        input.addEventListener('keydown', handleKeyDown);

        // 点击外部关闭逻辑（赋值给已声明的变量）
        handleClickOutside = (e) => {
            if (!editorWrapper.contains(e.target) && e.target !== displayEl) {
                // 尝试保存
                save();
            }
        };
        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }


    /**
     * 手动刷新规则树（清除缓存并重新加载）
     */
    async refreshRulesTree() {
        const refreshBtn = document.getElementById('refresh-rules-btn');
        const icon = refreshBtn?.querySelector('i');

        // 添加旋转动画
        if (icon) {
            icon.classList.add('animate-spin');
        }

        this.showToast('正在刷新规则树...', 'info');

        // 清除本地缓存版本号，强制从服务器获取最新数据
        this.state.rulesBaseVersion = 0;
        localStorage.removeItem(RULES_VERSION_KEY);

        // 重置冲突警告标记，允许重新显示
        this._hasShownConflictWarning = false;

        try {
            await this.loadRulesTree(true);
            this.showToast('规则树已刷新', 'success');
        } catch (error) {
            console.error('刷新规则树失败:', error);
            this.showToast('刷新失败，请重试', 'error');
        } finally {
            // 移除旋转动画
            if (icon) {
                icon.classList.remove('animate-spin');
            }
        }
    }

    // 修正 loadRulesTree，使其在加载数据后调用 buildTree 和 renderRulesTree
    async loadRulesTree(forceRefresh = false) {
        // 1. 检查本地存储中的版本号和缓存数据
        const localVersion = this.state.rulesBaseVersion;
        const RULES_CACHE_KEY = 'bqbq_rules_cache';

        // 修复：将 headers 定义移入 try 块之前，确保其作用域覆盖整个函数
        const headers = {
            // 传递 ETag (版本号)
            'If-None-Match': localVersion.toString()
        };

        if (forceRefresh) {
            // 如果是强制刷新（如冲突后），移除缓存头
            delete headers['If-None-Match'];
        }

        try {
            const res = await fetch('/api/rules', { headers });

            if (res.status === 304) {
                console.log(`Rules synchronized: Version ${localVersion} is current.`);

                // 关键修复：从本地存储加载缓存的规则数据
                const cachedRulesData = localStorage.getItem(RULES_CACHE_KEY);
                if (cachedRulesData && !this.state.rulesTree) {
                    try {
                        const data = JSON.parse(cachedRulesData);
                        const buildResult = this.buildTree(data);
                        this.state.rulesTree = buildResult.rootNodes;
                        this.state.conflictNodes = buildResult.conflictNodes;
                        this.state.conflictRelations = buildResult.conflictRelations;
                        this.state.allKnownTags = data.keywords.map(k => k.keyword);
                        this.filterAndUpdateDatalist('');
                        console.log('[304] Loaded rules from localStorage cache');

                        // 首次加载时默认展开所有节点（如果 sessionStorage 中没有保存过状态）
                        this.state.initDefaultExpandState(this.state.rulesTree);
                    } catch (e) {
                        console.error('[304] Failed to parse cached rules:', e);
                    }
                }

                this.renderRulesTree(); // 渲染 UI
                return;
            }

            if (res.ok) {
                const data = await res.json();

                this.state.rulesBaseVersion = data.version_id;
                localStorage.setItem(RULES_VERSION_KEY, data.version_id.toString());

                // 缓存完整的规则数据到 localStorage
                try {
                    localStorage.setItem(RULES_CACHE_KEY, JSON.stringify(data));
                } catch (e) {
                    console.warn('Failed to cache rules to localStorage:', e);
                }

                // 3. 构建树结构
                const buildResult = this.buildTree(data);
                this.state.rulesTree = buildResult.rootNodes;
                this.state.conflictNodes = buildResult.conflictNodes;
                this.state.conflictRelations = buildResult.conflictRelations;

                // 4. 更新图片标签建议 (保持不变)
                this.state.allKnownTags = data.keywords.map(k => k.keyword);
                this.filterAndUpdateDatalist('');

                // 首次加载时默认展开所有节点（如果 sessionStorage 中没有保存过状态）
                this.state.initDefaultExpandState(this.state.rulesTree);

                // 5. 渲染侧边栏 UI
                this.renderRulesTree();

                console.log(`Rules tree loaded/updated to version ${data.version_id}`);

            } else {
                console.error(`Failed to load rules: HTTP ${res.status}`);
            }
        } catch (e) {
            console.error("Rules API call failed", e);
        }
    }

    /**
     * [框架] 在本地规则树上执行乐观更新。
     * 注意：这里仅是框架，实际的 CRUD 逻辑应该非常详细。
     * @param {string} actionType - 动作类型 (e.g., 'keyword/add', 'group/update')
     * @param {object} payload - 动作参数
     * @param {object} targetTree - 目标规则树 (this.state.rulesTree)
     * @returns {boolean} 是否成功执行乐观更新
     */
    updateRulesTreeOptimistically(actionType, payload, targetTree = this.state.rulesTree) {
        // 由于规则树操作复杂，此处仅提供一个示意框架。
        // 实际应用中，前端需要实现一套完整的本地规则树 CRUD 方法 (例如：
        // findGroup(id), addKeywordLocal(group, keyword), removeHierarchyLocal(p, c) 等)
        
        // 1. 确保 targetTree 存在且是可操作的。
        if (!targetTree || targetTree.length === 0) {
            if (actionType.endsWith('/add')) {
                // 如果是添加操作，且树为空，可以假设成功 (例如添加根组)
                console.warn(`[Optimistic] Tree empty, assuming success for ${actionType}`);
                return true; 
            }
            return false;
        }

        // 2. 根据 actionType 模拟本地修改
        try {
            switch (actionType) {
                case 'keyword/add':
                    // 示例：找到 group_id 并向其 keywords 数组中添加新词
                    // 查找逻辑复杂，暂时假设总是成功。
                    if (payload.keyword && payload.group_id) return true;
                    break;
                case 'hierarchy/add':
                    // 示例：检查是否形成环路，若无则添加 parent-child 引用
                    if (payload.parent_id && payload.child_id) return true;
                    break;
                // ... 其他 CRUD 逻辑
                default:
                    return true; 
            }
            return true; // 暂时假设大部分操作在本地有效
        } catch(e) {
            console.error("[Optimistic Update Failed]:", e);
            return false;
        }
    }


    /**
     * [框架] 基于服务器返回的新数据，检查本地操作是否依然有效。
     * 用于 409 冲突时的自动重放预演。
     * @param {string} actionType - 动作类型
     * @param {object} payload - 原始动作参数
     * @param {Array} newRulesTree - 服务器返回的最新规则树结构
     * @returns {boolean} 操作是否仍然有效
     */
    checkIfActionStillValid(actionType, payload, newRulesTree) {
        // 实现一个 findNode 函数来递归查找新树
        const findNode = (nodes, id) => {
            if (!nodes) return null;
            for (const node of nodes) {
                if (node.id === id) return node;
                const found = findNode(node.children, id);
                if (found) return found;
            }
            return null;
        };

        // 根据操作类型进行检查
        if (actionType.includes('group')) {
            if (actionType.includes('/toggle') || actionType.includes('/delete')) {
                // 启用/禁用或删除：目标组必须存在
                return !!findNode(newRulesTree, payload.group_id);
            }
            if (actionType.includes('/update') || actionType.includes('/remove')) {
                // 修改或删除：目标组必须存在
                return !!findNode(newRulesTree, payload.group_id);
            }
            if (actionType.includes('/add')) {
                // 添加操作：假设服务器会处理重复命名，允许重放
                return true;
            }
        }

        if (actionType.includes('keyword')) {
            const groupNode = findNode(newRulesTree, payload.group_id);
            if (!groupNode) return false; // 目标组已不存在

            const keywordExistsInGroup = groupNode.keywords.some(k => k.text === payload.keyword);

            if (actionType.includes('/remove')) {
                // 删除关键词操作：目标关键词必须存在才能重放
                return keywordExistsInGroup;
            }
            if (actionType.includes('/add')) {
                // 添加操作：只要目标 Group 存在，操作就有效
                return true;
            }
        }

        if (actionType.includes('hierarchy')) {
            // 层级操作：确保父子组都存在
            const parentExists = payload.parent_id === 0 || findNode(newRulesTree, payload.parent_id);

            // 支持批量移动（child_ids 数组）
            if (payload.child_ids && Array.isArray(payload.child_ids)) {
                // 批量移动：检查所有子组是否存在
                const allChildrenExist = payload.child_ids.every(childId => findNode(newRulesTree, childId));
                return !!parentExists && allChildrenExist;
            }

            // 单个移动（child_id）
            const childExists = findNode(newRulesTree, payload.child_id);
            return !!parentExists && !!childExists;
        }

        // 默认返回 true，以便触发重试，让服务器进行最终判断
        return true;
    }

    /**
     * 简单的 Toast 提示框框架。
     * @param {string} message - 消息内容
     * @param {string} type - 'success' or 'error'
     */
    showToast(message, type = 'info') {
        const toastEl = document.createElement('div');
        const bgColor = type === 'success' ? 'bg-green-500' : (type === 'error' ? 'bg-red-500' : 'bg-blue-500');
        
        toastEl.className = `fixed bottom-8 right-8 p-4 rounded-xl shadow-2xl text-white font-bold ${bgColor} z-50 transform translate-x-full transition-all duration-300`;
        toastEl.textContent = message;
        
        document.body.appendChild(toastEl);

        // 移入视图
        requestAnimationFrame(() => {
            toastEl.classList.remove('translate-x-full');
            
            // 3秒后移除
            setTimeout(() => {
                toastEl.classList.add('translate-x-full');
                toastEl.addEventListener('transitionend', () => toastEl.remove());
            }, 3000);
        });
    }

    /**
     * [框架] 如果保存最终失败，回滚本地乐观更新。
     * @param {string} actionType - 动作类型
     * @param {object} payload - 原始动作参数
     */
    revertOptimisticUpdate(actionType, payload) {
        // TODO: 实现复杂的本地规则树回滚逻辑
        console.warn(`[Revert] Need to implement rollback for ${actionType}`);
    }

    renderPageBlock(images) {
        const frag = document.createDocumentFragment();
        // 优化 LCP: 跟踪当前渲染的图片索引，首屏图片不使用懒加载
        let imageIndex = 0;
        const EAGER_LOAD_COUNT = 4; // 首屏前 4 张图片使用 eager 加载

        images.forEach(img => {
            // 前端过滤：非回收站模式下隐藏带 trash_bin 标签的图片
            const hasTrashTag = img.tags.includes('trash_bin') || img.is_trash;
            if (hasTrashTag && !this.state.isTrashMode) {
                return;
            }

            // 封装需要在事件委托中使用的图片数据，简化传输
            const infoForDelegation = JSON.stringify({
                md5: img.md5,
                filename: img.filename,
                is_trash: img.is_trash,
            });

            const card = document.createElement('div');
            // 优化 2. 简化昂贵 CSS: 移除 transition-all duration-300
            card.className = `meme-card group relative bg-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-lg aspect-square ${img.is_trash ? 'is-trash' : ''}`;
            card.dataset.md5 = img.md5;
            card.dataset.info = infoForDelegation; // 存储委托所需数据
            
            // --- Image Handling ---
            const imgEl = document.createElement('img');
            // 优化 LCP: 移除所有动效 (transition, hover:scale)
            imgEl.className = "image-element w-full h-full object-contain";
            // 优化 LCP: 首屏图片使用 eager 加载，其余使用 lazy 加载
            imgEl.loading = imageIndex < EAGER_LOAD_COUNT ? "eager" : "lazy";
            imageIndex++;
            
            const originalSrc = `/images/${img.filename}`;
            const thumbSrc = `/thumbnails/${img.filename}`;
            
            // Init Source
            if (this.state.preferHQ) {
                imgEl.src = originalSrc;
                // Since HQ loads directly, call loadOriginalImage to handle potential 503 errors on initial load
                imgEl.onload = () => { /* Initial load success */ };
                imgEl.onerror = () => { 
                    // If initial HQ load fails, try loading thumbnail first, then proceed with the retry logic.
                    // Or, simpler: just call the dedicated loader, which will handle the error overlay.
                    // Reset to thumbnail if HQ load fails initially, to allow retry.
                    imgEl.src = thumbSrc;
                    this.loadOriginalImage(originalSrc, imgEl, card);
                };
            } else {
                imgEl.src = thumbSrc;
                imgEl.dataset.original = originalSrc; // 存储原图地址用于委托加载
            }

            // --- UI Elements ---

            // Loader (Replaced Hourglass) (Node count: 1)
            const loader = document.createElement('div');
            loader.className = "loader-element absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-md z-10 hidden";
            // 优化 1. 替换 Lucide <i> 标签为 Inline SVG
            loader.innerHTML = SVG_ICONS.loader;

            // Top Toolbar (Node count: 1)
            const topBar = document.createElement('div');
            // 优化方案一: 从 opacity: 0 group-hover:opacity-100 升级为 hidden group-hover:flex
            // 优化 2. 简化昂贵 CSS: 移除 backdrop-blur
            topBar.className = "top-toolbar absolute top-0 left-0 right-0 p-2 flex justify-between items-start hidden group-hover:flex z-30"; // Increased z-index to be above error overlay
            
            // Left: Download (Node count: 1)
            const dlBtn = document.createElement('a');
            dlBtn.href = originalSrc;
            dlBtn.download = img.filename;
            dlBtn.className = "p-2 bg-black/40 text-white rounded-lg hover:bg-black/60 transition";
            // 下载按钮必须阻止冒泡，否则会触发事件委托的卡片点击逻辑
            dlBtn.onclick = (e) => e.stopPropagation(); 
            // 优化 1. 替换 Lucide <i> 标签为 Inline SVG
            dlBtn.innerHTML = SVG_ICONS.download;

            // Right Container & Buttons (Node count: 2. Eliminated one 'rightActions' div)
            
            // Copy Button (Node count: 1)
            const btnCopy = document.createElement('button');
            // 优化 1. 替换 Lucide <i> 标签为 Inline SVG
            btnCopy.innerHTML = SVG_ICONS.copy;
            btnCopy.className = `copy-btn p-2 bg-black/40 text-white rounded-lg hover:bg-black/60 transition ${img.is_trash ? '' : 'copy-btn'}`;

            // Delete/Refresh Button (Node count: 1)
            const btnDel = document.createElement('button');
            const trashIcon = img.is_trash ? SVG_ICONS.refresh : SVG_ICONS.trash;
            const trashClass = img.is_trash ? 'bg-red-500 text-white' : '';
            // 优化 1. 替换 Lucide <i> 标签为 Inline SVG
            btnDel.innerHTML = trashIcon;
            btnDel.className = `delete-btn p-2 rounded-lg hover:bg-black/60 transition ${trashClass} ${img.is_trash ? '' : 'bg-black/40 text-white'}`;
            // 注意：这里没有使用 createIconBtn，而是直接创建 DOM，减少函数调用开销

            // Right Actions Container (Eliminated, append buttons directly)
            const rightActionsHtml = `<div class="flex gap-2">${btnCopy.outerHTML}${btnDel.outerHTML}</div>`;
            
            topBar.appendChild(dlBtn);
            // 优化 2. 直接将 rightActions 的 HTML 字符串插入，而不是创建额外的 div 容器
            topBar.insertAdjacentHTML('beforeend', rightActionsHtml);

            // Bottom Overlay (Info + Tags) (Node count: 1)
            const overlay = document.createElement('div');
            overlay.className = "image-overlay absolute bottom-0 left-0 right-0 p-3 pt-8 flex flex-col justify-end text-white transition-opacity duration-300";

            // Info Line (Node count: 1. Combined 3 spans into one text node)
            const infoLine = document.createElement('div');
            // 优化 2. 移除 flex-col 和 gap-0 等不必要的类，简化布局
            infoLine.className = "image-info text-[12px] font-mono opacity-80 mb-1 leading-tight";
            const ext = img.filename.split('.').pop().toUpperCase();
            const sizeStr = (img.size / (1024 * 1024)).toFixed(3) + 'MB';
            // 优化 2. 将多行信息合并为一行文本内容
            infoLine.innerHTML = `${ext} <br> ${img.w}x${img.h} <br> ${sizeStr}`; 

            // Tags Container (Node count: 1)
            const tagsContainer = document.createElement('div');
            tagsContainer.className = "tags-container-element flex flex-wrap gap-1 cursor-pointer"; // 增加 class 用于委托识别
            this.renderOverlayTags(tagsContainer, img.tags);
            
            // Assemble
            overlay.appendChild(infoLine);
            overlay.appendChild(tagsContainer);
            
            card.appendChild(imgEl);
            card.appendChild(loader); // Added the new loader element
            card.appendChild(topBar);
            card.appendChild(overlay);

            frag.appendChild(card);
        });

        this.dom.grid.appendChild(frag);
        // 优化 1. 移除 Lucide 在循环中的调用，只在应用启动时调用一次
        // 注意：FAB 按钮仍在 index.html 中依赖 Lucide，但卡片内部已不再依赖
        // 由于 DOM 结构被修改，我们不再需要在这里重新创建图标。
        // lucide.createIcons(); 
    }

    // 辅助函数：这个函数现在主要用于 FAB 按钮，不再用于卡片内部
    createIconBtn(icon, onClick, extraClass = '') {
        const btn = document.createElement('button');
        // 优化 1. 移除 Lucide <i> 标签，直接使用 data-lucide (因为它是 FAB 按钮)
        btn.className = `p-2 bg-black/40 text-white rounded-lg hover:bg-black/60 transition ${extraClass}`; 
        btn.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i>`; 
        
        if (extraClass.includes('copy-btn') || extraClass.includes('delete-btn')) {
             // 对于卡片内的按钮，不绑定事件，交由委托处理
        } else {
             // 对于非卡片按钮（如 FAB），保留直接绑定
             btn.onclick = (e) => {
                 e.stopPropagation();
                 onClick(e);
             };
        }
        
        return btn;
    }

    renderOverlayTags(container, tags) {
        container.innerHTML = '';
        if (tags.length === 0) {
            container.innerHTML = '<span class="text-sm opacity-60 italic">&nbsp</span>';
            return;
        }
        tags.forEach(t => {
            const sp = document.createElement('span');
            // 优化 2. 简化昂贵 CSS: 移除 backdrop-blur-md，应用新的 CSS 类
            sp.className = "overlay-tag px-2 py-1 rounded text-sm font-medium shadow-sm"; 
            sp.textContent = t;
            container.appendChild(sp);
        });
    }

    async applyTempTags(imgData, card, tagsContainer) {
        if (this.state.tempTags.length === 0) return;
        
        // 由于是委托，我们从 DOM 中获取当前标签
        const currentTagsInDOM = Array.from(tagsContainer.querySelectorAll('.overlay-tag')).map(el => el.textContent);
        const oldTags = [...currentTagsInDOM];
        let changed = false;
        
        const tagsToAdd = this.state.tempTags.map(t => typeof t === 'object' ? t.text : t);

        tagsToAdd.forEach(t => {
            if (!currentTagsInDOM.includes(t)) {
                currentTagsInDOM.push(t);
                changed = true;
            }
        });

        if (changed) {
            try {
                this.renderOverlayTags(tagsContainer, currentTagsInDOM);
                // Visual feedback
                card.style.transform = "scale(0.95)";
                setTimeout(() => card.style.transform = "", 150);
                
                await fetch('/api/update_tags', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ md5: imgData.md5, tags: currentTagsInDOM })
                });
            } catch (e) {
                console.error("Failed to update tags", e);
                // Revert visual tags
                this.renderOverlayTags(tagsContainer, oldTags);
            }
        }
    }

    // --- Unified Editor logic using TagInput ---
    startOverlayEdit(imgData, cardEl, overlayEl, tagsContainerEl) {
        // Prevent opening multiple editors
        if (overlayEl.querySelector('.tag-editor-container')) return;

        tagsContainerEl.classList.add('hidden');

        // Create container for TagInput
        const editorContainer = document.createElement('div');
        editorContainer.className = "tag-editor-container w-full bg-white/95 rounded p-1 flex flex-wrap gap-1 items-center animate-in fade-in slide-in-from-bottom-2 border border-blue-300 shadow-lg text-slate-800";
        
        // Stop propagation so clicking editor doesn't close it
        editorContainer.onclick = (e) => e.stopPropagation();

        overlayEl.insertBefore(editorContainer, tagsContainerEl);

        let currentTags = [...imgData.tags];

        // Initialize TagInput
        const tagInput = new TagInput({
            container: editorContainer,
            initialTags: currentTags,
            suggestionsId: 'tag-suggestions',
            placeholder: '添加标签...',
            theme: 'blue',
            enableExcludes: false,
            autoFocus: true,
            onChange: (newTags) => {
                currentTags = newTags;
            },
            onSubmit: () => {
                // Handle Enter key on empty input -> Close and Save
                finishAndSave();
            }
        });

        // Click Outside Handler
        const handleClickOutside = (e) => {
            // Check if click is outside the editor container
            if (!editorContainer.contains(e.target)) {
                finishAndSave();
            }
        };

        // Delay attaching the click listener slightly to avoid triggering immediately on the opening click
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0);

        const finishAndSave = async () => {
            document.removeEventListener('click', handleClickOutside);
            
            // Commit any pending text in the input
            const pendingText = tagInput.input.value.trim();
            if (pendingText) {
                if(!currentTags.includes(pendingText)) currentTags.push(pendingText);
            }

            const oldTags = imgData.tags;
            const oldIsTrash = imgData.is_trash;
            imgData.tags = currentTags;

            // Check trash bin status
            const hasTrash = imgData.tags.includes('trash_bin');
            if (hasTrash !== imgData.is_trash) {
                imgData.is_trash = hasTrash;
                // 在卡片数据中更新 is_trash 状态（用于事件委托逻辑）
                const cardInfo = JSON.parse(cardEl.dataset.info);
                cardInfo.is_trash = imgData.is_trash;
                cardEl.dataset.info = JSON.stringify(cardInfo);
                
                this.updateCardTrashUI(imgData, cardEl, cardEl.querySelector('.top-toolbar .delete-btn'));
            }

            // Cleanup DOM
            editorContainer.remove();
            tagsContainerEl.classList.remove('hidden');
            this.renderOverlayTags(tagsContainerEl, imgData.tags);

            // Network Request
            try {
                await fetch('/api/update_tags', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ md5: imgData.md5, tags: imgData.tags })
                });
            } catch (e) {
                console.error("Save failed", e);
                imgData.tags = oldTags;
                imgData.is_trash = oldIsTrash;
                this.renderOverlayTags(tagsContainerEl, imgData.tags);
                // Revert trash UI if failed
                const cardInfo = JSON.parse(cardEl.dataset.info);
                cardInfo.is_trash = imgData.is_trash;
                cardEl.dataset.info = JSON.stringify(cardInfo);
                this.updateCardTrashUI(imgData, cardEl, cardEl.querySelector('.top-toolbar .delete-btn'));
            }
        };
    }

    async toggleTrash(imgData, cardEl, btnEl, e) {
        const oldState = imgData.is_trash;
        const oldTags = [...imgData.tags];

        // Toggle logic
        const isNowTrash = !imgData.is_trash;
        imgData.is_trash = isNowTrash;
        
        // Update Tags
        if (isNowTrash) {
            if (!imgData.tags.includes('trash_bin')) imgData.tags.push('trash_bin');
        } else {
            imgData.tags = imgData.tags.filter(t => t !== 'trash_bin');
        }
        
        // 在卡片数据中更新 is_trash 状态
        const cardInfo = JSON.parse(cardEl.dataset.info);
        cardInfo.is_trash = imgData.is_trash;
        cardEl.dataset.info = JSON.stringify(cardInfo);

        // Update UI
        this.updateCardTrashUI(imgData, cardEl, btnEl);
        
        // Update Overlay Tags UI based on updated imgData.tags
        const tagsContainer = cardEl.querySelector('.tags-container-element');
        if (tagsContainer) {
            this.renderOverlayTags(tagsContainer, imgData.tags);
        }
        
        try {
            await fetch('/api/update_tags', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ md5: imgData.md5, tags: imgData.tags })
            });
        } catch(err) {
            console.error("Trash toggle failed", err);
            // Revert
            imgData.is_trash = oldState;
            imgData.tags = oldTags;
            // Revert card data
            cardInfo.is_trash = imgData.is_trash;
            cardEl.dataset.info = JSON.stringify(cardInfo);
            
            this.updateCardTrashUI(imgData, cardEl, btnEl);
            if (tagsContainer) {
                this.renderOverlayTags(tagsContainer, imgData.tags);
            }
        }
    }

    // 优化 1. 移除 Lucide.createIcons 调用
    updateCardTrashUI(imgData, cardEl, btnEl) {
         if (imgData.is_trash) {
            cardEl.classList.add('is-trash');
            btnEl.innerHTML = SVG_ICONS.refresh;
            btnEl.classList.add('bg-red-500', 'text-white');
            btnEl.classList.remove('bg-black/40');
        } else {
            cardEl.classList.remove('is-trash');
            btnEl.innerHTML = SVG_ICONS.trash;
            btnEl.classList.remove('bg-red-500', 'text-white');
            btnEl.classList.add('bg-black/40');
        }
        // !!! 移除 lucide.createIcons();
    }

    // 优化 1. 移除 Lucide.createIcons 调用
    copyText(text, btn) {
        // Fallback for insecure contexts
        const doCopy = (txt) => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(txt);
            } else {
                // Legacy fallback
                const textArea = document.createElement("textarea");
                textArea.value = txt;
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    return Promise.resolve();
                } catch (err) {
                    document.body.removeChild(textArea);
                    return Promise.reject(err);
                }
            }
        };

        doCopy(text).then(() => {
            const original = btn.innerHTML;
            btn.classList.remove('bg-black/40', 'text-white');
            btn.classList.add('bg-green-500', 'text-white');
            // 优化 1. 替换 Lucide <i> 标签为 Inline SVG
            btn.innerHTML = SVG_ICONS.check;
            // !!! 移除 lucide.createIcons();
            setTimeout(() => {
                btn.classList.add('bg-black/40');
                btn.classList.remove('bg-green-500');
                btn.innerHTML = original;
                // !!! 移除 lucide.createIcons();
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy', err);
        });
    }

    /**
     * [新增] 切换组的启用/禁用状态
     * @param {object} node - 组节点对象
     */
    async toggleGroupEnabled(node) {
        const newState = node.isEnabled ? 0 : 1;
        const actionText = newState ? '启用' : '禁用';
        const displayName = node.name || '[无名组]';

        // 使用专用的启用/禁用接口
        const payload = {
            group_id: node.id,
            is_enabled: newState
        };

        const action = {
            url: '/api/rules/group/toggle',
            method: 'POST',
            type: 'group/toggle'
        };

        const result = await this.handleSave(action, payload);
        if (result.success) {
            // 状态变化后重新加载规则树数据
            await this.loadRulesTree(true);
            this.showToast(`组「${displayName}」已${actionText}`, 'success');
        }
    }

    /**
     * [重写] 彻底删除一个组（调用后端级联删除接口）
     * @param {number} groupId - 组ID
     */
    async deleteGroup(groupId) {
        // 在本地树中查找组信息用于显示
        const findGroupRecursive = (nodes, id) => {
            if (!nodes) return null;
            for (const node of nodes) {
                if (node.id == id) return node;
                const found = findGroupRecursive(node.children, id);
                if (found) return found;
            }
            return null;
        };

        const group = findGroupRecursive(this.state.rulesTree, groupId);
        if (!group) {
            this.showToast('组不存在', 'error');
            return;
        }

        // 计算子组数量用于提示
        const countDescendants = (node) => {
            let count = 0;
            if (node.children) {
                count = node.children.length;
                node.children.forEach(child => {
                    count += countDescendants(child);
                });
            }
            return count;
        };

        const descendantCount = countDescendants(group);
        const displayName = group.name || '[无名组]';
        const confirmMsg = descendantCount > 0
            ? `确定要彻底删除组「${displayName}」吗？\n\n这将同时删除其 ${descendantCount} 个子组及所有关键词。\n此操作无法撤销！`
            : `确定要彻底删除组「${displayName}」吗？\n\n此操作无法撤销！`;

        if (!confirm(confirmMsg)) return;

        const payload = {
            group_id: groupId
        };

        const action = {
            url: '/api/rules/group/delete',
            method: 'POST',
            type: 'group/delete'
        };

        const result = await this.handleSave(action, payload);
        if (result.success) {
            // 删除成功后重新加载规则树数据
            await this.loadRulesTree(true);
            const deletedCount = result.deleted_count || 1;
            this.showToast(`已删除 ${deletedCount} 个组`, 'success');
        }
    }

    // =========================================================================
    // --- 批量编辑功能 ---
    // =========================================================================

    /**
     * 展开所有组
     */
    expandAllGroups() {
        if (!this.state.rulesTree) return;

        // 收集所有组ID
        const collectAllIds = (nodes) => {
            nodes.forEach(node => {
                this.state.expandedGroupIds.add(node.id);
                collectAllIds(node.children);
            });
        };
        collectAllIds(this.state.rulesTree);

        // 保存状态并重新渲染
        this.state.saveExpandedState();
        this.renderRulesTree(true);
    }

    /**
     * 折叠所有组
     */
    collapseAllGroups() {
        // 清空展开状态
        this.state.expandedGroupIds.clear();

        // 保存状态并重新渲染
        this.state.saveExpandedState();
        this.renderRulesTree(true);
    }

    /**
     * 切换批量编辑模式
     */
    toggleBatchMode() {
        this.state.batchEditMode = !this.state.batchEditMode;

        // 退出批量编辑模式时清空选中
        if (!this.state.batchEditMode) {
            this.state.selectedGroupIds.clear();
        }

        // 更新工具栏UI
        this.updateBatchToolbarUI();

        // 重新渲染规则树
        this.renderRulesTree(true);
    }

    /**
     * 切换单个组的选中状态
     * @param {number} groupId - 组ID
     */
    toggleGroupSelection(groupId) {
        if (this.state.selectedGroupIds.has(groupId)) {
            this.state.selectedGroupIds.delete(groupId);
        } else {
            this.state.selectedGroupIds.add(groupId);
        }

        // 更新工具栏UI显示选中数量
        this.updateBatchToolbarUI();

        // 重新渲染规则树
        this.renderRulesTree(true);
    }

    /**
     * 全选/取消全选
     */
    toggleSelectAll() {
        if (!this.state.rulesTree) return;

        // 收集所有组ID
        const allGroupIds = new Set();
        const collectIds = (nodes) => {
            nodes.forEach(node => {
                allGroupIds.add(node.id);
                collectIds(node.children);
            });
        };
        collectIds(this.state.rulesTree);

        // 判断当前是否全选
        const isAllSelected = allGroupIds.size === this.state.selectedGroupIds.size;

        if (isAllSelected) {
            // 取消全选
            this.state.selectedGroupIds.clear();
        } else {
            // 全选
            this.state.selectedGroupIds = allGroupIds;
        }

        this.updateBatchToolbarUI();
        this.renderRulesTree(true);
    }

    /**
     * 更新批量编辑工具栏UI
     */
    updateBatchToolbarUI() {
        const batchModeBtn = document.getElementById('batch-mode-btn');
        const batchSelectedInfo = document.getElementById('batch-selected-info');
        const batchActionsRow = document.getElementById('batch-actions-row');
        const countSpan = document.getElementById('batch-selected-count');

        // 更新批量按钮样式
        if (batchModeBtn) {
            if (this.state.batchEditMode) {
                batchModeBtn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
                batchModeBtn.classList.remove('bg-white', 'text-blue-600');
            } else {
                batchModeBtn.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                batchModeBtn.classList.add('bg-white', 'text-blue-600');
            }
        }

        // 批量模式下显示已选数量和操作按钮行，否则隐藏
        if (batchSelectedInfo) {
            if (this.state.batchEditMode) {
                batchSelectedInfo.classList.remove('hidden');
            } else {
                batchSelectedInfo.classList.add('hidden');
            }
        }

        // 控制第二行操作按钮的显示/隐藏
        if (batchActionsRow) {
            if (this.state.batchEditMode) {
                batchActionsRow.classList.remove('hidden');
            } else {
                batchActionsRow.classList.add('hidden');
            }
        }

        // 更新选中数量
        if (countSpan) {
            countSpan.textContent = this.state.selectedGroupIds.size;
        }
    }

    /**
     * 批量启用选中的组
     */
    async batchEnableGroups() {
        const ids = Array.from(this.state.selectedGroupIds);
        if (ids.length === 0) {
            this.showToast('请先选择要操作的组', 'error');
            return;
        }

        if (!confirm(`确定要启用选中的 ${ids.length} 个组吗？`)) return;

        const action = { url: '/api/rules/group/batch', method: 'POST', type: 'group/batch' };
        const payload = { group_ids: ids, action: 'enable' };
        const result = await this.handleSave(action, payload);

        if (result.success) {
            this.state.selectedGroupIds.clear();
            this.updateBatchToolbarUI();
            this.showToast(`已启用 ${result.affected_count || ids.length} 个组`, 'success');
        }
    }

    /**
     * 批量禁用选中的组
     */
    async batchDisableGroups() {
        const ids = Array.from(this.state.selectedGroupIds);
        if (ids.length === 0) {
            this.showToast('请先选择要操作的组', 'error');
            return;
        }

        if (!confirm(`确定要禁用选中的 ${ids.length} 个组吗？`)) return;

        const action = { url: '/api/rules/group/batch', method: 'POST', type: 'group/batch' };
        const payload = { group_ids: ids, action: 'disable' };
        const result = await this.handleSave(action, payload);

        if (result.success) {
            this.state.selectedGroupIds.clear();
            this.updateBatchToolbarUI();
            this.showToast(`已禁用 ${result.affected_count || ids.length} 个组`, 'success');
        }
    }

    /**
     * 批量删除选中的组
     */
    async batchDeleteGroups() {
        const ids = Array.from(this.state.selectedGroupIds);
        if (ids.length === 0) {
            this.showToast('请先选择要删除的组', 'error');
            return;
        }

        if (!confirm(`确定要彻底删除选中的 ${ids.length} 个组吗？\n\n⚠️ 此操作将递归删除所有子组和关键词，无法撤销！`)) return;

        const action = { url: '/api/rules/group/batch', method: 'POST', type: 'group/batch' };
        const payload = { group_ids: ids, action: 'delete' };
        const result = await this.handleSave(action, payload);

        if (result.success) {
            this.state.selectedGroupIds.clear();
            this.updateBatchToolbarUI();
            this.showToast(`已删除 ${result.affected_count || ids.length} 个组`, 'success');
        }
    }

    /**
     * 更新规则树搜索建议
     */
    updateTreeSearchSuggestions() {
        const datalist = document.getElementById('tree-suggestions');
        if (!datalist) return;

        datalist.innerHTML = '';

        // 收集所有组名和关键词
        const suggestions = new Set();

        if (this.state.rulesTree) {
            this.state.rulesTree.forEach(group => {
                suggestions.add(group.name);
                group.keywords.forEach(kw => suggestions.add(kw.text));
            });
        }

        // 添加到datalist
        Array.from(suggestions).sort().forEach(text => {
            const option = document.createElement('option');
            option.value = text;
            datalist.appendChild(option);
        });
    }

    /**
     * 筛选并高亮显示规则树节点，自动展开匹配节点及其父节点
     * @param {string} searchText - 搜索关键词
     */
    filterRulesTree(searchText) {
        const normalizedSearch = searchText.toLowerCase().trim();

        if (!normalizedSearch) {
            // 清空搜索：重新渲染规则树（恢复到之前的展开状态）
            this.renderRulesTree(true);
            return;
        }

        // 收集所有需要展开的节点ID（匹配节点及其所有祖先）
        const nodesToExpand = new Set();

        /**
         * 递归查找匹配节点，并收集需要展开的节点ID
         * @param {Array} nodes - 节点数组
         * @param {Array} ancestors - 祖先节点ID数组
         * @returns {boolean} 是否有匹配的子孙节点
         */
        const findMatchingNodes = (nodes, ancestors = []) => {
            let hasMatchingDescendant = false;

            for (const node of nodes) {
                const currentAncestors = [...ancestors, node.id];

                // 检查组名匹配
                const groupNameMatch = node.name && node.name.toLowerCase().includes(normalizedSearch);

                // 检查关键词匹配
                const keywordMatch = node.keywords.some(k =>
                    k.text.toLowerCase().includes(normalizedSearch)
                );

                // 递归检查子节点
                const childHasMatch = findMatchingNodes(node.children, currentAncestors);

                // 如果当前节点或其子孙匹配，展开所有祖先
                if (groupNameMatch || keywordMatch || childHasMatch) {
                    hasMatchingDescendant = true;
                    // 展开当前节点自身（显示其关键词/同义词）
                    nodesToExpand.add(node.id);
                    // 展开所有祖先节点
                    ancestors.forEach(id => nodesToExpand.add(id));
                }
            }

            return hasMatchingDescendant;
        };

        // 执行搜索
        if (this.state.rulesTree) {
            findMatchingNodes(this.state.rulesTree);
        }

        // 更新展开状态并重新渲染
        nodesToExpand.forEach(id => this.state.expandedGroupIds.add(id));
        this.state.saveExpandedState();
        this.renderRulesTree(true);

        // 滚动到第一个匹配项
        const container = document.getElementById('rules-tree-container');
        if (container) {
            const firstMatch = container.querySelector('.group-node.bg-blue-50');
            if (firstMatch) {
                firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    /**
     * 导出所有数据为JSON文件
     */
    async exportAllData() {
        try {
            this.showToast('正在导出数据...', 'info');

            const response = await fetch('/api/export/all');
            const data = await response.json();

            // 创建下载链接
            const dataStr = JSON.stringify(data, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `bqbq_export_${Date.now()}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this.showToast(`导出成功！（${data.images.length} 张图片）`, 'success');

        } catch (error) {
            console.error('Export error:', error);
            this.showToast(`导出失败：${error.message}`, 'error');
        }
    }

    /**
     * 从JSON文件导入数据
     * @param {File} file - JSON文件
     */
    async importAllData(file) {
        try {
            this.showToast('正在导入数据...', 'info');

            const fileContent = await file.text();
            const data = JSON.parse(fileContent);

            const response = await fetch('/api/import/all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
                this.showToast(
                    `导入成功！新增 ${result.imported_images} 张，跳过 ${result.skipped_images} 张`,
                    'success'
                );

                // 重新加载规则树和搜索结果
                await this.loadRulesTree(true);
                this.resetSearch();
            } else {
                this.showToast(`导入失败：${result.error}`, 'error');
            }

        } catch (error) {
            console.error('Import error:', error);
            this.showToast(`导入失败：${error.message}`, 'error');
        }
    }

    /**
     * 计算文件的MD5哈希值
     * @param {File} file - 要计算的文件
     * @returns {Promise<string>} MD5哈希值
     */
    async calculateMD5(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            const spark = new SparkMD5.ArrayBuffer();

            reader.onload = (e) => {
                spark.append(e.target.result);
                const md5 = spark.end();
                resolve(md5);
            };

            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * 检查MD5是否已存在，并可选择刷新上传时间
     * @param {string} md5 - MD5哈希值
     * @param {boolean} refreshTime - 是否刷新上传时间（用于重复图片）
     * @returns {Promise<object>} {exists: boolean, filename: string, time_refreshed: boolean}
     */
    async checkMD5Exists(md5, refreshTime = false) {
        const response = await fetch('/api/check_md5', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ md5, refresh_time: refreshTime })
        });
        return await response.json();
    }

    async handleUpload(files) {
        if (files.length === 0) return;
        const btn = this.dom.fabUpload;
        const originalContent = btn.innerHTML;
        // FAB 按钮使用 Lucide，所以保留其调用
        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-7 h-7"></i>`;
        lucide.createIcons();

        try {
            for (let file of files) {
                // 1. 计算MD5
                const md5 = await this.calculateMD5(file);
                console.log(`File MD5: ${md5}`);

                // 2. 检查是否已存在，如果存在则刷新时间戳
                const checkResult = await this.checkMD5Exists(md5, true);

                if (checkResult.exists) {
                    // 重复文件：已在后端刷新时间戳
                    if (checkResult.time_refreshed) {
                        this.showToast(`图片已存在：${file.name}（已更新时间戳）`, 'info');
                    } else {
                        this.showToast(`图片已存在：${file.name}`, 'info');
                    }
                    continue;
                }

                // 3. 上传新文件
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    console.log('Upload successful:', result.msg);
                    this.showToast(`上传成功：${file.name}`, 'success');
                } else {
                    console.error('Upload failed:', result.error);
                    this.showToast(`上传失败：${result.error}`, 'error');
                }
            }

            // 完成后刷新搜索
            this.resetSearch();
        } catch (e) {
            console.error("Upload failed", e);
            this.showToast(`上传出错：${e.message}`, 'error');
        } finally {
            btn.innerHTML = originalContent;
            lucide.createIcons();
        }
    }
}

window.app = new MemeApp();