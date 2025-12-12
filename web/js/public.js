// 用于配置API主机地址，无需跨域时留空
const API_HOST = '';

/**
 * 防抖Fetch请求封装
 */

// 存储防抖的请求状态
const debounceCache = new Map();

/**
 * 防抖函数
 * @param {Function} func - 要执行的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @param {string} key - 缓存键，用于区分不同的防抖请求
 * @returns {Function} 防抖后的函数
 */
function debounce(func, delay, key = 'default') {
  return function (...args) {
    // 清除前一次的超时
    if (debounceCache.has(key)) {
      clearTimeout(debounceCache.get(key));
    }

    // 设置新的超时
    const timer = setTimeout(() => {
      func.apply(this, args);
      debounceCache.delete(key);
    }, delay);

    debounceCache.set(key, timer);
  };
}

/**
 * 防抖Fetch请求
 * @param {string} url - 请求地址
 * @param {Object} options - fetch配置
 * @param {number} delay - 防抖延迟时间（毫秒），默认300ms
 * @param {string} key - 防抖键，相同键会复用防抖逻辑
 * @returns {Promise} 返回Promise
 */
function debounceFetch(url, options = {}, delay = 300, key = url) {
  // debug
  url = `${API_HOST}${url}`;
  return new Promise((resolve, reject) => {
    const debouncedRequest = debounce(async () => {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        resolve(response);
      } catch (error) {
        reject(error);
      }
    }, delay, key);

    debouncedRequest();
  });
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { API_HOST, debounce, debounceFetch };
}
