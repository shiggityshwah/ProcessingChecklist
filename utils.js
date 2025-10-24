/*************************************************************************************************
 *  utils.js - Utility functions for the ProcessingChecklist extension
 *************************************************************************************************/
(function() {
    "use strict";

    const Utils = {
        /**
         * Escape HTML special characters to prevent XSS
         * @param {string} unsafe - The unsafe string to escape
         * @returns {string} The escaped string safe for HTML insertion
         */
        escapeHtml(unsafe) {
            if (typeof unsafe !== 'string') return unsafe;
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        },

        /**
         * Debounce function calls to reduce excessive execution
         * @param {Function} func - The function to debounce
         * @param {number} wait - The debounce delay in milliseconds
         * @returns {Function} The debounced function
         */
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        /**
         * Throttle function calls to limit execution frequency
         * @param {Function} func - The function to throttle
         * @param {number} limit - Minimum time between executions in milliseconds
         * @returns {Function} The throttled function
         */
        throttle(func, limit) {
            let inThrottle;
            return function(...args) {
                if (!inThrottle) {
                    func.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        },

        /**
         * Format currency value
         * @param {number|string} amount - The amount to format
         * @returns {string} Formatted currency string
         */
        formatCurrency(amount) {
            const num = typeof amount === 'string' ? parseFloat(amount) : amount;
            if (isNaN(num)) return '$0.00';
            return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        },

        /**
         * Generate a unique ID (more robust than Date.now())
         * @returns {string} Unique identifier
         */
        generateUniqueId() {
            return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        },

        /**
         * Deep clone an object (for state management)
         * @param {*} obj - Object to clone
         * @returns {*} Cloned object
         */
        deepClone(obj) {
            if (obj === null || typeof obj !== 'object') return obj;
            if (obj instanceof Date) return new Date(obj.getTime());
            if (obj instanceof Array) return obj.map(item => this.deepClone(item));
            if (obj instanceof Object) {
                const clonedObj = {};
                for (const key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        clonedObj[key] = this.deepClone(obj[key]);
                    }
                }
                return clonedObj;
            }
        },

        /**
         * Validate storage data structure
         * @param {*} data - Data to validate
         * @param {Object} schema - Expected schema
         * @returns {boolean} Whether data matches schema
         */
        validateData(data, schema) {
            if (typeof data !== typeof schema) return false;
            if (schema === null) return data === null;
            if (typeof schema !== 'object') return true;

            if (Array.isArray(schema)) {
                if (!Array.isArray(data)) return false;
                return data.every(item => this.validateData(item, schema[0]));
            }

            for (const key in schema) {
                if (schema.hasOwnProperty(key)) {
                    if (!data.hasOwnProperty(key)) return false;
                    if (!this.validateData(data[key], schema[key])) return false;
                }
            }
            return true;
        },

        /**
         * Cached DOM selector with TTL (Time To Live)
         */
        SelectorCache: {
            cache: new Map(),

            /**
             * Get element from cache or query DOM
             * @param {string} selector - CSS selector
             * @param {number} ttl - Cache TTL in milliseconds (default 5000)
             * @returns {Element|null} DOM element or null
             */
            get(selector, ttl = 5000) {
                const cached = this.cache.get(selector);
                const now = Date.now();

                if (cached && (now - cached.time) < ttl) {
                    // Check if element is still in DOM
                    if (document.contains(cached.element)) {
                        return cached.element;
                    }
                }

                const element = document.querySelector(selector);
                if (element) {
                    this.cache.set(selector, { element, time: now });
                }
                return element;
            },

            /**
             * Clear all cached selectors
             */
            clear() {
                this.cache.clear();
            },

            /**
             * Remove specific selector from cache
             * @param {string} selector - CSS selector to remove
             */
            remove(selector) {
                this.cache.delete(selector);
            }
        }
    };

    // Expose utilities globally for extension use
    window.ProcessingChecklistUtils = Utils;

    const logger = Logger.create('Utils');
    logger.info('Utility functions loaded');
})();
