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
        if (this.enableExcludes && text.startsWith('-') && text.length > 1) {
            isExclude = true;
            text = text.substring(1);
        }

        // Avoid duplicates (taking exclude status into account for search)
        const exists = this.tags.some(t => {
            const tText = typeof t === 'string' ? t : t.text;
            const tExclude = typeof t === 'string' ? false : t.exclude;
            return tText === text && tExclude === isExclude;
        });

        if (!exists) {
            const newTag = this.enableExcludes ? { text, exclude: isExclude } : text;
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
        const text = this.enableExcludes ? (tag.exclude ? '-' : '') + tag.text : tag;

        // 3. Remove it from the list
        this.tags.splice(index, 1);
        this.onChange(this.tags); // Update state immediately (though visual update happens in render)

        // 4. Put text into input and render
        this.input.value = text;
        this.render();
        this.input.focus();
    }

    getStyle(isExclude) {
        if (isExclude) return 'bg-red-100 text-red-600 border border-red-200 hover:bg-red-200';
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

            const capsule = document.createElement('div');
            capsule.className = `tag-capsule flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold cursor-pointer select-none whitespace-nowrap transition-transform active:scale-95 ${this.getStyle(isExclude)} 
                                 max-w-full break-all`;
            capsule.classList.remove('whitespace-nowrap');       

            // Text Part (Click to Edit)
            const spanText = document.createElement('span');
            spanText.textContent = (isExclude ? '-' : '') + text;
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
        // 存储从后端加载并解析后的语义森林规则树结构
        this.rulesTree = null; 
        
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
            btnClearSearch: document.getElementById('clear-search-btn'),
            
            // Indicators / Panels
            hqDot: document.getElementById('hq-status-dot'),
            trashDot: document.getElementById('trash-active-dot'),
            sortMenu: document.getElementById('sort-menu'),
            tempPanel: document.getElementById('temp-tag-panel'),
            
            fileInput: document.getElementById('file-upload'),
            btnReload: document.getElementById('reload-search-btn'),
            
            loader: document.getElementById('loading-indicator'),
            end: document.getElementById('end-indicator'),

            // --- 新增 Rules Tree 相关的 DOM 元素 ---
            fabTree: document.getElementById('fab-tree'),
            rulesPanel: document.getElementById('rules-tree-panel'),
            rulesForceSync: document.getElementById('rules-force-sync'),
            rulesTreeContainer: document.getElementById('rules-tree-container'),
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

        // --- 核心修改：先加载规则树，再加载图片元数据 ---
        await this.loadRulesTree(); // 新增加载规则树的调用
        await this.loadMeta();
        this.loadMore();
    }

    async loadRulesTree(forceRefresh = false) {
    // 1. 检查本地存储中的版本号
        const localVersion = this.state.rulesBaseVersion;
        
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
            // BUG: ReferenceError: headers is not defined
            // 修复：headers 变量已在 try 块之前定义
            const res = await fetch('/api/rules', { headers });

            if (res.status === 304) {
                console.log(`Rules synchronized: Version ${localVersion} is current.`);
                this.renderRulesTree(); // 规则未变，但刷新版本号和 UI
                // 304 Not Modified: 规则未变，无需操作
                return;
            }

            if (res.ok) {
                const data = await res.json();
                
                // 2. 更新版本号和规则数据
                this.state.rulesBaseVersion = data.version_id;
                localStorage.setItem(RULES_VERSION_KEY, data.version_id.toString());
                
                // 3. 构建树结构（假设有 buildTree 函数）
                this.state.rulesTree = this.buildTree(data); 
                
                // 4. 更新图片标签建议（与现有 loadMeta 逻辑分离，但可能需要更新）
                // 暂时使用所有关键词作为图片标签建议
                this.state.allKnownTags = data.keywords.map(k => k.keyword); 
                this.filterAndUpdateDatalist(''); 
                
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
     * 将扁平的 groups, keywords, hierarchy 数据组装成嵌套的 Tree 对象。
     * @param {object} data - 包含 groups, keywords, hierarchy 的扁平数据对象。
     * @returns {Array} 嵌套的树结构数组。
     */

    buildTree(data) {
        if (!data || !data.groups) {
            console.error("Invalid data structure for building tree:", data);
            return [];
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
                parentId: null, // 临时用于识别根节点
                isRoot: true    // 临时标记
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

        // 3. 构建层级关系
        data.hierarchy.forEach(h => {
            const parent = groupsMap.get(h.parent_id);
            const child = groupsMap.get(h.child_id);
            
            if (parent && child) {
                parent.children.push(child);
                child.parentId = parent.id;
                child.isRoot = false; // 有父节点，不是根节点
            }
        });

        // 4. 提取根节点 (没有 parentId 或 isRoot 仍为 true 的节点)
        const rootNodes = [];
        groupsMap.forEach(node => {
            if (node.isRoot) {
                // 清理临时标记
                delete node.isRoot;
                delete node.parentId;
                rootNodes.push(node);
            }
        });
        
        // 5. 递归清理子节点的临时标记 (因为子节点可能在其他地方被引用)
        const cleanNode = (node) => {
             delete node.isRoot;
             delete node.parentId;
             node.children.forEach(cleanNode);
        };
        rootNodes.forEach(cleanNode);

        console.log("Tree built successfully.", rootNodes);
        return rootNodes;
    }

    /**
     * 根据用户输入的关键词/组名，从规则树中膨胀出所有匹配的关键词。
     * @param {Array<string|object>} inputs - 用户输入的标签数组 (string 或 {text, exclude} 格式)。
     * @returns {{expandedKeywords: Array<string>}} 包含所有膨胀后的关键词数组。
     */

    expandKeywords(inputs) {
        if (!this.state.rulesTree) return { expandedKeywords: [] };
        
        const rawInputs = inputs.map(t => typeof t === 'object' ? t.text : t);
        const uniqueKeywords = new Set();
        
        /**
         * 递归查找组及其所有子组下的关键词。
         * @param {Object} node - 当前组节点。
         */
        const recursivelyCollectKeywords = (node) => {
            // 收集当前组所有 'is_enabled=1' 的关键词
            node.keywords
                .filter(k => k.isEnabled)
                .forEach(k => uniqueKeywords.add(k.text));
            
            // 递归进入子组
            node.children.forEach(recursivelyCollectKeywords);
        };

        // 遍历整个规则树进行匹配
        const traverseAndMatch = (nodes) => {
            nodes.forEach(node => {
                // 1. 检查是否直接命中组名
                if (rawInputs.includes(node.name)) {
                    recursivelyCollectKeywords(node);
                    return; // 组名命中后，不再检查其关键词（避免重复膨胀）
                }

                // 2. 检查是否命中关键词
                const matchedKeyword = node.keywords.find(k => rawInputs.includes(k.text));
                
                if (matchedKeyword && matchedKeyword.isEnabled) {
                    uniqueKeywords.add(matchedKeyword.text);
                }
                
                // 3. 递归检查子节点
                traverseAndMatch(node.children);
            });
        };

        traverseAndMatch(this.state.rulesTree);
        
        // 将 Set 转换为数组返回
        return { expandedKeywords: Array.from(uniqueKeywords) };
    }

    /**
     * 核心：处理规则树的写入操作，包含乐观锁、冲突检测和自动重放。
     * @param {object} action - 包含 url 和 method 的操作定义。
     * @param {object} payload - 包含 group_id, keyword 等业务参数。
     * @returns {Promise<object>} 包含 success 状态和 version_id 的结果对象。
     */

    async handleSave(action, payload) {
        let currentVersion = this.state.rulesBaseVersion;
        const client_id = this.state.clientId;

        const actionType = action.type; // 新增：用于识别操作类型

        // --- 1. 乐观更新 ---
        const optimisticSuccess = this.updateRulesTreeOptimistically(actionType, payload);
        if (optimisticSuccess) {
            this.renderRulesTree(); // 渲染新的本地状态
        }
        
        // --- 1. 乐观更新（TODO: 预先修改 this.state.rulesTree） ---
        // Optimistic Update Here: this.updateRulesTreeOptimistically(action, payload);
        
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
                console.warn(`Conflict detected! Base version ${currentVersion}, server has updated. Unique modifiers: ${conflictData.unique_modifiers}`);
                
                // --- 冲突处理 (409) ---
                
                // A. 静默更新基准数据
                this.state.rulesBaseVersion = conflictData.latest_data.version_id;
                localStorage.setItem(RULES_VERSION_KEY, conflictData.latest_data.version_id.toString());
                
                // 重新构建本地规则树 (使用服务器最新的数据)
                const newRulesTree = this.buildTree(conflictData.latest_data);
                this.state.rulesTree = newRulesTree;
                
                // B. 预演/检查有效性
                // TODO: checkIfActionStillValid(payload, this.state.rulesTree);
                const stillValid = this.checkIfActionStillValid(actionType, payload, newRulesTree);

                if (stillValid) {
                    // C. 自动重放
                    console.log("Action still valid, attempting automatic replay with new base version.");
                    
                    // 递归调用 handleSave，但跳过乐观更新步骤 (因为数据已经是最新的)
                    const replayResult = await this.handleSave(action, payload); 
                    
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
                
                // 3. 重新拉取规则树（确保UI与服务器状态一致）
                // 仅在成功后刷新版本和 UI，避免额外 API 调用
                this.renderRulesTree(); 
                
                this.showToast('规则保存成功！', 'success');
                
                return { success: true, version_id: result.version_id };
            }
            
            throw new Error(`Server returned error status: ${response.status}`);
            
        } catch (e) {
            console.error("Save failed (final):", e);
            // E. 最终失败，回滚本地乐观更新 (如果需要)
            // this.revertOptimisticUpdate(actionType, payload); 
            this.renderRulesTree(); // 简单粗暴：强制刷新回上次成功状态
            
            this.showToast('保存失败：网络或服务器错误。', 'error');
            return { success: false, error: e.message };
        }
    }
            

    // 新增方法：负责筛选标签和更新 datalist
    filterAndUpdateDatalist(currentInput) {
        const dl = document.getElementById('tag-suggestions');
        if (!dl) return;

        const MAX_SUGGESTIONS = 4;
        
        // 1. 根据当前输入进行动态筛选 (不区分大小写，包含匹配)
        const filtered = this.state.allKnownTags.filter(tag => 
            tag.toLowerCase().includes(currentInput.toLowerCase())
        );
        
        // 2. 限制最多只显示 MAX_SUGGESTIONS 个
        const limitedTags = filtered.slice(0, MAX_SUGGESTIONS);

        // 3. 更新 datalist 的内容
        dl.innerHTML = limitedTags.map(t => `<option value="${t}">`).join('');
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
                // Check trash mode automatically
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
            // Toggle trash_bin tag in search
            const hasTrash = this.state.queryTags.some(t => t.text === 'trash_bin');
            if (hasTrash) {
                // Remove it via TagInput method to ensure UI sync
                const idx = this.state.queryTags.findIndex(t => t.text === 'trash_bin');
                if (idx !== -1) this.headerTagInput.removeTag(idx);
            } else {
                this.headerTagInput.addTag('trash_bin');
            }
            // State update is handled by onChange callback of TagInput
            this.doSearch();
        };

        this.dom.fabTemp.onclick = () => {
            this.state.isTempTagMode = !this.state.isTempTagMode;
            if (this.state.isTempTagMode) {
                this.dom.tempPanel.classList.remove('hidden');
                this.dom.tempPanel.classList.add('flex');
                this.dom.fabTemp.classList.add('bg-purple-100', 'border-purple-300');
                this.tempTagInput.focus();
            } else {
                this.dom.tempPanel.classList.add('hidden');
                this.dom.tempPanel.classList.remove('flex');
                this.dom.fabTemp.classList.remove('bg-purple-100', 'border-purple-300');
            }
        };

        // =========================================================================
        // --- 新增：规则树侧边栏事件 ---
        // =========================================================================

        // FAB Tree: 切换侧边栏的显示/隐藏

        this.dom.fabTree.onclick = () => {
            this.dom.rulesPanel.classList.toggle('-translate-x-full');
        };

        // Rules Panel Backdrop: 点击侧边栏外部区域（如果实现）或侧边栏内部关闭（如果添加按钮）

        // Force Sync Button: 强制重新加载规则树
        this.dom.rulesForceSync.onclick = async () => {
            // 强制同步按钮需要重新加载规则树，并忽略 ETag 缓存
            this.dom.rulesForceSync.innerHTML = SVG_ICONS.loader.replace('w-8 h-8', 'w-4 h-4');
            
            // 强制加载规则树（参数设置为 true）
            await this.loadRulesTree(true); 
            
            this.dom.rulesForceSync.textContent = '强制同步';
            
            // 自动关闭侧边栏（可选，但通常在同步后保持打开）
            // this.dom.rulesPanel.classList.add('-translate-x-full');
        };

        // Rules Tree Toggle: 树状结构节点展开/收起（事件委托）
        this.dom.rulesTreeContainer.addEventListener('click', (e) => {
            const headerEl = e.target.closest('.flex.items-center.justify-between');
            if (headerEl) {
                const groupNode = headerEl.closest('.group-node');
                if (groupNode) {
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
        });

        const hideAllChildren = () => {
            this.dom.rulesTreeContainer.querySelectorAll('.flex.flex-wrap.gap-1, .ml-4.border-l').forEach(el => {
                el.classList.add('hidden');
            });
        };
        // 首次加载规则树后执行隐藏
        this.dom.fabTree.addEventListener('click', hideAllChildren, { once: true });




        // --- Temp Panel Logic ---
        document.getElementById('close-temp-panel').onclick = () => this.dom.fabTemp.click();
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
        
        // 3. 更新内存状态和 datalist
        this.state.allKnownTags = tags;
        this.filterAndUpdateDatalist('');
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
        // [修改开始: 关键词膨胀逻辑]
        if (this.state.loading || (!this.state.hasMore && !isJump)) return;
        this.state.loading = true;
        this.dom.loader.classList.remove('hidden');

        const rawIncludes = this.state.queryTags.filter(t => !t.exclude).map(t => t.text);
        const rawExcludes = this.state.queryTags.filter(t => t.exclude).map(t => t.text);
        
        // 膨胀包含词 (Includes)
        const expandedIncludes = this.expandKeywords(rawIncludes).expandedKeywords;

        const payload = {
            offset: this.state.offset,
            limit: this.state.limit,
            sort_by: this.state.sortBy,

            keywords: expandedIncludes,
            excludes: rawExcludes
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

            // [新增: 搜索完成后，刷新规则树的过滤显示]
            this.renderRulesTree();

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
     * 根据搜索标签过滤规则树，保留命中节点及其父路径。
     * @param {Array} tree - 规则树结构。
     * @param {Array<string>} searchTags - 用户输入的搜索标签数组 (已清理)。
     * @returns {Array} 过滤后的新树结构。
     */

    filterTree(tree, searchTags) {
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
                const groupNameMatch = lowerSearchTags.some(tag => node.name.toLowerCase().includes(tag));
                const keywordMatch = node.keywords.some(k => 
                    lowerSearchTags.some(tag => k.text.toLowerCase().includes(tag))
                );
                
                const isMatch = groupNameMatch || keywordMatch;
                
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
     */
    renderRulesTree() {
        const container = document.getElementById('rules-tree-container');
        const versionInfo = document.getElementById('rules-version-info');
        
        if (!container) return;
        
        versionInfo.textContent = `V${this.state.rulesBaseVersion}`;
        
        // 1. 获取过滤后的树结构 (如果搜索栏有输入，则过滤)
        const searchInputTexts = this.headerTagInput.tags
            .filter(t => !t.exclude)
            .map(t => typeof t === 'object' ? t.text : t);
        
        // 这里需要实现一个逻辑：只在规则树面板打开时，才根据 Header 搜索栏的内容进行过滤，
        // 或者使用专用于规则树过滤的输入框。
        // 为了简化，我们暂时使用完整的树结构进行渲染。
        const treeToRender = this.filterTree(this.state.rulesTree, searchInputTexts);
        
        container.innerHTML = '';
        
        if (!treeToRender || treeToRender.length === 0) {
            container.innerHTML = '<p class="text-sm text-slate-400">暂无规则数据。</p>';
            // 新增：添加一个快速创建根组的按钮
            container.innerHTML += '<button id="add-root-group-btn" class="mt-4 p-2 w-full bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition">添加根组</button>';
            document.getElementById('add-root-group-btn').onclick = () => this.startGroupEdit(null, container);
            return;
        }

        /**
         * 递归渲染节点
         * @param {Array} nodes - 节点数组
         * @param {HTMLElement} parentEl - 父级 DOM 元素
         */
        const renderRecursive = (nodes, parentEl) => {
            nodes.forEach(node => {
                const isEnabled = node.isEnabled || (node.isEnabled === undefined ? true : false);

                const groupEl = document.createElement('div');
                groupEl.className = `group-node relative ${isEnabled ? '' : 'opacity-50 italic'} ${node.isMatch ? 'bg-blue-50 border-blue-400' : ''}`;
                groupEl.dataset.id = node.id;
                groupEl.dataset.name = node.name; // 存名字用于编辑

                // [新增: 启用拖拽]
                groupEl.draggable = "true";
                this.bindDragEvents(groupEl);
                
                // --- 第一行: 组名 + 交互 ---
                const header = document.createElement('div');                
                header.className = `group-header flex items-center justify-between p-2 rounded cursor-pointer ${node.isMatch ? 'hover:bg-blue-100' : 'hover:bg-slate-100'}`;
                
                // 组名展示
                const nameDisplay = document.createElement('div');

                nameDisplay.className = "flex items-center gap-1 font-bold text-sm";
                nameDisplay.innerHTML = `
                    <i data-lucide="${isEnabled ? 'folder' : 'folder-x'}" class="w-4 h-4 ${node.isMatch ? 'text-blue-600' : 'text-slate-500'}"></i>
                    <span class="group-name-text ${node.isMatch ? 'text-blue-700' : 'text-slate-700'}">${node.name}</span>
                `;

                // 交互按钮容器
                const actionButtons = document.createElement('div');
                actionButtons.className = "flex items-center gap-1";
                
                // 添加关键词按钮 (+)
                const addKeywordBtn = document.createElement('button');
                addKeywordBtn.className = "p-1 text-green-500 hover:text-green-700 hidden group-hover:block transition-colors";
                addKeywordBtn.innerHTML = `<i data-lucide="plus" class="w-4 h-4"></i>`;
                addKeywordBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.startKeywordAdd(node.id, keywordsContainer);
                };
                
                // 展开/收起图标
                const chevron = document.createElement('i');
                chevron.dataset.lucide = "chevron-down";
                chevron.className = "w-4 h-4 text-slate-400 transition transform";
                
                actionButtons.appendChild(addKeywordBtn);
                actionButtons.appendChild(chevron);

                header.appendChild(nameDisplay);
                header.appendChild(actionButtons);
                
                // --- 事件绑定 ---
                header.onclick = (e) => {
                    e.stopPropagation();
                    // 切换关键词和子节点容器的显示状态
                    keywordsContainer.classList.toggle('hidden');
                    childrenContainer.classList.toggle('hidden');
                    chevron.classList.toggle('rotate-180');
                };
                
                // 双击编辑组名
                header.ondblclick = (e) => {
                    e.stopPropagation();
                    this.startGroupEdit(node, nameDisplay, keywordsContainer, childrenContainer);
                };
                
                // --- 第二行: 关键词胶囊 ---
                const keywordsContainer = document.createElement('div');
                keywordsContainer.className = "flex flex-wrap gap-1 pl-6 pt-1 pb-2 border-l border-slate-200 ml-2 hidden";
                
                // 渲染关键词胶囊 (简化，不实现就地编辑 UI)
                node.keywords.forEach(k => {
                    
                    const isKeywordMatch = searchInputTexts.some(tag => k.text.toLowerCase().includes(tag));

                    const keywordEl = document.createElement('span');

                    keywordEl.className = `keyword-capsule flex items-center gap-1 px-2 py-0.5 text-xs rounded-full cursor-pointer transition-colors 
                                            ${k.isEnabled ? (isKeywordMatch ? 'bg-purple-500 text-white hover:bg-purple-600' : 'bg-blue-500 text-white hover:bg-blue-600') : 'bg-slate-300 text-slate-600 hover:bg-slate-400'}`;
                    
                    const textSpan = document.createElement('span');
                    textSpan.textContent = k.text;
                    
                    // TODO: 关键词就地编辑逻辑

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

                // [新增: 拖拽目标标记 (Drop Zone Indicator)]
                const dropZoneIndicator = document.createElement('div');
                dropZoneIndicator.className = "drop-indicator absolute inset-0 rounded-md border-2 border-transparent pointer-events-none transition-all duration-150";
                groupEl.appendChild(dropZoneIndicator);
                
                // 递归渲染子节点
                const childrenContainer = document.createElement('div');
                childrenContainer.className = "ml-4 border-l border-slate-200 hidden";
                renderRecursive(node.children, childrenContainer);

                groupEl.appendChild(header);
                groupEl.appendChild(keywordsContainer);
                groupEl.appendChild(childrenContainer);
                parentEl.appendChild(groupEl);


            });
        };

        renderRecursive(treeToRender, container);
        // 重新创建 Lucide 图标 (因为我们创建了新的 DOM 元素)
        lucide.createIcons(); 
        // [新增: 为根容器添加放置目标]
        this.bindDragEvents(container, true);
    }

    // [新增方法] 绑定拖拽事件
    bindDragEvents(el, isRootContainer = false) {
        if (!el.dataset.id && !isRootContainer) return;

        el.addEventListener('dragstart', (e) => {
            // 存储被拖拽元素的 ID
            e.stopPropagation();
            e.dataTransfer.setData('text/plain', el.dataset.id);
            e.dataTransfer.effectAllowed = 'move';
            
            // 拖拽时添加一个视觉反馈类
            el.classList.add('opacity-40', 'border-dashed'); 
        });

        el.addEventListener('dragend', (e) => {
            // 拖拽结束时移除反馈类
            e.stopPropagation();
            el.classList.remove('opacity-40', 'border-dashed');
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault(); // 允许放置
            e.dataTransfer.dropEffect = 'move';
            
            const draggedId = e.dataTransfer.getData('text/plain');
            const targetId = el.dataset.id;
            
            // 避免拖拽到自身或根容器自身
            if (draggedId === targetId || (isRootContainer && !draggedId)) {
                return;
            }

            // 添加拖拽目标视觉反馈
            const indicator = el.querySelector('.drop-indicator');
            if (indicator) {
                indicator.classList.remove('border-transparent');
                indicator.classList.add('border-blue-500');
            } else if (isRootContainer) {
                 // 根容器的视觉反馈 (例如在Rules Tree Panel上显示)
                 el.style.backgroundColor = 'rgba(0, 0, 255, 0.05)';
            }
        });

        el.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            // 移除拖拽目标视觉反馈
            const indicator = el.querySelector('.drop-indicator');
            if (indicator) {
                indicator.classList.add('border-transparent');
                indicator.classList.remove('border-blue-500');
            } else if (isRootContainer) {
                el.style.backgroundColor = '';
            }
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const childId = parseInt(e.dataTransfer.getData('text/plain'));
            const parentId = isRootContainer ? 0 : parseInt(el.dataset.id); // 0 代表根节点

            // 移除拖拽目标视觉反馈
            const indicator = el.querySelector('.drop-indicator');
            if (indicator) {
                indicator.classList.add('border-transparent');
                indicator.classList.remove('border-blue-500');
            } else if (isRootContainer) {
                el.style.backgroundColor = '';
            }
            
            if (childId && childId !== parentId) {
                this.handleHierarchyChange(parentId, childId);
            } else {
                 this.showToast('无法将组拖拽到自身。', 'error');
            }
        });
    }

    /**
     * [新增方法] 处理层级关系的修改（拖拽成功）。
     * @param {number} parentId - 目标父组 ID (0 代表根节点)。
     * @param {number} childId - 被拖拽的子组 ID。
     */
    async handleHierarchyChange(parentId, childId) {
        // 简化处理：假设拖拽总是建立新的父子关系 (添加)
        const payload = {
            parent_id: parentId,
            child_id: childId
        };

        const action = {
            url: '/api/rules/hierarchy/add',
            method: 'POST',
            type: 'hierarchy/add'
        };

        // 提示用户操作
        this.showToast(`尝试将组 ${childId} 移动到 ${parentId === 0 ? '根目录' : '组 ' + parentId}...`, 'info');

        const result = await this.handleSave(action, payload);
        
        if (result.success) {
            // handleSave 内部会调用 renderRulesTree 刷新 UI
            this.showToast('层级关系更新成功！', 'success');
        } else if (result.error && result.error.includes("Cannot link group to itself")) {
             this.showToast('保存失败：无法将组链接到自身。', 'error');
        } else {
             // 冲突处理失败已在 handleSave 中处理
             this.showToast('层级更新失败：请刷新重试。', 'error');
        }
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
        
        const cleanup = () => {
            wrapper.remove();
        };

        const save = async () => {
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
        const handleClickOutside = (e) => {
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
    startGroupEdit(node, displayEl, keywordsContainer, childrenContainer) {
        const isNew = node === null;
        const originalName = isNew ? '' : node.name;
        const originalIsEnabled = isNew ? 1 : node.isEnabled;
        
        // 隐藏其他内容
        if (!isNew) {
            displayEl.classList.add('hidden');
            if(keywordsContainer) keywordsContainer.classList.add('hidden');
            if(childrenContainer) childrenContainer.classList.add('hidden');
        } else {
            // 新建模式下，在父容器顶部插入编辑框
            displayEl.innerHTML = '';
        }

        // 创建输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalName;
        input.placeholder = isNew ? '输入新组名...' : '编辑组名...';
        input.className = "w-full p-1 border border-blue-400 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500";
        
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
        deleteBtn.textContent = isNew ? '清除' : (originalIsEnabled ? '软删' : '恢复');
        deleteBtn.className = `px-3 py-1 text-white rounded transition ${isNew ? 'bg-slate-400' : (originalIsEnabled ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600')}`;
        deleteBtn.style.marginLeft = 'auto'; // 推到右边

        actionBtns.appendChild(cancelBtn);
        if (!isNew) actionBtns.appendChild(deleteBtn);
        actionBtns.appendChild(saveBtn);
        
        editorWrapper.appendChild(input);
        editorWrapper.appendChild(actionBtns);

        // 插入 DOM
        if (isNew) {
            displayEl.prepend(editorWrapper);
        } else {
            // 替换组名显示区
            displayEl.parentElement.replaceChild(editorWrapper, displayEl);
        }

        input.focus();
        
        const cleanup = () => {
             // 清除事件监听器
             document.removeEventListener('click', handleClickOutside);
             input.removeEventListener('keydown', handleKeyDown);
             
             // 恢复 UI
             editorWrapper.remove();
             if (!isNew) {
                 // 恢复组名显示
                 displayEl.parentElement.replaceChild(displayEl, editorWrapper);
                 displayEl.classList.remove('hidden');
             }
             this.renderRulesTree(); // 强制刷新以保证状态一致
        };
        
        const save = async () => {
            const newName = input.value.trim();
            if (!newName) {
                this.showToast('组名不能为空！', 'error');
                return;
            }
            
            const payload = {
                group_id: isNew ? null : node.id,
                group_name: newName,
                is_enabled: originalIsEnabled
            };

            const action = {
                url: isNew ? '/api/rules/group/add' : '/api/rules/group/update',
                method: 'POST',
                type: isNew ? 'group/add' : 'group/update'
            };

            const result = await this.handleSave(action, payload);
            if (result.success) {
                // 成功后，由 handleSave 内部调用 renderRulesTree 刷新 UI
            } else if (result.conflict) {
                 // 冲突处理失败，alert 已在 handleSave 中处理
            } else {
                 // 其他错误，UI 恢复原状
                 cleanup();
            }
            if (!result.success) cleanup(); // 如果保存失败，手动清理
        };
        
        const toggleSoftDelete = async () => {
            const payload = {
                group_id: node.id,
                group_name: originalName, // 保持组名不变
                is_enabled: originalIsEnabled ? 0 : 1 // 切换状态
            };

            const action = {
                url: '/api/rules/group/update',
                method: 'POST',
                type: 'group/update_status'
            };

            const result = await this.handleSave(action, payload);
            if (result.success) {
                // 成功后由 handleSave 刷新 UI
            } else {
                // 失败后，手动清理
                cleanup();
            }
        };

        // 绑定事件
        saveBtn.onclick = save;
        cancelBtn.onclick = cleanup;
        if (!isNew) deleteBtn.onclick = toggleSoftDelete;
        
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

        // 点击外部关闭逻辑
        const handleClickOutside = (e) => {
            if (!editorWrapper.contains(e.target) && e.target !== displayEl) {
                // 如果是新组，且没有输入内容，则直接清理
                if (isNew && input.value.trim() === '') {
                    cleanup();
                } else {
                    // 否则尝试保存
                    save(); 
                }
            }
        };
        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }
    

    // 修正 loadRulesTree，使其在加载数据后调用 buildTree 和 renderRulesTree
    async loadRulesTree(forceRefresh = false) {
    // 1. 检查本地存储中的版本号
        const localVersion = this.state.rulesBaseVersion;
        
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
                this.renderRulesTree(); // 规则未变，但刷新版本号和 UI
                // 304 Not Modified: 规则未变，无需操作
                return;
            }

            if (res.ok) {
                const data = await res.json();
                
                this.state.rulesBaseVersion = data.version_id;
                localStorage.setItem(RULES_VERSION_KEY, data.version_id.toString());
                
                // 3. 构建树结构 (Prompt 4 核心)
                this.state.rulesTree = this.buildTree(data); 
                
                // 4. 更新图片标签建议 (保持不变)
                this.state.allKnownTags = data.keywords.map(k => k.keyword); 
                this.filterAndUpdateDatalist(''); 
                
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
        // **关键逻辑**：重新加载并构建服务器返回的 rulesTree，然后判断：
        // 1. **修改/删除操作**：目标 Group/Keyword 是否在服务器的新数据中仍然存在。
        // 1. 实现一个 findNode/findKeyword 函数来递归查找新树
        const findNode = (nodes, id) => {
            for (const node of nodes) {
                if (node.id === id) return node;
                const found = findNode(node.children, id);
                if (found) return found;
            }
            return null;
        };
        // 2. **添加操作**：目标 Group/Keyword 是否在服务器的新数据中已存在（如果已存在，则应避免重放）。
        // 2. 根据操作类型进行检查
        if (actionType.includes('group')) {
            // 组操作：目标组是否还存在
            const groupExists = findNode(newRulesTree, payload.group_id);
            if (actionType.includes('/update') || actionType.includes('/remove')) {
                // 如果是修改或删除，目标组必须存在才能重放
                return !!groupExists;
            }
            if (actionType.includes('/add')) {
                // 添加操作：假设服务器会处理重复命名，允许重放。
                return true;
                }
            // 对于 group/add，我们假设服务器会处理重复命名，允许重放。
        }

        if (actionType.includes('keyword')) {
            const groupNode = findNode(newRulesTree, payload.group_id);
            if (!groupNode) return false; // 目标组已不存在
            
            const keywordExistsInGroup = groupNode.keywords.some(k => k.text === payload.keyword);
            
            if (actionType.includes('/remove')) {
                // 删除关键词操作：目标关键词必须存在才能重放
                return keywordExistsInGroup;
            }
            // 示例：如果用户要删除 Group A，但 Group A 已经被服务器删除，则操作无效（或成功，取决于业务定义）。
            // 示例：如果用户要添加 Keyword X 到 Group B，但 Group B 已经被服务器删除，则操作无效。

            // 由于缺乏完整的本地 CRUD 实现，我们在此处提供一个高度简化的框架：
            if (actionType.includes('/add')) {
                // 对于添加操作，假设只要目标 Group 存在，操作就有效（服务器会处理重复添加）
                return true;
            }
            
            if (actionType.includes('/update') || actionType.includes('/remove')) {
                // 对于修改/删除操作，如果目标 ID/Keyword 依然存在，则重放有效。
                // 简单检查关键参数是否存在
                return !!payload.group_id || !!payload.keyword;
            }

            if (actionType.includes('hierarchy')) {
            // 层级操作：确保父子组都存在
            const parentExists = payload.parent_id === 0 || findNode(newRulesTree, payload.parent_id);
            const childExists = findNode(newRulesTree, payload.child_id);
            
            return !!parentExists && !!childExists;
        }

        // 默认返回 true，以便触发重试，让服务器进行最终判断。
        return true; 

        }

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

        images.forEach(img => {
            // Filter: Hide trash items unless we are in Trash Mode (explicitly searching for trash_bin)
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
            // 优化 2. 简化昂贵 CSS: 仅保留 transform 相关的过渡效果
            imgEl.className = "image-element w-full h-full object-contain transition duration-500 hover:scale-105"; // group-hover:scale-105 依赖于父元素的 group 类
            imgEl.loading = "lazy";
            
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

    async handleUpload(files) {
        if (files.length === 0) return;
        const btn = this.dom.fabUpload;
        const originalContent = btn.innerHTML;
        // FAB 按钮使用 Lucide，所以保留其调用
        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-7 h-7"></i>`;
        lucide.createIcons();

        try {
            for (let file of files) {
                const fd = new FormData();
                fd.append('file', file);
                await fetch('/api/upload', { method: 'POST', body: fd });
            }
            this.resetSearch();
        } catch (e) {
            console.error("Upload failed", e);
            // Replaced alert with console error as per instructions
            console.error("上传失败，请重试"); 
        } finally {
            btn.innerHTML = originalContent;
            lucide.createIcons();
        }
    }
}

window.app = new MemeApp();