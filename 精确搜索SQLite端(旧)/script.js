/**
 * Unified Tag Input Module
 * Handles capsule rendering, input interactions, and state management.
 */
class TagInput {
    constructor({ 
        container, 
        initialTags = [], 
        suggestionsId = '', 
        placeholder = 'Add tag...', 
        onChange = () => {}, 
        onSubmit = () => {}, 
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

        // --- 新增部分：监听 input 事件 (核心修改) ---
        // 手机/输入法往往不触发 keydown 空格，而是触发 input
        this.input.addEventListener('input', (e) => {
            const val = this.input.value;
            
            // 检测是否以空格结尾（包含半角空格 ' ' 和全角空格 '　'）
            if (val.endsWith(' ') || val.endsWith('　')) {
                const tagText = val.trim();
                
                // 如果有内容（不仅仅是空格），则生成标签
                if (tagText) {
                    this.addTag(tagText);
                }
                
                // 无论是否生成了标签，只要检测到末尾是空格，就清空输入框
                // 这样可以防止空格残留在输入框里
                this.input.value = '';
            }
        });

        this.input.addEventListener('keydown', (e) => {
            // Enter or Space -> Create Tag
            if (e.key === ' ' || e.key === 'Enter') {
                const val = this.input.value.trim();
                if (val) {
                    e.preventDefault();
                    this.addTag(val);
                    this.input.value = '';
                } else if (e.key === 'Enter') {
                    // Empty Enter -> Submit
                    e.preventDefault();
                    this.onSubmit(this.tags);
                }
            } 
            // Backspace -> Edit Last Tag
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
            capsule.className = `tag-capsule flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold cursor-pointer select-none whitespace-nowrap transition-transform active:scale-95 ${this.getStyle(isExclude)}`;
            
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

class MemeApp {
    constructor() {
        const savedHQ = localStorage.getItem('bqbq_prefer_hq');
        
        this.state = {
            offset: 0,
            limit: 40,
            loading: false,
            hasMore: true,
            totalItems: 0,
            // Search State
            queryTags: [], 
            isTrashMode: false,
            // Tag Data
            allKnownTags: [],
            // Settings
            sortBy: 'date_desc',
            preferHQ: savedHQ === 'true',
            // Temp Panel State
            tempTags: []
        };

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
        };

        // Initialize Tag Inputs
        this.headerTagInput = null;
        this.tempTagInput = null;

        this.init();
    }

    async init() {
        this.initTagInputs();
        this.updateHQVisuals();
        this.bindEvents();
        await this.loadMeta();
        this.loadMore();
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
            onSubmit: () => this.doSearch()
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
            }
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
        try {
            const res = await fetch('/api/meta/tags').then(r => r.json());
            this.state.allKnownTags = res;
            const dl = document.getElementById('tag-suggestions');
            if(dl) dl.innerHTML = res.map(t => `<option value="${t}">`).join('');
        } catch(e) { console.error("Meta load failed", e); }
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

        const payload = {
            offset: this.state.offset,
            limit: this.state.limit,
            sort_by: this.state.sortBy,
            keywords: this.state.queryTags.filter(t => !t.exclude).map(t => t.text),
            excludes: this.state.queryTags.filter(t => t.exclude).map(t => t.text)
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

    renderPageBlock(images) {
        const frag = document.createDocumentFragment();

        images.forEach(img => {
            // Filter: Hide trash items unless we are in Trash Mode (explicitly searching for trash_bin)
            const hasTrashTag = img.tags.includes('trash_bin') || img.is_trash;
            if (hasTrashTag && !this.state.isTrashMode) {
                return; 
            }

            const card = document.createElement('div');
            card.className = `meme-card group relative bg-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 aspect-square ${img.is_trash ? 'is-trash' : ''}`;
            
            // --- Image Handling ---
            const imgEl = document.createElement('img');
            imgEl.className = "w-full h-full object-contain transition duration-500 group-hover:scale-105"; // Fit in card
            imgEl.loading = "lazy";
            
            const originalSrc = `/images/${img.filename}`;
            const thumbSrc = `/thumbnails/${img.filename}`;
            
            // Init Source
            if (this.state.preferHQ) {
                imgEl.src = originalSrc;
            } else {
                imgEl.src = thumbSrc;
                imgEl.dataset.original = originalSrc;
            }

            // Click Handler (Load Original OR Paste Tags)
            imgEl.onclick = () => {
                if (this.state.isTempTagMode) {
                    this.applyTempTags(img, card, tagsContainer);
                    return;
                }
                
                // Normal Mode: Load original if not already
                if (imgEl.src !== originalSrc && !imgEl.src.endsWith(originalSrc)) {
                    hourglass.classList.remove('hidden');
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        imgEl.src = originalSrc;
                        hourglass.classList.add('hidden');
                    };
                    tempImg.src = originalSrc;
                }
            };

            // --- UI Elements ---

            // Hourglass
            const hourglass = document.createElement('div');
            hourglass.className = "absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-md z-10 hidden";
            hourglass.innerHTML = `<i data-lucide="hourglass" class="w-8 h-8 animate-hourglass"></i>`;

            // Top Toolbar (Download, Hourglass, Copy, Delete)
            const topBar = document.createElement('div');
            topBar.className = "top-toolbar absolute top-0 left-0 right-0 p-2 flex justify-between items-start opacity-0 group-hover:opacity-100 transition-opacity z-20";
            
            // Left: Download
            const dlBtn = document.createElement('a');
            dlBtn.href = originalSrc;
            dlBtn.download = img.filename;
            dlBtn.className = "p-2 bg-black/40 text-white rounded-lg hover:bg-black/60 backdrop-blur";
            dlBtn.innerHTML = `<i data-lucide="download" class="w-5 h-5"></i>`;
            dlBtn.onclick = (e) => e.stopPropagation();

            // Right Container
            const rightActions = document.createElement('div');
            rightActions.className = "flex gap-2";

            const btnCopy = this.createIconBtn('copy', () => this.copyText(img.filename, btnCopy));
            const btnDel = this.createIconBtn(img.is_trash ? 'refresh-cw' : 'trash-2', (e) => this.toggleTrash(img, card, btnDel, e), img.is_trash ? 'bg-red-500 text-white' : '');

            rightActions.appendChild(btnCopy);
            rightActions.appendChild(btnDel);

            topBar.appendChild(dlBtn);
            topBar.appendChild(rightActions);

            // Bottom Overlay (Info + Tags)
            const overlay = document.createElement('div');
            overlay.className = "image-overlay absolute bottom-0 left-0 right-0 p-3 pt-8 flex flex-col justify-end text-white transition-opacity duration-300";

            // Info Line (Ext, Res, Size)
            const infoLine = document.createElement('div');
            infoLine.className = "text-[10px] font-mono opacity-80 mb-1 flex flex-col gap-0 leading-tight";
            const ext = img.filename.split('.').pop().toUpperCase();
            const sizeStr = (img.size / (1024 * 1024)).toFixed(3) + 'MB';
            infoLine.innerHTML = `<span>${ext}</span><span>${img.w}x${img.h}</span><span>${sizeStr}</span>`;

            // Tags Container
            const tagsContainer = document.createElement('div');
            tagsContainer.className = "flex flex-wrap gap-1";
            this.renderOverlayTags(tagsContainer, img.tags);
            
            // Edit trigger
            tagsContainer.onclick = (e) => {
                e.stopPropagation();
                // Allow edit even if in temp mode (per user request)
                this.startOverlayEdit(img, card, overlay, tagsContainer);
            };

            // Assemble
            overlay.appendChild(infoLine);
            overlay.appendChild(tagsContainer);
            
            card.appendChild(imgEl);
            card.appendChild(hourglass);
            card.appendChild(topBar);
            card.appendChild(overlay);

            frag.appendChild(card);
        });

        this.dom.grid.appendChild(frag);
        lucide.createIcons();
    }

    createIconBtn(icon, onClick, extraClass = '') {
        const btn = document.createElement('button');
        btn.className = `p-2 bg-black/40 text-white rounded-lg hover:bg-black/60 backdrop-blur transition ${extraClass}`;
        btn.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i>`; 
        btn.onclick = (e) => {
            e.stopPropagation();
            onClick(e);
        };
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
            sp.className = "px-2 py-1 bg-white/20 backdrop-blur-md rounded text-sm font-medium border border-white/10 shadow-sm";
            sp.textContent = t;
            container.appendChild(sp);
        });
    }

    async applyTempTags(imgData, card, tagsContainer) {
        if (this.state.tempTags.length === 0) return;
        
        const oldTags = [...imgData.tags];
        let changed = false;
        
        // Extract text from TagInput state objects if needed (though tempTags are usually just strings)
        // But our TagInput stores mix. Let's ensure string.
        const tagsToAdd = this.state.tempTags.map(t => typeof t === 'object' ? t.text : t);

        tagsToAdd.forEach(t => {
            if (!imgData.tags.includes(t)) {
                imgData.tags.push(t);
                changed = true;
            }
        });

        if (changed) {
            try {
                this.renderOverlayTags(tagsContainer, imgData.tags);
                // Visual feedback
                card.style.transform = "scale(0.95)";
                setTimeout(() => card.style.transform = "", 150);
                
                await fetch('/api/update_tags', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ md5: imgData.md5, tags: imgData.tags })
                });
            } catch (e) {
                console.error("Failed to update tags", e);
                imgData.tags = oldTags;
                this.renderOverlayTags(tagsContainer, imgData.tags);
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
            imgData.tags = currentTags;

            // Check trash bin status
            const hasTrash = imgData.tags.includes('trash_bin');
            if (hasTrash !== imgData.is_trash) {
                imgData.is_trash = hasTrash;
                this.updateCardTrashUI(imgData, cardEl, cardEl.querySelector('.top-toolbar button:last-child'));
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
                this.renderOverlayTags(tagsContainerEl, imgData.tags);
                // Revert trash UI if failed
                if (imgData.is_trash !== oldTags.includes('trash_bin')) {
                     imgData.is_trash = oldTags.includes('trash_bin');
                     this.updateCardTrashUI(imgData, cardEl, cardEl.querySelector('.top-toolbar button:last-child'));
                }
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

        // Update UI
        this.updateCardTrashUI(imgData, cardEl, btnEl);
        
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
            this.updateCardTrashUI(imgData, cardEl, btnEl);
        }
    }

    updateCardTrashUI(imgData, cardEl, btnEl) {
         if (imgData.is_trash) {
            cardEl.classList.add('is-trash');
            btnEl.innerHTML = `<i data-lucide="refresh-cw" class="w-5 h-5"></i>`;
            btnEl.classList.add('bg-red-500', 'text-white');
            btnEl.classList.remove('bg-black/40');
        } else {
            cardEl.classList.remove('is-trash');
            btnEl.innerHTML = `<i data-lucide="trash-2" class="w-5 h-5"></i>`;
            btnEl.classList.remove('bg-red-500', 'text-white');
            btnEl.classList.add('bg-black/40');
        }
        lucide.createIcons();
    }

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
            btn.innerHTML = `<i data-lucide="check" class="w-5 h-5"></i>`;
            lucide.createIcons();
            setTimeout(() => {
                btn.classList.add('bg-black/40');
                btn.classList.remove('bg-green-500');
                btn.innerHTML = original;
                lucide.createIcons();
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy', err);
        });
    }

    async handleUpload(files) {
        if (files.length === 0) return;
        const btn = this.dom.fabUpload;
        const originalContent = btn.innerHTML;
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
            alert("上传失败，请重试");
        } finally {
            btn.innerHTML = originalContent;
            lucide.createIcons();
        }
    }
}

window.app = new MemeApp();