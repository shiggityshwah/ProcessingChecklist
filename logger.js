/*************************************************************************************************
 *  logger.js - Centralized logging utility with debug flag support
 *
 *  Usage:
 *    const logger = Logger.create('ComponentName');
 *    logger.info('Message');          // Always shown
 *    logger.warn('Warning');          // Always shown
 *    logger.error('Error');           // Always shown
 *    logger.debug('Debug info');      // Only shown when debug mode enabled
 *
 *  Enable/Disable Debug Mode:
 *    Logger.setDebug(true);           // Enable debug logging
 *    Logger.setDebug(false);          // Disable debug logging
 *    Logger.toggleDebug();            // Toggle debug mode
 *
 *  From Browser Console:
 *    window.Logger.setDebug(true);    // Enable debug mode
 *    window.Logger.getDebug();        // Check current state
 *************************************************************************************************/
(function() {
    "use strict";

    const STORAGE_KEY = 'processingChecklist_debugMode';
    const GLOBAL_PREFIX = '[ProcessingChecklist]';

    class Logger {
        constructor(component) {
            this.component = component;
            this.prefix = component ? `${GLOBAL_PREFIX} [${component}]` : GLOBAL_PREFIX;
        }

        /**
         * Info message - always shown
         */
        info(message, ...args) {
            console.log(this.prefix, message, ...args);
        }

        /**
         * Warning message - always shown
         */
        warn(message, ...args) {
            console.warn(this.prefix, message, ...args);
        }

        /**
         * Error message - always shown
         */
        error(message, ...args) {
            console.error(this.prefix, message, ...args);
        }

        /**
         * Debug message - only shown when debug mode is enabled
         */
        debug(message, ...args) {
            if (Logger._debugMode) {
                console.log(`${this.prefix} [DEBUG]`, message, ...args);
            }
        }

        /**
         * Group start - for collapsible console groups
         */
        group(label) {
            if (Logger._debugMode) {
                console.group(`${this.prefix} ${label}`);
            }
        }

        /**
         * Group end
         */
        groupEnd() {
            if (Logger._debugMode) {
                console.groupEnd();
            }
        }

        /**
         * Table output - useful for arrays/objects
         */
        table(data, columns) {
            if (Logger._debugMode) {
                console.log(this.prefix);
                console.table(data, columns);
            }
        }

        // Static methods for global debug control
        static _debugMode = false;
        static _initialized = false;

        /**
         * Create a new logger instance for a component
         */
        static create(component) {
            // Initialize debug mode from storage on first use
            if (!Logger._initialized) {
                Logger._initDebugMode();
            }
            return new Logger(component);
        }

        /**
         * Initialize debug mode from storage
         */
        static _initDebugMode() {
            Logger._initialized = true;

            // Try to load from browser storage (async, non-blocking)
            const ext = (typeof browser !== 'undefined') ? browser : chrome;
            if (ext && ext.storage && ext.storage.local) {
                // Use try-catch to prevent crashes if storage unavailable
                try {
                    ext.storage.local.get(STORAGE_KEY, (result) => {
                        if (ext.runtime.lastError) {
                            // Ignore errors silently - debug mode stays disabled
                            return;
                        }
                        if (result && result[STORAGE_KEY] !== undefined) {
                            Logger._debugMode = result[STORAGE_KEY];
                            // Only log if actually enabled to reduce noise
                            if (Logger._debugMode) {
                                console.log(GLOBAL_PREFIX, 'Debug mode: ENABLED');
                            }
                        }
                    });
                } catch (error) {
                    // Silently fail - debug mode stays disabled
                }
            }
        }

        /**
         * Enable or disable debug mode
         */
        static setDebug(enabled) {
            Logger._debugMode = !!enabled;
            console.log(GLOBAL_PREFIX, `Debug mode ${enabled ? 'ENABLED' : 'DISABLED'}`);

            // Save to storage
            const ext = (typeof browser !== 'undefined') ? browser : chrome;
            if (ext && ext.storage && ext.storage.local) {
                ext.storage.local.set({ [STORAGE_KEY]: Logger._debugMode });
            }
        }

        /**
         * Toggle debug mode
         */
        static toggleDebug() {
            Logger.setDebug(!Logger._debugMode);
        }

        /**
         * Get current debug mode state
         */
        static getDebug() {
            return Logger._debugMode;
        }
    }

    // Expose globally
    window.Logger = Logger;

    console.log(GLOBAL_PREFIX, 'Logger utility loaded');
})();
