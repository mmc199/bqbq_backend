# 前端功能增强代码集成指南

本文档包含需要添加到 `script.js` 的所有新功能代码片段。

---

## 1. 前端MD5计算和上传优化

### 在 `MemeApp` 类中添加MD5计算方法

```javascript
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
 * 检查MD5是否已存在
 * @param {string} md5 - MD5哈希值
 * @returns {Promise<object>} {exists: boolean, filename: string}
 */
async checkMD5Exists(md5) {
    const response = await fetch('/api/check_md5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md5 })
    });
    return await response.json();
}
```

### 修改上传处理函数

找到 `handleUpload` 方法并替换为：

```javascript
async handleUpload(files) {
    console.log(`Uploading ${files.length} file(s)...`);

    for (const file of files) {
        try {
            // 1. 计算MD5
            const md5 = await this.calculateMD5(file);
            console.log(`File MD5: ${md5}`);

            // 2. 检查是否已存在
            const checkResult = await this.checkMD5Exists(md5);

            if (checkResult.exists) {
                // 重复文件：仅刷新时间戳
                this.showToast(`图片已存在：${file.name}（已更新时间戳）`, 'info');
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

        } catch (error) {
            console.error('Upload error:', error);
            this.showToast(`上传出错：${error.message}`, 'error');
        }
    }

    // 完成后刷新搜索
    this.performSearch(0);
}
```

---

## 2. JSON导入导出功能

### 在 `MemeApp` 类中添加导入导出方法

```javascript
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
            this.performSearch(0);
        } else {
            this.showToast(`导入失败：${result.error}`, 'error');
        }

    } catch (error) {
        console.error('Import error:', error);
        this.showToast(`导入失败：${error.message}`, 'error');
    }
}
```

---

## 3. 关系树搜索筛选功能

### 在 `MemeApp` 类中添加搜索方法

```javascript
/**
 * 更新规则树搜索建议
 */
updateTreeSearchSuggestions() {
    const datalist = document.getElementById('tree-suggestions');
    if (!datalist) return;

    datalist.innerHTML = '';

    // 收集所有组名和关键词
    const suggestions = new Set();

    this.state.rulesTree.forEach(group => {
        suggestions.add(group.groupName);
        group.keywords.forEach(kw => suggestions.add(kw.text));
    });

    // 添加到datalist
    Array.from(suggestions).sort().forEach(text => {
        const option = document.createElement('option');
        option.value = text;
        datalist.appendChild(option);
    });
}

/**
 * 筛选并高亮显示规则树节点
 * @param {string} searchText - 搜索关键词
 */
filterRulesTree(searchText) {
    const container = document.getElementById('rules-tree-container');
    if (!container) return;

    const normalizedSearch = searchText.toLowerCase().trim();

    if (!normalizedSearch) {
        // 清空搜索：显示所有节点
        container.querySelectorAll('.group-card').forEach(card => {
            card.style.display = '';
            card.classList.remove('ring-2', 'ring-green-400');
        });
        return;
    }

    let matchCount = 0;

    container.querySelectorAll('.group-card').forEach(card => {
        const groupId = card.dataset.id;
        const group = this.state.rulesTree.find(g => g.id == groupId);

        if (!group) {
            card.style.display = 'none';
            return;
        }

        // 检查组名或关键词是否匹配
        const groupNameMatch = group.groupName.toLowerCase().includes(normalizedSearch);
        const keywordMatch = group.keywords.some(kw =>
            kw.text.toLowerCase().includes(normalizedSearch)
        );

        if (groupNameMatch || keywordMatch) {
            card.style.display = '';
            card.classList.add('ring-2', 'ring-green-400');
            matchCount++;

            // 滚动到第一个匹配项
            if (matchCount === 1) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } else {
            card.style.display = 'none';
            card.classList.remove('ring-2', 'ring-green-400');
        }
    });

    if (matchCount === 0) {
        this.showToast('未找到匹配项', 'info');
    }
}
```

---

## 4. 完善关系树编辑功能（彻底删除）

### 在规则树渲染中添加删除按钮

找到 `renderRulesTree` 方法中的组卡片渲染部分，添加彻底删除按钮：

```javascript
// 在组名行添加删除按钮
groupHeaderLine += `
    <button class="delete-group-btn ml-auto text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50"
            data-group-id="${group.id}"
            title="彻底删除此组">
        <i data-lucide="trash" class="w-3 h-3 inline"></i>
    </button>
`;
```

### 添加删除组的处理方法

```javascript
/**
 * 彻底删除一个组（包括所有关键词和层级关系）
 * @param {number} groupId - 组ID
 */
async deleteGroup(groupId) {
    const group = this.state.rulesTree.find(g => g.id == groupId);
    if (!group) return;

    const confirmMsg = `确定要彻底删除组「${group.groupName}」吗？\n\n这将：\n1. 删除该组的所有关键词\n2. 删除所有相关的层级关系\n3. 此操作无法撤销！`;

    if (!confirm(confirmMsg)) return;

    try {
        // 1. 删除所有关键词
        for (const keyword of group.keywords) {
            await this.handleSave(
                { url: '/api/rules/keyword/remove', method: 'POST', type: 'remove_keyword' },
                { group_id: groupId, keyword: keyword.text }
            );
        }

        // 2. 删除所有父子关系
        const childRelations = this.state.rulesTree.filter(g =>
            g.parentIds && g.parentIds.includes(groupId)
        );

        for (const child of childRelations) {
            await this.handleSave(
                { url: '/api/rules/hierarchy/remove', method: 'POST', type: 'remove_hierarchy' },
                { parent_id: groupId, child_id: child.id }
            );
        }

        const parentRelations = group.parentIds || [];
        for (const parentId of parentRelations) {
            await this.handleSave(
                { url: '/api/rules/hierarchy/remove', method: 'POST', type: 'remove_hierarchy' },
                { parent_id: parentId, child_id: groupId }
            );
        }

        // 3. 软删除组（或添加一个真正的删除API）
        await this.handleSave(
            { url: '/api/rules/group/update', method: 'POST', type: 'update_group' },
            { group_id: groupId, group_name: group.groupName, is_enabled: 0 }
        );

        this.showToast(`组「${group.groupName}」已删除`, 'success');
        await this.loadRulesTree(true);

    } catch (error) {
        console.error('Delete group error:', error);
        this.showToast(`删除失败：${error.message}`, 'error');
    }
}
```

---

## 5. 优化自动补全提示词源

### 修改 `loadTagSuggestions` 方法

找到 `loadTagSuggestions` 方法并替换为：

```javascript
async loadTagSuggestions() {
    const cacheKey = 'bqbq_tag_cache';
    const timestampKey = 'bqbq_tag_timestamp';
    const CACHE_DURATION = 10 * 60 * 1000; // 10分钟

    const now = Date.now();
    const lastUpdate = parseInt(localStorage.getItem(timestampKey) || '0');

    if (now - lastUpdate < CACHE_DURATION) {
        const cachedTags = localStorage.getItem(cacheKey);
        if (cachedTags) {
            this.updateDatalist(JSON.parse(cachedTags));
            console.log('[Cache] Using cached tag suggestions');
            return;
        }
    }

    try {
        // 1. 获取图片标签
        const tagsResponse = await fetch('/api/meta/tags');
        const imageTags = await tagsResponse.json();

        // 2. 获取规则树关键词
        const rulesKeywords = new Set();
        this.state.rulesTree.forEach(group => {
            rulesKeywords.add(group.groupName); // 添加组名
            group.keywords.forEach(kw => rulesKeywords.add(kw.text)); // 添加关键词
        });

        // 3. 合并去重
        const allSuggestions = Array.from(new Set([...imageTags, ...rulesKeywords]));

        // 4. 缓存
        localStorage.setItem(cacheKey, JSON.stringify(allSuggestions));
        localStorage.setItem(timestampKey, now.toString());

        this.updateDatalist(allSuggestions);
        console.log(`[Suggestions] Loaded ${allSuggestions.length} suggestions (${imageTags.length} from images, ${rulesKeywords.size} from rules)`);

    } catch (error) {
        console.error('Failed to load tag suggestions:', error);
    }
}
```

---

## 6. 事件监听器绑定

在 `MemeApp` 的 `init()` 方法或单独的初始化函数中添加：

```javascript
// 导出按钮
document.getElementById('fab-export')?.addEventListener('click', () => {
    this.exportAllData();
});

// 导入按钮
const importBtn = document.getElementById('fab-import');
const jsonInput = document.getElementById('json-import-input');

importBtn?.addEventListener('click', () => {
    jsonInput?.click();
});

jsonInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
        await this.importAllData(file);
        e.target.value = ''; // 清空以允许重复选择同一文件
    }
});

// 规则树搜索
const treeSearchInput = document.getElementById('rules-tree-search');
treeSearchInput?.addEventListener('input', (e) => {
    this.filterRulesTree(e.target.value);
});

// 删除组按钮（事件委托）
document.getElementById('rules-tree-container')?.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.delete-group-btn');
    if (deleteBtn) {
        const groupId = parseInt(deleteBtn.dataset.groupId);
        await this.deleteGroup(groupId);
    }
});
```

---

## 7. 在 `renderRulesTree()` 后调用建议更新

在 `renderRulesTree()` 方法的最后添加：

```javascript
// 更新规则树搜索建议
this.updateTreeSearchSuggestions();

// 重新加载标签建议（因为规则树可能变化）
this.loadTagSuggestions();
```

---

## 集成步骤总结

1. **复制MD5计算方法** → 添加到 `MemeApp` 类
2. **替换 `handleUpload` 方法** → 使用新版本（带MD5检查）
3. **添加导入导出方法** → `exportAllData()` 和 `importAllData()`
4. **添加规则树搜索方法** → `updateTreeSearchSuggestions()` 和 `filterRulesTree()`
5. **添加删除组方法** → `deleteGroup()`
6. **修改 `loadTagSuggestions()`** → 合并图片标签和规则树关键词
7. **添加事件监听器** → 在 `init()` 或类似位置绑定
8. **更新 `renderRulesTree()`** → 调用建议更新函数

---

## 测试检查清单

- [ ] 上传重复图片时显示"已更新时间戳"
- [ ] 点击导出按钮下载JSON文件
- [ ] 点击导入按钮可选择JSON文件并导入
- [ ] 规则树搜索栏可筛选和高亮显示匹配项
- [ ] 删除组按钮可彻底删除组及其关系
- [ ] 自动补全包含图片标签和规则树关键词
- [ ] 所有新图标正确显示（Lucide icons）

---

**注意**: 所有代码片段都需要整合到现有的 `script.js` 文件中，确保不破坏现有功能。建议先备份原文件，然后逐个功能测试。
