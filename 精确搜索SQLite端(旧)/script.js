/**
 * [新增] 规则与本地缓存管理器 (保持不变)
 */
class RuleManager {
    constructor() {
        this.tags = [];
        this.synonyms = {};
        this.version = 0;
        this.load();
        this.sync();
    }
    load() {
        try {
            const d = JSON.parse(localStorage.getItem('bq_rules') || '{}');
            this.tags = d.tags || []; this.synonyms = d.synonyms || {}; this.version = d.version || 0;
        } catch(e) {}
    }
    async sync() {
        try {
            const v = await fetch('/api/meta/version').then(r=>r.json());
            if(v.version > this.version) {
                const r = await fetch('/api/meta/rules').then(r=>r.json());
                this.tags = r.tags; this.synonyms = r.synonyms; this.version = r.version;
                localStorage.setItem('bq_rules', JSON.stringify(r));
                this.updateDatalist();
            }
            this.updateDatalist();
        } catch(e) { console.warn("Rules sync failed", e); }
    }

    updateDatalist() {
    const dl = document.getElementById('tag-suggestions');
    if(!dl) return;
    dl.innerHTML = this.tags.map(t => `<option value="${t}">`).join('');
    }

    expand(word) {
        if(this.synonyms[word]) return [...new Set([word, ...this.synonyms[word]])];
        return [word];
    }
}

/**
 * [重构] 通用胶囊输入组件
 * 用于顶部的搜索栏以及卡片底部的标签编辑
 */
class CapsuleInput {
    constructor(container, initialTags = [], onCommit = null) {
        this.container = container;
        this.tags = [...initialTags];
        this.onCommit = onCommit; // 回车提交回调
        this.inputEl = null;
        this.render();
    }

    render() {
        this.container.innerHTML = '';
        // 容器样式：Flex布局，让Input和胶囊在同一行流式排列
        this.container.className = "flex flex-wrap gap-1 items-center bg-white border border-blue-300 rounded px-2 py-1 min-h-[32px] text-xs shadow-inner";
        
        // 1. 渲染现有胶囊
        this.tags.forEach((tag, idx) => {
            const el = document.createElement('span');
            const isExclude = tag.startsWith('-');
            // 样式区分：排除(红) vs 包含(蓝) [样式微调：更紧凑]
            const colorClass = isExclude ? 'bg-red-100 text-red-700 border-red-200' : 'bg-blue-100 text-blue-700 border-blue-200';
            
            el.className = `${colorClass} border px-2 py-0.5 rounded-full cursor-default select-none flex items-center gap-1 whitespace-nowrap`;
            el.innerHTML = `<span>${tag}</span><span class="hover:text-red-600 font-bold cursor-pointer ml-0.5">&times;</span>`;
            
            // 点击 x 删除
            el.querySelector('span:last-child').onclick = (e) => {
                e.stopPropagation();
                this.removeTag(idx);
            };
            this.container.appendChild(el);
        });

        // 2. 渲染输入框
        const inp = document.createElement('input');
        inp.type = "text";
        inp.setAttribute('list', 'tag-suggestions'); // [新增] 绑定 datalist
        // 样式：去掉默认边框，背景透明，自动填充剩余空间
        inp.className = "flex-grow min-w-[60px] outline-none bg-transparent text-gray-700 placeholder-gray-400 h-6";
        if (this.tags.length === 0) inp.placeholder = "输入标签(空格生成)...";
        
        // 绑定事件
        inp.addEventListener('keydown', (e) => this.handleKey(e));
        inp.addEventListener('blur', () => { /* 可选：失焦自动提交或保留 */ });
        
        this.container.appendChild(inp);
        this.inputEl = inp;
        
        // 自动聚焦
        setTimeout(() => inp.focus(), 10);
    }

    handleKey(e) {
        const val = e.target.value; // 保留空格用于判断，但存入时trim
        
        // Backspace: 输入框为空时，删除最后一个胶囊
        if (e.key === 'Backspace' && val === '') {
            if (this.tags.length > 0) {
                this.tags.pop();
                this.render();
            }
            return;
        }

        // Space: 生成胶囊
        if (e.key === ' ' && val.trim()) {
            e.preventDefault();
            this.addTag(val.trim());
        }

        // Enter: 有内容则生成胶囊，无内容则触发提交(搜索或保存)
        if (e.key === 'Enter') {
            e.preventDefault();
            if (val.trim()) {
                this.addTag(val.trim());
            } else {
                if (this.onCommit) this.onCommit(this.tags);
            }
        }
    }

    addTag(text) {
        // 简单去重
        if (!this.tags.includes(text)) {
            this.tags.push(text);
            this.inputEl.value = ''; // 明确清空
            this.render();
        } else {
            this.inputEl.value = ''; // 重复则清空输入框
            // 可以加一个闪烁动画提示重复
        }
    }

    removeTag(idx) {
        this.tags.splice(idx, 1);
        this.render();
    }
    
    getTags() { return this.tags; }
}

/**
 * 主应用逻辑
 */
class App {
    constructor() {
        this.state = {
            offset: 0,
            limit: 20,
            loading: false,
            hasMore: true,
            currentPayload: { conditions: [], excludes: [] },
            total: 0, // [新增] 总数记录
            useHD: localStorage.getItem('bq_use_hd') === 'true',
        };

        this.ruleMgr = new RuleManager();
        
        // 初始化顶部搜索栏 (复用 CapsuleInput)
        const searchBox = document.getElementById('capsule-container');
        this.searchCapsule = new CapsuleInput(searchBox, [], () => this.doSearch());
        // 稍微调整搜索栏容器样式，使其更像一个大输入框
        searchBox.className = "p-3 bg-gray-50 border-b cursor-text min-h-[50px]"; 
        
        this.bindEvents();
        
        // 初始加载
        this.doSearch();
    }

    bindEvents() {
        // 1. 搜索 FAB 显示
        document.getElementById('fab-search').onclick = () => {
            const modal = document.getElementById('search-modal');
            modal.classList.remove('hidden');
            this.searchCapsule.inputEl.focus();
        };

        // 2. 排序变更
        document.getElementById('sort-select').onchange = () => this.doSearch();

        // 3. HD 开关
        const hdToggle = document.getElementById('hd-toggle');
        hdToggle.checked = this.state.useHD;
        hdToggle.onchange = (e) => {
            this.state.useHD = e.target.checked;
            localStorage.setItem('bq_use_hd', this.state.useHD);
            this.refreshVisibleImages(); // 刷新当前显示的图片
        };

        // 4. 穿梭条 (Shuttle) 翻页逻辑
        const shuttle = document.getElementById('page-shuttle');
        const indicator = document.getElementById('page-indicator');
        let shuttleTimer = null;
        
        // 拖动时显示提示
        shuttle.oninput = (e) => {
            const val = parseInt(e.target.value);
            if (val === 0) {
                indicator.style.opacity = '0';
                return;
            }
            indicator.style.opacity = '1';
            let jump = val;
            // 加速度逻辑: 超过 +/- 5 时，步长翻倍
            if (Math.abs(val) > 5) jump = val * 2;
            
            const estimatedOffset = this.state.offset + (jump * this.state.limit);
            const direction = jump > 0 ? "后" : "前";
            indicator.innerText = `向${direction}翻 ${Math.abs(jump)} 页`;
            indicator.innerText = `向${direction}翻 ${Math.abs(jump)} 页 (约第 ${Math.max(1, Math.floor(estimatedOffset/this.state.limit)+1)} 页)`;
        };

        // 松开时执行跳转
        shuttle.onchange = (e) => {
            const val = parseInt(e.target.value);
            e.target.value = 0; // 归位
            indicator.style.opacity = '0';

            if (val === 0) return;

            // 计算跳转页数
            let jumpPages = val;
            if (Math.abs(val) > 5) jumpPages = val * 2; // 加速度

            let newOffset = this.state.offset + (jumpPages * this.state.limit);
            if (newOffset < 0) newOffset = 0;
            
            this.state.offset = newOffset;
            this.reloadGrid(); // 跳转是破坏性的，重新加载Grid
        };
    }

    // --- 搜索逻辑 ---

    clearSearch() {
        this.searchCapsule.tags = [];
        this.searchCapsule.render();
        this.doSearch();
    }

    async doSearch() {
        // 解析胶囊
        const tags = this.searchCapsule.getTags();
        // 如果输入框里还有残留文本，按回车时也算作标签
        if (this.searchCapsule.inputEl && this.searchCapsule.inputEl.value.trim()) {
             tags.push(this.searchCapsule.inputEl.value.trim());
        }
        
        const conditions = [];
        const excludes = [];
        
        tags.forEach(t => {
            if (t.startsWith('-')) excludes.push(t.substring(1));
            else conditions.push(this.ruleMgr.expand(t)); // 同义词扩展
        });

        this.state.currentPayload = {
            conditions, 
            excludes,
            sort_by: document.getElementById('sort-select').value
        };
        
        this.state.offset = 0;
        document.getElementById('search-modal').classList.add('hidden');
        this.reloadGrid();
    }

    async reloadGrid() {
        document.getElementById('grid-container').innerHTML = '';
        this.state.hasMore = true;
        await this.loadMore('append'); // 这里的 append 指的是往空 Grid 里 append
    }

    // --- 加载核心 ---

    /**
     * 加载数据
     * @param {string} mode 'append' | 'prepend'
     */
    async loadMore(mode = 'append') {
        if (this.state.loading) return;
        this.state.loading = true;

        // 根据 mode 决定请求哪个 offset
        // 如果是 prepend (向上加载)，我们需要请求当前 offset 之前的数据
        // 这里简化处理：我们始终维护一个 current offset 指向"下一页"，
        // 向上加载比较复杂，这里实现为：手动点击顶部按钮 -> 加载上一页并替换当前内容(类似翻页)，或者纯粹的加载更多逻辑
        // 根据需求："每一页的顶部和底部是'点击加载更多'"
        
        // 修正逻辑：
        // 每次请求 limit 个。
        // currentPayload 里的 offset 是基于 search 的。
        // 这里我们简单化：offset 始终指向"末尾"。
        // 顶部按钮 -> offset -= limit * 2 (回退) -> reloadGrid
        // 底部按钮 -> offset += limit -> loadMore
        
        try {
            const res = await fetch('/api/explore', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    offset: this.state.offset,
                    limit: this.state.limit,
                    ...this.state.currentPayload
                })
            }).then(r => r.json());

            this.state.total = res.total; // [新增] 更新总数
            const grid = document.getElementById('grid-container');

            // 1. 顶部按钮 (如果是重新加载或者往下翻页，且不是第一页)
            // 注意：因为是无限流，顶部按钮通常用于"跳转回上一页"或者"加载之前的"
            // 这里实现为：显示当前页码，点击加载上一页(Reload方式)
            if (mode === 'append') {
                const currentPage = Math.floor(this.state.offset / this.state.limit) + 1;
                
                // 只有当不是第一页时才显示顶部按钮
                if (this.state.offset > 0) {
                    const topBtn = document.createElement('div');
                    topBtn.className = "col-span-full py-2 flex justify-center";
                    topBtn.innerHTML = `
                        <button class="text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 px-4 py-1 rounded-full shadow-sm transition"
                                onclick="app.jumpToPrevPage(${this.state.offset})">
                            ⬆ 第 ${currentPage} 页 (点击返回上一页)
                        </button>`;
                    grid.appendChild(topBtn);
                }
            }

            // 2. 渲染卡片
            res.results.forEach(img => {
                grid.appendChild(this.renderCard(img));
            });

            // 3. 底部按钮
            // 移除旧的底部按钮
            const oldBottom = document.getElementById('manual-load-next');
            if (oldBottom) oldBottom.remove();

            this.state.offset += res.results.length; // 这里的 offset 其实是已加载的数量
            this.state.hasMore = this.state.offset < res.total;

            if (this.state.hasMore) {
                const bottomBtn = document.createElement('div');
                bottomBtn.id = "manual-load-next";
                bottomBtn.className = "col-span-full py-4 flex justify-center";
                bottomBtn.innerHTML = `
                    <button class="w-full max-w-md text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 py-2 rounded-lg font-bold transition dashed-border"
                            onclick="app.loadMore('append')">
                        ⬇ 加载更多
                    </button>`;
                grid.appendChild(bottomBtn);
            }

        } catch (e) {
            console.error(e);
            alert("加载失败");
        } finally {
            this.state.loading = false;
        }
    }

    jumpToPrevPage(currentOffset) {
        // 回退 2 个 limit (因为 offset 已经加过一次 limit 了)
        let newOff = currentOffset - (this.state.limit * 2);
        if (newOff < 0) newOff = 0;
        this.state.offset = newOff;
        this.reloadGrid();
    }

    // --- 卡片渲染与交互 ---

    renderCard(img) {
        const card = document.createElement('div');
        // 基础样式 [修改] 扁平化，移除阴影，使用边框
        card.className = "bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden group relative flex flex-col transition-all duration-300 hover:shadow-md break-inside-avoid";
        
        // 软删除样式
        if (img.is_trash) card.classList.add('soft-deleted'); // CSS中定义样式

        // 图片源逻辑
        // [修改] 始终优先显示缩略图，除非已是 HD 模式且缓存过，或者用户点击加载
        // 这里简化：默认 src 指向缩略图
        const thumbUrl = `/thumbnails/${img.filename}`;
        const hdUrl = img.url;
        // 如果全局开启 HD，直接用 HD url
        const src = this.state.useHD ? hdUrl : thumbUrl;        

        // 图标 SVG
        const svgStyle = "w-3.5 h-3.5";
        const icons = {
            trash_red: `<svg class="${svgStyle} text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`,
            trash_green: `<svg class="${svgStyle} text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>`,
            copy: `<svg class="${svgStyle}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>`,
            dl: `<svg class="${svgStyle}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>`,
            edit: `<svg class="${svgStyle}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>`,
            sandglass: `<svg class="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`
        };

        // 构造 HTML
        card.innerHTML = `
            <div class="relative w-full aspect-auto bg-gray-100 cursor-pointer overflow-hidden group-hover:brightness-95 transition" 
                 onclick="app.previewImage(this, '${hdUrl}')">
                
               <img src="${src}" data-original="${hdUrl}" data-filename="${img.filename}" class="w-full h-auto object-cover" loading="lazy">
                
                <div class="loading-overlay absolute inset-0 flex items-center justify-center bg-black/20 hidden pointer-events-none">
                    ${icons.sandglass}
                </div>

                <button class="action-btn absolute top-1 left-1 p-1.5 bg-white/90 rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition hover:scale-105 z-20"
                        onclick="event.stopPropagation(); app.toggleTrash('${img.md5}', this)" title="删除/恢复">
                    <span class="icon-trash">${img.is_trash ? icons.trash_green : icons.trash_red}</span>
                </button>

                <button class="absolute top-1 right-1 p-1.5 bg-white/90 text-blue-500 rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition hover:scale-105 z-20"
                        onclick="event.stopPropagation(); app.copyText('${img.filename}')" title="复制文件名">
                    ${icons.copy}
                </button>

                <button class="absolute bottom-1 left-1 p-1.5 bg-white/90 text-gray-600 rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition hover:scale-105 z-20"
                        onclick="event.stopPropagation(); app.startInlineEdit(this, '${img.md5}', '${hdUrl}')" title="编辑标签">
                    ${icons.edit}
                </button>

                <a href="${hdUrl}" download="${img.filename}" 
                   class="absolute bottom-1 right-1 p-1.5 bg-white/90 text-gray-600 rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition hover:scale-105 z-20"
                   onclick="event.stopPropagation()" title="下载">
                    ${icons.dl}
                </a>

                <div class="absolute bottom-1 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition z-10">
                    ${img.w}x${img.h} | ${(img.size/1024).toFixed(0)}KB
                </div>
            </div>

            <div class="px-2 py-1.5 bg-gray-50 border-t min-h-[32px] flex flex-col justify-center">
                <div class="tags-view flex flex-wrap gap-1 items-start" id="view-${img.md5}">
                    ${this.renderTagsHtml(img.tags)}
                </div>
                <div class="tags-edit hidden" id="edit-${img.md5}"></div>
            </div>
        `;

        // 将当前标签存入 DOM Dataset 方便读取
        card.dataset.tags = JSON.stringify(img.tags);
        return card;
    }

    renderTagsHtml(tags) {
        if (!tags || tags.length === 0) return '<span class="text-xs text-gray-300">无标签</span>';
        return tags.map(t => {
            if(t === 'trash_bin') return ''; // 不显示垃圾桶内部标签
            return `<span class="bg-white border border-gray-200 text-gray-600 text-[10px] px-1.5 py-0.5 rounded select-all hover:border-blue-300">${t}</span>`;
        }).join('');
    }

    // --- 图片交互逻辑 ---

    // 1. 预览/加载原图
    previewImage(el, originalUrl) {
        const img = el.querySelector('img');
        const overlay = el.querySelector('.loading-overlay');
        
        // 如果当前是缩略图 (src 不等于 originalUrl)，则加载原图
        // [修改] 逻辑：点击图片或编辑时，加载大图并替换
        if (img.src.includes('/thumbnails/') && !img.src.endsWith(originalUrl)) {
            overlay.classList.remove('hidden'); // 显示沙漏
            
            const newImg = new Image();
            newImg.src = originalUrl;
            newImg.onload = () => {
                img.src = originalUrl;
                overlay.classList.add('hidden'); // 隐藏沙漏
            };
        }
    }

    // 2. 刷新所有可见图片源 (Header Toggle)
    refreshVisibleImages() {
        document.querySelectorAll('#grid-container img').forEach(img => {
            const original = img.dataset.original;
            if (this.state.useHD) {
                img.src = original;
            } else {
                // 回退到缩略图路径
                if (img.dataset.filename) img.src = `/thumbnails/${img.dataset.filename}`;
            }
        });
    }

    // 3. 原位编辑
    startInlineEdit(btn, md5, url) {
        const card = btn.closest('.group');
        const viewDiv = card.querySelector(`#view-${md5}`);
        const editDiv = card.querySelector(`#edit-${md5}`);
        
        // 触发加载原图 (体验优化)
        this.previewImage(card.querySelector('.relative'), url);

        if (editDiv.classList.contains('hidden')) {
            // -> 进入编辑模式
            viewDiv.classList.add('hidden');
            editDiv.classList.remove('hidden');
            
            const currentTags = JSON.parse(card.dataset.tags || '[]').filter(t => t !== 'trash_bin');
            
            // 实例化 CapsuleInput
            new CapsuleInput(editDiv, currentTags, (newTags) => {
                // 回车回调：保存
                this.saveTags(md5, newTags, card, viewDiv, editDiv);
            });
        } else {
            // -> 取消编辑
            viewDiv.classList.remove('hidden');
            editDiv.classList.add('hidden');
        }
    }

    async saveTags(md5, newTags, card, viewDiv, editDiv) {
        // 1. 乐观更新 UI
        // 如果卡片本身有 trash_bin 标记，保存时需要保留吗？通常编辑标签意味着确认图片有效，或者保持原样。
        // 这里逻辑：编辑仅修改普通标签。如果卡片是删除状态，保留删除状态。
        let finalTags = [...newTags];
        const wasTrash = card.classList.contains('soft-deleted');
        if (wasTrash) finalTags.push('trash_bin');

        card.dataset.tags = JSON.stringify(finalTags);
        viewDiv.innerHTML = this.renderTagsHtml(finalTags);
        
        // 切换回视图
        viewDiv.classList.remove('hidden');
        editDiv.classList.add('hidden');
        editDiv.innerHTML = ''; // 清理组件

        // 2. 后端同步
        const fd = new FormData();
        fd.append('action', 'update_tags');
        fd.append('md5', md5);
        fd.append('tags', JSON.stringify(finalTags));
        fd.append('qq_id', document.getElementById('qq-id-input').value);

        try {
            await fetch('/api/operate', { method: 'POST', body: fd });
        } catch(e) {
            alert("保存失败");
            // 可选：回滚 UI
        }
    }

    // 4. 删除/恢复 (软删除)
    async toggleTrash(md5, btn) {
        const card = btn.closest('.group');
        const isDeleted = card.classList.contains('soft-deleted');
        
        let tags = JSON.parse(card.dataset.tags || '[]');
        const iconSpan = btn.querySelector('span');
        
        if (isDeleted) {
            // 恢复
            tags = tags.filter(t => t !== 'trash_bin');
            card.classList.remove('soft-deleted');
            iconSpan.innerHTML = `<svg class="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`; // 变回红色垃圾桶
        } else {
            // 删除 (软删除)
            if (!tags.includes('trash_bin')) tags.push('trash_bin');
            card.classList.add('soft-deleted');
            iconSpan.innerHTML = `<svg class="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>`; // 变为绿色恢复图标
        }
        
        // 更新 dataset 和 视图
        card.dataset.tags = JSON.stringify(tags);
        const viewDiv = card.querySelector(`#view-${md5}`);
        if(viewDiv) viewDiv.innerHTML = this.renderTagsHtml(tags);

        // 发送请求
        const fd = new FormData();
        fd.append('action', 'update_tags');
        fd.append('md5', md5);
        fd.append('tags', JSON.stringify(tags));
        fd.append('qq_id', document.getElementById('qq-id-input').value);
        
        fetch('/api/operate', { method: 'POST', body: fd });
    }

    // 5. 复制文件名
    copyText(txt) {
        navigator.clipboard.writeText(txt).then(() => {
            // 简单 Toast
            const toast = document.createElement('div');
            toast.className = "fixed top-20 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded shadow-lg text-xs z-[100] animate-bounce";
            toast.innerText = "已复制: " + txt;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 1500);
        });
    }

    // 6. 上传处理
    async handleDirectUpload(input) {
        if (!input.files.length) return;
        const files = Array.from(input.files);
        
        // 显示一个全局加载状态
        const fab = document.getElementById('fab-upload');
        const originalText = fab.innerHTML;
        fab.innerHTML = `<span class="animate-spin">↻</span>`;
        
        for (const file of files) {
            const fd = new FormData();
            fd.append('action', 'upload');
            fd.append('file', file);
            fd.append('qq_id', document.getElementById('qq-id-input').value);
            await fetch('/api/operate', {method: 'POST', body: fd});
        }
        
        fab.innerHTML = originalText;
        input.value = '';
        
        // 刷新列表
        this.state.offset = 0;
        this.reloadGrid();
    }
    
    exportData() {
        window.location.href = "/api/io/export";
    }
}

// 启动
window.app = new App();