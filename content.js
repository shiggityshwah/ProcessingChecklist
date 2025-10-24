/*************************************************************************************************
 *  content.js - The main content script for the Processing Checklist extension.
/*************************************************************************************************/
(function() {
    "use strict";
    const LOG_PREFIX = "[ProcessingChecklist]";
    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    let port = null;
    let currentIndex = -1;
    let isInitializing = true;
    let myTabId = null;
    let reconnectTimer = null;
    let isConnected = false;
    let isOwnStorageUpdate = false; // True when we're updating storage ourselves (to prevent duplicate updateProgress calls)
    let isProgrammaticUpdate = false; // Flag to prevent change event loops
    let isResetting = false; // Flag to track reset in progress
    let highlightZones = new Map(); // Track created zone divs by index
    let zoneCheckboxes = new Map(); // Track zone checkboxes by index: Map<itemIndex, Array<{checkbox, zoneIndex}>>
    let loggedWarnings = new Set(); // Track logged warnings to avoid spam

    const RECONNECT_DELAY = 2000; // 2 seconds

    // Configuration will be loaded dynamically
    let checklist = [];
    let config = null;
    let configLoaded = false;

    // Change tracking - store original field values for detecting broker errors
    let originalFieldValues = {}; // { stepName: { fieldName: originalValue } }
    let originalValuesCaptured = false;

    /**
     * Capture original field values from all checklist items when form is first loaded
     * This allows us to detect which fields were changed from broker-entered values
     */
    function captureOriginalFieldValues() {
        if (originalValuesCaptured) {
            console.log(LOG_PREFIX, "[ChangeTracking] Original values already captured, skipping");
            return;
        }

        console.log(LOG_PREFIX, "[ChangeTracking] Capturing original field values");
        originalFieldValues = {};

        checklist.forEach((step, index) => {
            const stepName = step.name;
            originalFieldValues[stepName] = {};

            if (step.type === 'group') {
                step.fields.forEach(field => {
                    const element = document.querySelector(field.selector);
                    if (element) {
                        let value = '';
                        if (field.type === 'checkbox') {
                            value = element.checked;
                        } else if (field.type === 'select' || field.type === 'radio') {
                            value = element.value;
                        } else if (field.type === 'virtual') {
                            value = element.innerText;
                        } else if (field.type === 'kendo_widget') {
                            if (typeof KendoWidgetUtils !== 'undefined' && KendoWidgetUtils.isKendoAvailable()) {
                                value = KendoWidgetUtils.getWidgetValue(element) || '';
                            } else {
                                value = element.value || '';
                            }
                        } else {
                            value = element.value;
                        }
                        originalFieldValues[stepName][field.name] = value;
                    }
                });
            } else if (step.type === 'custom') {
                // Handle custom types like fees table
                if (step.table_id === 'feesTable') {
                    const tableSelector = 'div.col-md-7:nth-child(2) > div:nth-child(1) > table:nth-child(1)';
                    const table = document.querySelector(tableSelector);
                    if (table) {
                        const rows = table.querySelectorAll('tbody tr');
                        rows.forEach((row, rowIndex) => {
                            const cells = row.querySelectorAll('td');
                            if (cells.length >= 3) {
                                // Extract fee name
                                let feeName = '';
                                if (rowIndex === 3) {
                                    // OTHER FEE row - check for custom name
                                    const customNameInput = row.querySelector('#TransactionFees_3__OtherFeeType');
                                    const customName = customNameInput ? customNameInput.value.trim() : '';
                                    feeName = customName || 'OTHER FEE';
                                } else {
                                    // Regular fee rows - get static name from first cell
                                    const firstCell = cells[0];
                                    const textNodes = Array.from(firstCell.childNodes)
                                        .filter(node => node.nodeType === Node.TEXT_NODE)
                                        .map(node => node.textContent.trim())
                                        .filter(text => text.length > 0);
                                    feeName = textNodes[0] || `Fee ${rowIndex}`;
                                }

                                // Capture taxable checkbox
                                const taxableCheckbox = cells[1].querySelector('input[type="checkbox"]');
                                const taxableFieldName = `${feeName} Taxable`;
                                originalFieldValues[stepName][taxableFieldName] = taxableCheckbox ? taxableCheckbox.checked : false;

                                // Capture amount
                                const hiddenInput = cells[2].querySelector('input[id*="FeeAmount"]');
                                const amountFieldName = `${feeName} Amount`;
                                originalFieldValues[stepName][amountFieldName] = hiddenInput ? hiddenInput.value : '';
                            }
                        });
                    }
                }
            } else if (step.type === 'table') {
                // Handle table types
                const tableData = getTableData(step);
                if (tableData && tableData.rows) {
                    tableData.rows.forEach((row, rowIndex) => {
                        Object.keys(row).forEach(columnName => {
                            const fieldName = `Row ${rowIndex} - ${columnName}`;
                            originalFieldValues[stepName][fieldName] = row[columnName];
                        });
                    });
                }
            }
        });

        originalValuesCaptured = true;
        console.log(LOG_PREFIX, "[ChangeTracking] Original values captured:", originalFieldValues);

        // Store original values in tracking helper for persistence
        if (window.trackingHelper && window.trackingHelper.storeOriginalValues) {
            window.trackingHelper.storeOriginalValues(originalFieldValues);
        }
    }

    /**
     * Detect changes in a specific checklist step by comparing current values to original values
     * @param {number} stepIndex - Index of the step to check
     * @returns {Object} { stepName, changedFields: [fieldNames], fieldCount }
     */
    function detectStepChanges(stepIndex) {
        const step = checklist[stepIndex];
        const stepName = step.name;
        const changedFields = [];

        if (!originalFieldValues[stepName]) {
            return { stepName, changedFields, fieldCount: 0 };
        }

        if (step.type === 'group') {
            step.fields.forEach(field => {
                const element = document.querySelector(field.selector);
                if (element) {
                    let currentValue = '';
                    if (field.type === 'checkbox') {
                        currentValue = element.checked;
                    } else if (field.type === 'select' || field.type === 'radio') {
                        currentValue = element.value;
                    } else if (field.type === 'virtual') {
                        currentValue = element.innerText;
                    } else if (field.type === 'kendo_widget') {
                        if (typeof KendoWidgetUtils !== 'undefined' && KendoWidgetUtils.isKendoAvailable()) {
                            currentValue = KendoWidgetUtils.getWidgetValue(element) || '';
                        } else {
                            currentValue = element.value || '';
                        }
                    } else {
                        currentValue = element.value;
                    }

                    const originalValue = originalFieldValues[stepName][field.name];
                    // Use loose equality to handle string/boolean comparisons
                    if (currentValue != originalValue) {
                        changedFields.push(field.name);
                    }
                }
            });
        } else if (step.type === 'custom' && step.table_id === 'feesTable') {
            const tableSelector = 'div.col-md-7:nth-child(2) > div:nth-child(1) > table:nth-child(1)';
            const table = document.querySelector(tableSelector);
            if (table) {
                const rows = table.querySelectorAll('tbody tr');
                rows.forEach((row, rowIndex) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 3) {
                        // Extract fee name (same logic as in captureOriginalValues)
                        let feeName = '';
                        if (rowIndex === 3) {
                            // OTHER FEE row - check for custom name
                            const customNameInput = row.querySelector('#TransactionFees_3__OtherFeeType');
                            const customName = customNameInput ? customNameInput.value.trim() : '';
                            feeName = customName || 'OTHER FEE';
                        } else {
                            // Regular fee rows - get static name from first cell
                            const firstCell = cells[0];
                            const textNodes = Array.from(firstCell.childNodes)
                                .filter(node => node.nodeType === Node.TEXT_NODE)
                                .map(node => node.textContent.trim())
                                .filter(text => text.length > 0);
                            feeName = textNodes[0] || `Fee ${rowIndex}`;
                        }

                        // Check taxable checkbox
                        const taxableCheckbox = cells[1].querySelector('input[type="checkbox"]');
                        const taxableFieldName = `${feeName} Taxable`;
                        const currentTaxable = taxableCheckbox ? taxableCheckbox.checked : false;
                        const originalTaxable = originalFieldValues[stepName][taxableFieldName];
                        if (currentTaxable != originalTaxable) {
                            changedFields.push(taxableFieldName);
                        }

                        // Check amount
                        const hiddenInput = cells[2].querySelector('input[id*="FeeAmount"]');
                        const amountFieldName = `${feeName} Amount`;
                        const currentAmount = hiddenInput ? hiddenInput.value : '';
                        const originalAmount = originalFieldValues[stepName][amountFieldName];
                        if (currentAmount != originalAmount) {
                            changedFields.push(amountFieldName);
                        }
                    }
                });
            }
        } else if (step.type === 'table') {
            const tableData = getTableData(step);
            if (tableData && tableData.rows) {
                tableData.rows.forEach((row, rowIndex) => {
                    Object.keys(row).forEach(columnName => {
                        const fieldName = `Row ${rowIndex} - ${columnName}`;
                        const currentValue = row[columnName];
                        const originalValue = originalFieldValues[stepName][fieldName];
                        if (currentValue != originalValue) {
                            changedFields.push(fieldName);
                        }
                    });
                });
            }
        }

        return {
            stepName,
            changedFields,
            fieldCount: changedFields.length
        };
    }

    /**
     * Detect all changes across the entire checklist
     * Called when tracking progress to update change metadata
     * @param {boolean} isReviewMode - Whether changes are being made in review mode
     */
    function detectAllChanges(isReviewMode = false) {
        if (!originalValuesCaptured) {
            console.log(LOG_PREFIX, "[ChangeTracking] Original values not captured yet, skipping change detection");
            return null;
        }

        const stepsWithChanges = [];
        let totalFieldsChanged = 0;

        checklist.forEach((step, index) => {
            const changeData = detectStepChanges(index);
            if (changeData.fieldCount > 0) {
                stepsWithChanges.push({
                    stepName: changeData.stepName,
                    changedFields: changeData.changedFields,
                    fieldCount: changeData.fieldCount
                });
                totalFieldsChanged += changeData.fieldCount;
            }
        });

        const result = {
            stepsWithChanges,
            totalStepsWithChanges: stepsWithChanges.length,
            totalFieldsChanged,
            isReviewMode
        };

        console.log(LOG_PREFIX, `[ChangeTracking] Detected changes (reviewMode=${isReviewMode}):`, result);

        // Store changes in tracking helper
        if (window.trackingHelper && window.trackingHelper.storeChanges) {
            window.trackingHelper.storeChanges(result);
        }

        return result;
    }

    function connect() {
        try {
            port = ext.runtime.connect({ name: "content-script" });
            port.onMessage.addListener(handleMessage);
            port.onDisconnect.addListener(handleDisconnect);
            isConnected = true;
        } catch (e) {
            console.error(LOG_PREFIX, "Connection failed:", e);
            handleDisconnect();
        }
    }

    // Also listen for direct messages (for extended-history and other direct calls)
    ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
        handleMessage(message);
        return false; // Synchronous response
    });

    function handleDisconnect() {
        isConnected = false;
        port = null;
        console.log(LOG_PREFIX, "Port disconnected - attempting to reconnect");

        // Attempt to reconnect after a delay
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }

        // Try reconnecting with exponential backoff
        let reconnectAttempt = 0;
        const maxAttempts = 10;

        function attemptReconnect() {
            reconnectAttempt++;
            console.log(LOG_PREFIX, `Reconnection attempt ${reconnectAttempt}/${maxAttempts}`);

            try {
                connect();

                // If reconnected successfully, stop trying
                if (isConnected) {
                    console.log(LOG_PREFIX, "Reconnection successful");
                    // Broadcast current state if we have a tab ID
                    if (myTabId) {
                        const keys = getStorageKeys();
                        ext.storage.local.get(keys.checklistState, (result) => {
                            if (result[keys.checklistState]) {
                                broadcastUpdate(result[keys.checklistState]);
                            }
                        });
                    }
                    return;
                }
            } catch (e) {
                console.warn(LOG_PREFIX, `Reconnection attempt ${reconnectAttempt} failed:`, e);
            }

            // If not connected and haven't exceeded max attempts, try again
            if (!isConnected && reconnectAttempt < maxAttempts) {
                // Exponential backoff: 500ms, 1s, 2s, 4s, 8s (capped at 8s)
                const delay = Math.min(500 * Math.pow(2, reconnectAttempt - 1), 8000);
                reconnectTimer = setTimeout(attemptReconnect, delay);
            } else if (reconnectAttempt >= maxAttempts) {
                console.error(LOG_PREFIX, "Max reconnection attempts reached - giving up");
            }
        }

        // Start first reconnection attempt immediately
        reconnectTimer = setTimeout(attemptReconnect, 100);
    }

    function getStorageKeys() {
        return {
            checklistState: `checklistState_${myTabId}`,
            uiState: `uiState_${myTabId}`,
            viewMode: `viewMode_${myTabId}`,
            reviewState: `reviewState_${myTabId}`
        };
    }

    async function loadConfiguration() {
        try {
            config = await ConfigLoader.load();

            if (config.error) {
                ConfigLoader.showErrorNotification(config);
                showConfigError(config.error);
                return false;
            }

            checklist = config.checklist;
            configLoaded = true;
            console.log(LOG_PREFIX, "Configuration loaded successfully:", config.metadata);

            // Set up tracking helper function to get checklist total
            if (window.trackingHelper) {
                window.trackingHelper.getChecklistTotal = () => checklist.length;
            }

            // Log table items for debugging
            const tableItems = checklist.filter(item => item.type === 'table');
            if (tableItems.length > 0) {
                console.log(LOG_PREFIX, `[Table] Found ${tableItems.length} table item(s) in config:`);
                tableItems.forEach((item, idx) => {
                    console.log(LOG_PREFIX, `[Table] ${idx + 1}. "${item.name}"`, {
                        table_selector: item.table_selector,
                        row_selector: item.row_selector,
                        dynamic: item.dynamic,
                        columns: item.columns.map(c => `${c.name} (${c.type})`).join(', ')
                    });
                });
            }

            return true;
        } catch (error) {
            console.error(LOG_PREFIX, "Failed to load configuration:", error);
            showConfigError({
                type: 'LOAD_FAILED',
                message: 'Failed to load configuration',
                details: error.message
            });
            return false;
        }
    }

    function showConfigError(error) {
        // Create error display on page
        const errorDiv = document.createElement('div');
        errorDiv.id = 'processing-checklist-error';
        errorDiv.style.cssText = `
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            z-index: 10001 !important;
            background: #dc3545 !important;
            color: white !important;
            border: 2px solid #c82333 !important;
            border-radius: 8px !important;
            padding: 15px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
            font-family: Arial, sans-serif !important;
            font-size: 14px !important;
            max-width: 350px !important;
        `;
        errorDiv.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 16px;">⚠ Configuration Error</div>
            <div style="margin-bottom: 8px;">${error.message || 'Unknown error'}</div>
            <div style="font-size: 12px; margin-top: 8px; opacity: 0.9;">
                Check browser console (F12) for details
            </div>
        `;
        document.body.appendChild(errorDiv);
    }

    async function init() {
        isInitializing = true;

        // Load configuration first
        const loaded = await loadConfiguration();
        if (!loaded) {
            console.error(LOG_PREFIX, "Cannot initialize without valid configuration");
            return;
        }

        // Check if current page matches URL pattern
        if (!isMatchingPage()) {
            console.log(LOG_PREFIX, "Page does not match URL pattern - extension will not initialize");
            return;
        }

        connect();
        // Wait for tab ID from background script before initializing
    }

    function isMatchingPage() {
        const currentUrl = window.location.href;
        const urlPattern = config?.metadata?.url_pattern;

        if (!urlPattern) {
            console.warn(LOG_PREFIX, "No URL pattern defined in config - allowing all pages");
            return true;
        }

        // Split by | to support multiple patterns
        const patterns = urlPattern.split('|').map(p => p.trim());

        for (const pattern of patterns) {
            if (currentUrl.includes(pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Initialize after reconnection (when floating UI already exists)
     * This handles script reloads during downloads
     */
    function initializeAfterReconnection() {
        const keys = getStorageKeys();
        ext.storage.local.get([keys.checklistState, keys.uiState, keys.viewMode], (result) => {
            console.log(LOG_PREFIX, "Restoring after reconnection...");

            const storedState = result[keys.checklistState];

            if (storedState) {
                // Force complete restoration
                console.log(LOG_PREFIX, "Clearing zone tracking and reinjecting all checkboxes");
                zoneCheckboxes.clear();
                highlightZones.clear();

                // Reinject checkboxes
                injectConfirmationCheckboxes(storedState);

                // Reattach listeners to page elements
                attachListenersToPageElements();

                // Reinitialize table watchers
                initializeTableWatchers();

                // Update visuals
                updateItemVisuals(storedState);

                // Start observers
                setTimeout(() => {
                    isInitializing = false;
                    startPositionObserver();
                    startPeriodicRecoveryCheck();
                    console.log(LOG_PREFIX, "Reconnection restoration complete");
                }, 100);
            }
        });

        // Set up storage change listener
        ext.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                const keys = getStorageKeys();
                if (changes[keys.checklistState]) {
                    if (changes[keys.checklistState].newValue) {
                        if (isResetting) return;

                        // OPTIMIZATION: Skip full update if this was triggered by our own updateState
                        // Visual updates were already applied immediately
                        if (isOwnStorageUpdate) {
                            console.log(LOG_PREFIX, 'Skipping redundant updateAndBroadcast - already handled in updateState');
                            return;
                        }

                        ext.storage.local.get([keys.uiState, keys.viewMode], (result) => {
                            const state = changes[keys.checklistState].newValue;
                            updateAndBroadcast(state, result[keys.uiState], result[keys.viewMode]);
                        });
                    }
                }
            }
        });
    }

    function checkAndRestoreFromHistory(callback) {
        // Extract URL ID from current page
        const url = window.location.href;
        const editMatch = url.match(/\/Edit\/(\d+)/);
        if (!editMatch) {
            callback(null);
            return;
        }

        const urlId = editMatch[1];

        // Check tracking history for this form
        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];
            const historyItem = history.find(h => h.urlId === urlId);

            if (historyItem && historyItem.checkedProgress) {
                // Convert progress back to checklist state format
                // We need to map which items were checked
                console.log(LOG_PREFIX, "Restoring state from tracking history for:", urlId);

                // For now, we can't restore individual item state since we only track totals
                // Just return null to use fresh state
                callback(null);
            } else {
                callback(null);
            }
        });
    }

    function initializeWithTabId() {
        const keys = getStorageKeys();
        ext.storage.local.get([keys.checklistState, keys.uiState, keys.viewMode, 'defaultUIVisible', 'defaultViewMode'], (result) => {
            let storedState = result[keys.checklistState];
            let uiState = result[keys.uiState];
            let viewMode = result[keys.viewMode];

            if (!uiState) {
                // Use the defaultUIVisible setting, defaulting to false if not set
                const defaultVisible = result.defaultUIVisible === true;
                uiState = { visible: defaultVisible };
                ext.storage.local.set({ [keys.uiState]: uiState });
            }

            if (!viewMode) {
                // Use defaultViewMode, or fall back to 'full'
                viewMode = result.defaultViewMode || 'full';
                ext.storage.local.set({ [keys.viewMode]: viewMode });
            }

            // Check if we should restore state from tracking history
            if (!storedState || storedState.length !== checklist.length) {
                // Try to restore from tracking history if this form exists there
                checkAndRestoreFromHistory((restoredState) => {
                    storedState = restoredState || checklist.map(() => ({ processed: false, skipped: false }));
                    ext.storage.local.set({ [keys.checklistState]: storedState }, () => {
                        injectConfirmationCheckboxes(storedState);
                        injectMarkCheckedButton();
                        injectFindSimilarPoliciesButton();
                        injectInsurerQuickFillButton();
                        injectFeeSwapHandles();
                        attachListenersToPageElements();
                        initializeTableWatchers();
                        updateAndBroadcast(storedState, uiState, viewMode);
                        setTimeout(() => {
                            isInitializing = false;
                            // Start position observer after initialization
                            startPositionObserver();
                            // Start periodic recovery check for script reloads (e.g., after downloads)
                            startPeriodicRecoveryCheck();
                            // Detect and register form for tracking
                            if (window.trackingHelper && window.trackingHelper.detectAndRegisterForm) {
                                window.trackingHelper.detectAndRegisterForm();
                                // Note: updateProgress will be called from updateAndBroadcast when checkboxes change
                                // Don't call it here as detectAndRegisterForm is async and formIsComplete flag may not be set yet
                            }
                            // Capture original field values for change tracking
                            setTimeout(() => {
                                captureOriginalFieldValues();
                            }, 1000); // Delay to ensure all fields are loaded
                        }, 500);
                    });
                });
            } else {
                injectConfirmationCheckboxes(storedState);
                injectMarkCheckedButton();
                injectFindSimilarPoliciesButton();
                injectInsurerQuickFillButton();
                injectFeeSwapHandles();
                attachListenersToPageElements();
                initializeTableWatchers();
                updateAndBroadcast(storedState, uiState, viewMode);
                setTimeout(() => {
                    isInitializing = false;
                    // Start position observer after initialization
                    startPositionObserver();
                    // Start periodic recovery check for script reloads (e.g., after downloads)
                    startPeriodicRecoveryCheck();
                    // Detect and register form for tracking
                    if (window.trackingHelper && window.trackingHelper.detectAndRegisterForm) {
                        window.trackingHelper.detectAndRegisterForm();
                        // Note: updateProgress will be called from updateAndBroadcast when checkboxes change
                        // Don't call it here as detectAndRegisterForm is async and formIsComplete flag may not be set yet
                    }
                    // Capture original field values for change tracking
                    setTimeout(() => {
                        captureOriginalFieldValues();
                    }, 1000); // Delay to ensure all fields are loaded
                }, 500);
            }
        });
        ext.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                const keys = getStorageKeys();

                // Handle both regular state and review state changes
                if (changes[keys.checklistState] || changes[keys.reviewState]) {
                    const changedKey = changes[keys.checklistState] ? keys.checklistState : keys.reviewState;
                    const isReviewChange = changedKey === keys.reviewState;

                    console.log(LOG_PREFIX, `Storage changed: ${isReviewChange ? 'reviewState' : 'checklistState'}`, changes[changedKey]?.newValue);

                    if (changes[changedKey].newValue) {
                        // Skip if we're in the middle of a reset
                        if (isResetting) {
                            return;
                        }

                        // Normal state update (from this tab or another tab/window)
                        ext.storage.local.get([keys.uiState, keys.viewMode], (result) => {
                            const state = changes[changedKey].newValue;
                            updateAndBroadcast(state, result[keys.uiState], result[keys.viewMode], isOwnStorageUpdate);
                        });
                    } else {
                        // Storage was removed (reset clicked) - recreate fresh state
                        isResetting = true;
                        const freshState = checklist.map(() => ({ processed: false, skipped: false }));
                        // Mark as initializing to prevent event loops during reset
                        isInitializing = true;
                        isProgrammaticUpdate = true;

                        // Reset currentIndex so UI will re-render
                        currentIndex = -1;

                        // Set the fresh state which will trigger another storage change
                        ext.storage.local.set({ [keys.checklistState]: freshState }, () => {
                            // After state is set, get UI state and update visuals
                            ext.storage.local.get(keys.uiState, (result) => {
                                // Update visuals to clear checkboxes and backgrounds
                                updateItemVisuals(freshState);

                                // Show refresh message in on-page UI
                                const container = document.getElementById('processing-checklist-container');
                                if (container && result[keys.uiState] && result[keys.uiState].visible) {
                                    container.innerHTML = '<div style="text-align: center; padding: 20px;"><div style="color: #007cba; font-weight: bold; margin-bottom: 10px;">Checklist Reset</div><div style="margin-bottom: 10px;">Please refresh the page to continue</div><button id="refresh-button" style="background-color: #007cba; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;">Refresh Page</button></div>';

                                    const refreshBtn = document.getElementById('refresh-button');
                                    if (refreshBtn) {
                                        refreshBtn.addEventListener('click', () => window.location.reload());
                                    }
                                }

                                // Show refresh message in popout via broadcast
                                if (port && isConnected) {
                                    port.postMessage({ action: 'resetComplete' });
                                }

                                // Clear flags after a delay
                                setTimeout(() => {
                                    isInitializing = false;
                                    isProgrammaticUpdate = false;
                                    isResetting = false;
                                }, 100);
                            });
                        });
                    }
                } else if (changes[keys.uiState]) {
                    ext.storage.local.get([keys.checklistState, keys.viewMode], (result) => {
                        const checklistState = result[keys.checklistState];
                        const viewMode = result[keys.viewMode] || 'single';
                        const nextIndex = findNextStep(checklistState);
                        const fieldData = getFieldData(nextIndex);
                        renderOnPageUI(fieldData, checklistState, changes[keys.uiState].newValue, viewMode);
                    });
                } else if (changes[keys.viewMode]) {
                    // View mode changed - re-render UI
                    ext.storage.local.get([keys.checklistState, keys.uiState], (result) => {
                        const checklistState = result[keys.checklistState];
                        const uiState = result[keys.uiState];
                        const viewMode = changes[keys.viewMode].newValue || 'single';
                        updateAndBroadcast(checklistState, uiState, viewMode);
                    });
                }
            }
        });
    }

    function broadcastUpdate(state) {
        if (!port || !isConnected) return;
        const nextIndex = findNextStep(state);
        const fieldData = getFieldData(nextIndex);
        const policyNumber = getPolicyNumber();
        const checklistNames = checklist.map(item => item.name);
        const hasBackStep = canGoBack(state);
        try {
            port.postMessage({
                action: 'updateDisplay',
                fieldData: fieldData,
                index: nextIndex,
                policyNumber: policyNumber,
                checklistNames: checklistNames,
                state: state,
                canGoBack: hasBackStep
            });
        } catch (e) {
            console.error(LOG_PREFIX, "Failed to broadcast update:", e);
            handleDisconnect();
        }
    }

    function getPolicyNumber() {
        const selector = config?.policyNumber?.selector || '#PolicyNumber';
        const policyNumberElement = document.querySelector(selector);
        return policyNumberElement ? policyNumberElement.value : '';
    }

    function findNextStep(state) {
        if (!state || !Array.isArray(state)) {
            console.warn(LOG_PREFIX, "findNextStep called with invalid state:", state);
            return -1;
        }

        // First pass: find the first item that is not processed and not skipped.
        for (let i = 0; i < state.length; i++) {
            if (!state[i].processed && !state[i].skipped) {
                return i;
            }
        }
        // Second pass: if all are processed or skipped, find the first skipped item.
        for (let i = 0; i < state.length; i++) {
            if (state[i].skipped) {
                return i;
            }
        }
        return -1; // All items are processed
    }

    /**
     * Extract value from a table cell based on column type
     * @param {Element} cell - The cell element
     * @param {Object} column - Column configuration
     * @returns {any} Extracted value
     */
    function extractCellValue(cell, column) {
        if (!cell) {
            console.debug(LOG_PREFIX, `[Table] extractCellValue: cell is null for column "${column.name}"`);
            return '';
        }

        try {
            const element = cell.querySelector(column.selector);

            if (!element) {
                console.debug(LOG_PREFIX, `[Table] extractCellValue: selector "${column.selector}" not found in cell for column "${column.name}"`);
                return '';
            }

            let value = '';
            switch (column.type) {
                case 'text':
                    value = element.value || '';
                    break;
                case 'checkbox':
                    value = element.checked || false;
                    break;
                case 'select':
                    value = element.value || '';
                    break;
                case 'label':
                    if (column.extract === 'text') {
                        value = element.textContent?.trim() || '';
                    } else if (column.extract === 'innerHTML') {
                        value = element.innerHTML || '';
                    } else {
                        value = element.textContent?.trim() || '';
                    }
                    break;
                case 'kendo_widget':
                    if (typeof KendoWidgetUtils !== 'undefined' && KendoWidgetUtils.isKendoAvailable()) {
                        value = KendoWidgetUtils.getWidgetValue(element) || '';
                    } else {
                        value = element.value || '';
                    }
                    break;
                default:
                    value = element.value || element.textContent?.trim() || '';
            }

            console.debug(LOG_PREFIX, `[Table] extractCellValue: column "${column.name}" (${column.type}) = "${value}"`);
            return value;
        } catch (e) {
            console.warn(LOG_PREFIX, `[Table] Error extracting cell value for column ${column.name}:`, e);
            return '';
        }
    }

    /**
     * Check if a row has any non-empty values
     * @param {Object} rowData - Row data object
     * @returns {boolean} True if row has at least one non-empty value
     */
    function isRowFilled(rowData) {
        return Object.values(rowData).some(val => {
            if (typeof val === 'boolean') return val;
            if (typeof val === 'string') return val.trim() !== '';
            return !!val;
        });
    }

    /**
     * Extract all row data from a table
     * @param {Object} itemConfig - Table item configuration
     * @returns {Object} Table data with rows array and row count
     */
    function getTableData(itemConfig) {
        console.log(LOG_PREFIX, `[Table] getTableData called for "${itemConfig.name}"`);
        console.log(LOG_PREFIX, `[Table] Table selector: "${itemConfig.table_selector}"`);
        console.log(LOG_PREFIX, `[Table] Row selector: "${itemConfig.row_selector}"`);
        console.log(LOG_PREFIX, `[Table] Columns:`, itemConfig.columns);

        const table = document.querySelector(itemConfig.table_selector);
        if (!table) {
            console.warn(LOG_PREFIX, `[Table] Table element NOT FOUND with selector: ${itemConfig.table_selector}`);
            console.log(LOG_PREFIX, `[Table] Available tables on page:`, document.querySelectorAll('table'));
            return { rows: [], rowCount: 0 };
        }

        console.log(LOG_PREFIX, `[Table] Table element found:`, table);

        const rows = table.querySelectorAll(itemConfig.row_selector);
        console.log(LOG_PREFIX, `[Table] Found ${rows.length} rows with selector "${itemConfig.row_selector}"`);

        const data = [];

        rows.forEach((row, rowIndex) => {
            console.log(LOG_PREFIX, `[Table] Processing row ${rowIndex}:`, row);
            const rowData = {};

            itemConfig.columns.forEach((col, colIndex) => {
                console.log(LOG_PREFIX, `[Table] Processing column ${colIndex} "${col.name}" with selector "${col.selector}"`);

                // Try to find the cell element
                let cell = null;

                // First, try querySelector on the row for the column selector
                const element = row.querySelector(col.selector);
                if (element) {
                    console.log(LOG_PREFIX, `[Table] Found element directly in row for column "${col.name}":`, element);
                    // For direct element matches
                    rowData[`col${colIndex}`] = extractCellValue(row, col);
                } else {
                    console.log(LOG_PREFIX, `[Table] Element not found directly, trying cell-based approach for column "${col.name}"`);
                    // For cell-based selectors like td:nth-child(1)
                    const cells = row.querySelectorAll('td');
                    console.log(LOG_PREFIX, `[Table] Found ${cells.length} td cells in row ${rowIndex}`);

                    if (cells[colIndex]) {
                        cell = cells[colIndex];
                        console.log(LOG_PREFIX, `[Table] Using cell at index ${colIndex}:`, cell);
                        const cellElement = cell.querySelector(col.selector) || cell;
                        console.log(LOG_PREFIX, `[Table] Cell element for extraction:`, cellElement);

                        if (col.type === 'label') {
                            rowData[`col${colIndex}`] = col.extract === 'text'
                                ? cellElement.textContent?.trim() || ''
                                : cellElement.innerHTML || '';
                            console.log(LOG_PREFIX, `[Table] Extracted label value: "${rowData[`col${colIndex}`]}"`);
                        } else if (col.type === 'checkbox') {
                            const checkbox = cell.querySelector('input[type="checkbox"]');
                            rowData[`col${colIndex}`] = checkbox ? checkbox.checked : false;
                            console.log(LOG_PREFIX, `[Table] Extracted checkbox value: ${rowData[`col${colIndex}`]}`);
                        } else {
                            rowData[`col${colIndex}`] = cellElement.value || cellElement.textContent?.trim() || '';
                            console.log(LOG_PREFIX, `[Table] Extracted text value: "${rowData[`col${colIndex}`]}"`);
                        }
                    } else {
                        console.log(LOG_PREFIX, `[Table] No cell found at index ${colIndex} for column "${col.name}"`);
                        rowData[`col${colIndex}`] = '';
                    }
                }
            });

            console.log(LOG_PREFIX, `[Table] Row ${rowIndex} data:`, rowData);
            console.log(LOG_PREFIX, `[Table] Row ${rowIndex} is filled:`, isRowFilled(rowData));

            // Always include all rows (even empty ones) to show table structure
            data.push(rowData);
            console.log(LOG_PREFIX, `[Table] Row ${rowIndex} ADDED to data (filled: ${isRowFilled(rowData)})`);
        });

        console.log(LOG_PREFIX, `[Table] Final table data for "${itemConfig.name}":`, { rows: data, rowCount: data.length });
        return { rows: data, rowCount: data.length };
    }

    /**
     * Watch for row changes in dynamic tables using MutationObserver
     * @param {Object} itemConfig - Table item configuration
     * @param {number} itemIndex - Index of the item in checklist
     */
    function setupTableWatcher(itemConfig, itemIndex) {
        if (!itemConfig.dynamic) return;

        const table = document.querySelector(itemConfig.table_selector);
        if (!table) {
            console.warn(LOG_PREFIX, `Cannot watch table - not found: ${itemConfig.table_selector}`);
            return;
        }

        const tbody = table.querySelector('tbody') || table;

        const observer = new MutationObserver((mutations) => {
            // Check if rows were added or removed
            const hasStructureChange = mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0);

            if (hasStructureChange) {
                console.log(LOG_PREFIX, `[Table] Structure change detected in "${itemConfig.name}" - reattaching listeners`);
                // Reattach listeners to new rows
                attachTableInputListeners(itemConfig, itemIndex);
            }

            const newData = getTableData(itemConfig);
            updateTableState(itemIndex, newData);
        });

        observer.observe(tbody, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['value', 'checked']
        });

        console.log(LOG_PREFIX, `Table watcher initialized for: ${itemConfig.name}`);
    }

    /**
     * Initialize watchers for all dynamic tables in the checklist
     */
    function initializeTableWatchers() {
        checklist.forEach((item, index) => {
            if (item.type === 'table') {
                if (item.dynamic) {
                    setupTableWatcher(item, index);
                }
                // Also attach input listeners for real-time sync
                attachTableInputListeners(item, index);
            }
        });
    }

    /**
     * Attach event listeners to table cell inputs in the UI (bidirectional sync)
     * @param {number} itemIndex - Index of the table item
     */
    function attachTableCellInputListeners(itemIndex) {
        const step = checklist[itemIndex];
        if (step.type !== 'table') return;

        console.log(LOG_PREFIX, `[Table] Attaching UI cell input listeners for "${step.name}"`);

        const table = document.querySelector(step.table_selector);
        if (!table) {
            console.warn(LOG_PREFIX, `[Table] Cannot find table for syncing: ${step.table_selector}`);
            return;
        }

        const rows = table.querySelectorAll(step.row_selector);
        const cellInputs = document.querySelectorAll('.table-cell-input');

        cellInputs.forEach(input => {
            const rowIndex = parseInt(input.getAttribute('data-row'), 10);
            const colIndex = parseInt(input.getAttribute('data-col'), 10);
            const col = step.columns[colIndex];

            if (!col || rowIndex >= rows.length) return;

            const row = rows[rowIndex];
            const formElement = row.querySelector(col.selector);

            if (!formElement) {
                console.warn(LOG_PREFIX, `[Table] Form element not found for row ${rowIndex}, col ${colIndex}`);
                return;
            }

            const eventType = (col.type === 'checkbox' || col.type === 'select') ? 'change' : 'input';

            // Sync from UI input to form input
            input.addEventListener(eventType, () => {
                if (isInitializing) return;

                const newValue = input.type === 'checkbox' ? input.checked : input.value;
                console.log(LOG_PREFIX, `[Table] UI input changed - syncing to form: row ${rowIndex}, col "${col.name}" = "${newValue}"`);

                // Update the actual form element
                if (formElement.type === 'checkbox') {
                    formElement.checked = newValue;
                } else {
                    formElement.value = newValue;
                }

                // Trigger change event on form element to ensure any form logic runs
                formElement.dispatchEvent(new Event(eventType, { bubbles: true }));

                // Update table state and broadcast to popout
                const tableData = getTableData(step);
                const tableStateKey = `tableState_${myTabId}_${itemIndex}`;

                ext.storage.local.set({ [tableStateKey]: tableData }, () => {
                    const keys = getStorageKeys();
                    ext.storage.local.get(keys.checklistState, (result) => {
                        broadcastUpdate(result[keys.checklistState]);
                    });
                });
            });
        });

        console.log(LOG_PREFIX, `[Table] Attached ${cellInputs.length} UI cell input listeners`);
    }

    /**
     * Attach event listeners to table inputs for real-time updates
     * @param {Object} itemConfig - Table item configuration
     * @param {number} itemIndex - Index of the item in checklist
     */
    function attachTableInputListeners(itemConfig, itemIndex) {
        console.log(LOG_PREFIX, `[Table] Attaching input listeners for "${itemConfig.name}"`);

        const table = document.querySelector(itemConfig.table_selector);
        if (!table) {
            console.warn(LOG_PREFIX, `[Table] Cannot attach listeners - table not found: ${itemConfig.table_selector}`);
            return;
        }

        const rows = table.querySelectorAll(itemConfig.row_selector);
        console.log(LOG_PREFIX, `[Table] Attaching listeners to ${rows.length} rows`);

        rows.forEach((row, rowIndex) => {
            itemConfig.columns.forEach((col, colIndex) => {
                const element = row.querySelector(col.selector);
                if (!element) return;

                const eventType = (col.type === 'checkbox' || col.type === 'select') ? 'change' : 'input';

                element.addEventListener(eventType, () => {
                    if (isInitializing) return;

                    console.log(LOG_PREFIX, `[Table] Input changed in "${itemConfig.name}" row ${rowIndex}, column "${col.name}"`);

                    // Re-extract table data and update state
                    const tableData = getTableData(itemConfig);
                    const tableStateKey = `tableState_${myTabId}_${itemIndex}`;

                    ext.storage.local.set({ [tableStateKey]: tableData }, () => {
                        // If this table is currently displayed, update the UI
                        if (currentIndex === itemIndex) {
                            const fieldData = getFieldData(itemIndex);
                            const keys = getStorageKeys();
                            ext.storage.local.get(keys.checklistState, (result) => {
                                updateOnPageUIValues(fieldData);
                                broadcastUpdate(result[keys.checklistState]);
                            });
                        }
                    });
                });
            });
        });

        console.log(LOG_PREFIX, `[Table] Input listeners attached for "${itemConfig.name}"`);
    }

    /**
     * Update table state in storage
     * @param {number} itemIndex - Index of the table item
     * @param {Object} tableData - New table data
     */
    function updateTableState(itemIndex, tableData) {
        const keys = getStorageKeys();
        const tableStateKey = `tableState_${myTabId}_${itemIndex}`;

        ext.storage.local.get([tableStateKey, keys.checklistState], (result) => {
            const currentState = result[tableStateKey];
            const newStateStr = JSON.stringify(tableData);
            const currentStateStr = JSON.stringify(currentState);

            if (newStateStr !== currentStateStr) {
                console.log(LOG_PREFIX, `[Table] updateTableState: Table data changed for item ${itemIndex}`);

                ext.storage.local.set({ [tableStateKey]: tableData }, () => {
                    // Trigger UI update if this table is currently displayed
                    if (currentIndex === itemIndex) {
                        console.log(LOG_PREFIX, `[Table] updateTableState: Updating UI for currently displayed table`);
                        const fieldData = getFieldData(itemIndex);
                        updateOnPageUIValues(fieldData);
                        broadcastUpdate(result[keys.checklistState]);
                    }
                });
            }
        });
    }

    function getFieldData(index) {
        if (index === -1) return null;
        const step = checklist[index];
        const fieldData = { name: step.name, type: step.type, fields: [] };
        if (step.type === 'group') {
            fieldData.fields = step.fields.map(field => {
                const element = document.querySelector(field.selector);
                const individualFieldData = { name: field.name, type: field.type, value: '', options: [] };
                if (element) {
                    if (field.type === 'select' || field.type === 'radio') {
                        individualFieldData.value = element.value;
                        if (element.options) {
                            individualFieldData.options = Array.from(element.options).map(opt => ({ text: opt.text, value: opt.value }));
                        }
                    } else if (field.type === 'checkbox') {
                        individualFieldData.value = element.checked;
                    } else if (field.type === 'virtual') {
                        individualFieldData.value = element.innerText;
                    } else if (field.type === 'labelWithDivText') {
                        individualFieldData.labelText = element.textContent;
                        if (field.divSelector) {
                            const divEl = document.querySelector(field.divSelector);
                            let nextWord = '';
                            if (divEl) {
                                let next = divEl.nextSibling;
                                // Skip empty text nodes
                                while (next && next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) {
                                    next = next.nextSibling;
                                }
                                if (next && next.nodeType === Node.TEXT_NODE) {
                                    // Get only the first word (Yes/No)
                                    const match = next.textContent.trim().match(/^(\w+)/);
                                    nextWord = match ? match[1] : '';
                                }
                            }
                            individualFieldData.divText = nextWord;
                        } else {
                            individualFieldData.divText = '';
                        }
                    } else if (field.type === 'kendo_widget') {
                        // Extract value from Kendo widget
                        if (typeof KendoWidgetUtils !== 'undefined' && KendoWidgetUtils.isKendoAvailable()) {
                            individualFieldData.value = KendoWidgetUtils.getWidgetValue(element) || '';
                        } else {
                            // Fallback to element value
                            individualFieldData.value = element.value || '';
                        }
                        individualFieldData.selector = field.selector;
                    } else {
                        individualFieldData.value = element.value;
                    }
                } else { individualFieldData.name = `(Not Found) ${field.name}`; }
                return individualFieldData;
            });
        } else if (step.type === 'virtual') {
            fieldData.name = step.name;
        } else if (step.type === 'table') {
            console.log(LOG_PREFIX, `[Table] getFieldData: Processing table type for "${step.name}"`);
            // Get table data from storage or extract fresh
            const tableStateKey = `tableState_${myTabId}_${index}`;
            const tableData = getTableData(step);

            console.log(LOG_PREFIX, `[Table] getFieldData: Extracted table data:`, tableData);

            // Store in storage for future use
            ext.storage.local.set({ [tableStateKey]: tableData });

            fieldData.tableData = tableData;
            fieldData.columns = step.columns;
            fieldData.dynamic = step.dynamic || false;

            console.log(LOG_PREFIX, `[Table] getFieldData: Final fieldData for table:`, fieldData);
        } else if (step.type === 'custom') {
            try {
                // Handle fees table specifically
                if (step.table_id === 'feesTable') {
                    const tableSelector = 'div.col-md-7:nth-child(2) > div:nth-child(1) > table:nth-child(1)';
                    const table = document.querySelector(tableSelector);

                    if (table) {
                        const rows = table.querySelectorAll('tbody tr');
                        const feeRows = [];

                        // Parse each fee row
                        rows.forEach((row, index) => {
                            const cells = row.querySelectorAll('td');
                            if (cells.length >= 3) {
                                let feeName = '';

                                // Extract fee name
                                if (index === 3) {
                                    // OTHER FEE row - check for custom name
                                    const customNameInput = row.querySelector('#TransactionFees_3__OtherFeeType');
                                    const customName = customNameInput ? customNameInput.value.trim() : '';
                                    feeName = customName || 'OTHER FEE';
                                } else {
                                    // Regular fee rows - get static name
                                    const firstCell = cells[0];
                                    const textNodes = Array.from(firstCell.childNodes)
                                        .filter(node => node.nodeType === Node.TEXT_NODE)
                                        .map(node => node.textContent.trim())
                                        .filter(text => text.length > 0);
                                    feeName = textNodes[0] || '';
                                }

                                // Extract taxable checkbox
                                const taxableCheckbox = cells[1].querySelector('input[type="checkbox"]');
                                const isTaxable = taxableCheckbox ? taxableCheckbox.checked : false;

                                // Extract fee amount - try Kendo widget first, then visible input
                                const feeAmountCell = cells[2];
                                const kendoInput = feeAmountCell.querySelector('.k-formatted-value');
                                const hiddenInput = feeAmountCell.querySelector('input[id*="FeeAmount"]');
                                let feeAmount = '';

                                if (kendoInput) {
                                    feeAmount = kendoInput.value || kendoInput.textContent.trim() || '$0.00';
                                } else if (hiddenInput) {
                                    feeAmount = hiddenInput.value || '0';
                                    // Format as currency if it's a number
                                    if (!isNaN(parseFloat(feeAmount))) {
                                        feeAmount = `$${parseFloat(feeAmount).toFixed(2)}`;
                                    }
                                } else {
                                    feeAmount = '$0.00';
                                }

                                feeRows.push({
                                    index: index,
                                    name: feeName,
                                    taxable: isTaxable,
                                    amount: feeAmount,
                                    taxableCheckboxId: taxableCheckbox?.id || '',
                                    amountInputId: hiddenInput?.id || ''
                                });
                            }
                        });

                        fieldData.feeRows = feeRows;

                        // Extract summary values
                        const totalFeesEl = document.querySelector('#totalFees');
                        const taxablePremiumEl = document.querySelector('#taxablePremium');
                        const caStateTaxEl = document.querySelector('#caStateTax');
                        const estimatedStampingFeePctEl = document.querySelector('#estimatedStampingFeePct');
                        const estimatedStampingFeeEl = document.querySelector('#estimatedStampingFee');
                        const highPremiumWarningEl = document.querySelector('#highPremiumWarning');

                        fieldData.summary = {
                            totalFees: totalFeesEl ? totalFeesEl.textContent.trim() : '$0.00',
                            taxablePremium: taxablePremiumEl ? taxablePremiumEl.textContent.trim() : '$0.00',
                            caStateTax: caStateTaxEl ? caStateTaxEl.textContent.trim() : '$0.00',
                            estimatedStampingFeeLabel: estimatedStampingFeePctEl ? estimatedStampingFeePctEl.textContent.trim() : 'Estimated Stamping Fee:',
                            estimatedStampingFee: estimatedStampingFeeEl ? estimatedStampingFeeEl.textContent.trim() : '$0.00',
                            showHighPremiumWarning: highPremiumWarningEl ?
                                window.getComputedStyle(highPremiumWarningEl).display !== 'none' : false
                        };
                    } else {
                        fieldData.feeRows = [];
                        fieldData.summary = null;
                    }
                } else {
                    // Generic custom table handling (fallback)
                    const table = document.getElementById(step.table_id);
                    if (table) {
                        // Custom logic to parse the table
                        fieldData.fields = Array.from(table.querySelectorAll('tbody tr')).map(row => {
                            const cells = row.querySelectorAll('td');
                            const rowData = {};
                            // This is a placeholder. The actual implementation will depend on the table structure.
                            rowData.name = cells[0]?.innerText || 'Unknown';
                            rowData.value = cells[1]?.innerText || '';
                            return rowData;
                        });
                    }
                }
            } catch (e) {
                console.error(LOG_PREFIX, `Error parsing custom table ${step.table_id}:`, e);
                fieldData.fields = fieldData.fields || [];
                fieldData.fields.push({ name: `Error parsing ${step.name}`, type: 'error', value: '' });
            }
        }
        return fieldData;
    }

    function updateAndBroadcast(state, uiState, viewMode, skipTrackingUpdate = false) {
        viewMode = viewMode || 'single';
        const nextIndex = findNextStep(state);
        const fieldData = getFieldData(nextIndex);
        // Always re-render to ensure view mode switches properly
        currentIndex = nextIndex;
        renderOnPageUI(fieldData, state, uiState, viewMode);
        broadcastUpdate(state);
        updateItemVisuals(state);

        // Update tracking progress and metadata
        // Skip if this is our own storage update (tracking was already updated before save)
        if (window.trackingHelper && !skipTrackingUpdate) {
            if (window.trackingHelper.updateProgress && state && Array.isArray(state)) {
                const checkedCount = state.filter(item => item.processed).length;
                const total = state.length;
                const isReview = window.trackingHelper.isReviewMode || false;
                console.log("[ProcessingChecklist] Calling updateProgress:", checkedCount, "/", total, "isReview:", isReview);
                window.trackingHelper.updateProgress(checkedCount, total, isReview);
            }

            // Update metadata (policy number, primary insured, premium)
            if (window.trackingHelper.updateMetadata) {
                window.trackingHelper.updateMetadata();
            }

            // Detect and store field changes
            const isReview = window.trackingHelper.isReviewMode || false;
            detectAllChanges(isReview);
        } else if (skipTrackingUpdate) {
            console.log("[ProcessingChecklist] Skipping tracking update - already called before storage save");
        }
    }

    function updateOnPageUIValues(fieldData) {
        if (!fieldData) return;

        // Handle table type - update values without re-rendering to preserve focus
        if (fieldData.type === 'table') {
            console.log(LOG_PREFIX, `[Table] updateOnPageUIValues: Updating table values for "${fieldData.name}"`);

            // Update existing input values without re-rendering
            const cellInputs = document.querySelectorAll('.table-cell-input');
            cellInputs.forEach(input => {
                const rowIndex = parseInt(input.getAttribute('data-row'), 10);
                const colIndex = parseInt(input.getAttribute('data-col'), 10);
                const value = fieldData.tableData.rows[rowIndex]?.[`col${colIndex}`];

                if (value !== undefined) {
                    if (input.type === 'checkbox') {
                        if (input.checked !== value) input.checked = value;
                    } else {
                        // Only update if different and not currently focused (to preserve typing)
                        if (input !== document.activeElement && input.value !== value) {
                            input.value = value;
                        }
                    }
                }
            });
            return;
        }

        // Handle regular fields
        if (!fieldData.fields) return;
        fieldData.fields.forEach((field, index) => {
            const inputElement = document.querySelector(`.on-page-input[data-field-index="${index}"]`);
            if (inputElement) {
                if (inputElement.type === 'checkbox' || inputElement.type === 'radio') {
                    if (inputElement.checked !== field.value) inputElement.checked = field.value;
                } else {
                    if (inputElement.value !== field.value) inputElement.value = field.value;
                }
            }
        });
    }

    // MutationObserver for fees table summary
    let feesTableSummaryObserver = null;

    /**
     * Start observing fees table summary values for changes
     * @param {number} itemIndex - Index of the fees table item
     */
    function startFeesTableSummaryObserver(itemIndex) {
        // Stop any existing observer
        if (feesTableSummaryObserver) {
            feesTableSummaryObserver.disconnect();
        }

        // Find all summary elements
        const totalFeesEl = document.querySelector('#totalFees');
        const taxablePremiumEl = document.querySelector('#taxablePremium');
        const caStateTaxEl = document.querySelector('#caStateTax');
        const estimatedStampingFeeEl = document.querySelector('#estimatedStampingFee');
        const highPremiumWarningEl = document.querySelector('#highPremiumWarning');

        const elementsToObserve = [totalFeesEl, taxablePremiumEl, caStateTaxEl, estimatedStampingFeeEl, highPremiumWarningEl].filter(el => el);

        if (elementsToObserve.length === 0) {
            console.warn(LOG_PREFIX, '[Fees] No summary elements found to observe');
            return;
        }

        feesTableSummaryObserver = new MutationObserver(() => {
            if (isInitializing) return;
            // Re-extract and update UI
            updateFeesTableSummary(itemIndex);
        });

        elementsToObserve.forEach(element => {
            feesTableSummaryObserver.observe(element, {
                childList: true,
                characterData: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style'] // For highPremiumWarning display changes
            });
        });

        console.log(LOG_PREFIX, `[Fees] Started observing ${elementsToObserve.length} summary elements`);
    }

    /**
     * Update fees table summary display in UI
     * @param {number} itemIndex - Index of the fees table item
     */
    function updateFeesTableSummary(itemIndex) {
        if (currentIndex !== itemIndex) return;

        const totalFeesEl = document.querySelector('#totalFees');
        const taxablePremiumEl = document.querySelector('#taxablePremium');
        const caStateTaxEl = document.querySelector('#caStateTax');
        const estimatedStampingFeePctEl = document.querySelector('#estimatedStampingFeePct');
        const estimatedStampingFeeEl = document.querySelector('#estimatedStampingFee');
        const highPremiumWarningEl = document.querySelector('#highPremiumWarning');

        // Update UI summary elements
        const uiTotalFees = document.querySelector('.fees-summary [data-summary-type="totalFees"]');
        const uiTaxablePremium = document.querySelector('.fees-summary [data-summary-type="taxablePremium"]');
        const uiCaStateTax = document.querySelector('.fees-summary [data-summary-type="caStateTax"]');
        const uiStampingFee = document.querySelector('.fees-summary [data-summary-type="estimatedStampingFee"]');
        const uiWarningRow = document.querySelector('.fees-summary .warning-row');

        if (uiTotalFees && totalFeesEl) {
            uiTotalFees.textContent = totalFeesEl.textContent.trim();
        }
        if (uiTaxablePremium && taxablePremiumEl) {
            uiTaxablePremium.textContent = taxablePremiumEl.textContent.trim();
        }
        if (uiCaStateTax && caStateTaxEl) {
            uiCaStateTax.textContent = caStateTaxEl.textContent.trim();
        }
        if (uiStampingFee && estimatedStampingFeeEl) {
            uiStampingFee.textContent = estimatedStampingFeeEl.textContent.trim();
        }

        // Handle warning visibility
        if (uiWarningRow && highPremiumWarningEl) {
            const isVisible = window.getComputedStyle(highPremiumWarningEl).display !== 'none';
            uiWarningRow.style.display = isVisible ? 'flex' : 'none';
        }
    }

    /**
     * Attach event listeners to fees table inputs for bidirectional sync
     * @param {number} itemIndex - Index of the fees table item
     */
    function attachFeesTableListeners(itemIndex) {
        console.log(LOG_PREFIX, `[Fees] Attaching listeners for fees table`);

        const tableSelector = 'div.col-md-7:nth-child(2) > div:nth-child(1) > table:nth-child(1)';
        const formTable = document.querySelector(tableSelector);

        if (!formTable) {
            console.warn(LOG_PREFIX, '[Fees] Form table not found');
            return;
        }

        // Attach listeners to UI inputs for syncing TO the form
        const uiTaxableInputs = document.querySelectorAll('.fee-input-taxable');
        const uiAmountInputs = document.querySelectorAll('.fee-input-amount');

        uiTaxableInputs.forEach(input => {
            const checkboxId = input.getAttribute('data-taxable-checkbox-id');
            const formCheckbox = document.querySelector(`#${checkboxId}`);

            if (!formCheckbox) {
                console.warn(LOG_PREFIX, `[Fees] Form checkbox not found: ${checkboxId}`);
                return;
            }

            // Sync from UI to form
            input.addEventListener('change', () => {
                if (isInitializing || isProgrammaticUpdate) return;
                console.log(LOG_PREFIX, `[Fees] UI taxable checkbox changed: ${checkboxId} = ${input.checked}`);
                formCheckbox.checked = input.checked;
                formCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            });

            // Sync from form to UI
            formCheckbox.addEventListener('change', () => {
                if (isInitializing || isProgrammaticUpdate) return;
                console.log(LOG_PREFIX, `[Fees] Form taxable checkbox changed: ${checkboxId} = ${formCheckbox.checked}`);
                if (input.checked !== formCheckbox.checked) {
                    input.checked = formCheckbox.checked;
                }
            });
        });

        uiAmountInputs.forEach(input => {
            const amountInputId = input.getAttribute('data-amount-input-id');
            const formInput = document.querySelector(`#${amountInputId}`);

            if (!formInput) {
                console.warn(LOG_PREFIX, `[Fees] Form amount input not found: ${amountInputId}`);
                return;
            }

            // Sync from UI to form (on blur and Enter key)
            const syncUIToForm = () => {
                if (isInitializing || isProgrammaticUpdate) return;
                console.log(LOG_PREFIX, `[Fees] UI amount input changed: ${amountInputId} = ${input.value}`);

                // Parse value and update hidden input
                let numericValue = input.value.replace(/[$,]/g, '');
                if (!isNaN(parseFloat(numericValue))) {
                    const parsedValue = parseFloat(numericValue);
                    formInput.value = parsedValue.toFixed(2);

                    // Try to update the Kendo widget if available
                    const feeIndex = input.getAttribute('data-fee-index');
                    const formRow = formTable.querySelectorAll('tbody tr')[feeIndex];
                    if (formRow) {
                        // Try to find and update the Kendo widget
                        if (typeof window.jQuery !== 'undefined' && typeof window.kendo !== 'undefined') {
                            const $ = window.jQuery;
                            // Method 1: Try to get widget from the hidden input with data-role
                            let kendoWidget = $(formInput).data('kendoNumericTextBox');

                            if (kendoWidget) {
                                console.log(LOG_PREFIX, `[Fees] Updating Kendo widget (method 1) to: ${parsedValue}`);
                                kendoWidget.value(parsedValue);
                            } else {
                                // Method 2: Try to find the wrapper and get widget from it
                                const kendoWrapper = formInput.closest('.k-numerictextbox');
                                if (kendoWrapper) {
                                    kendoWidget = $(kendoWrapper).data('kendoNumericTextBox');
                                    if (kendoWidget) {
                                        console.log(LOG_PREFIX, `[Fees] Updating Kendo widget (method 2) to: ${parsedValue}`);
                                        kendoWidget.value(parsedValue);
                                    }
                                }
                            }

                            if (!kendoWidget) {
                                console.warn(LOG_PREFIX, `[Fees] Kendo widget not found for ${amountInputId}, updating hidden input only`);
                            }
                        } else {
                            console.warn(LOG_PREFIX, `[Fees] jQuery or Kendo not available (jQuery: ${typeof window.jQuery}, Kendo: ${typeof window.kendo})`);
                        }
                    }
                } else {
                    formInput.value = '0';
                }

                // Trigger change event on form input
                formInput.dispatchEvent(new Event('input', { bubbles: true }));
                formInput.dispatchEvent(new Event('change', { bubbles: true }));
            };

            input.addEventListener('blur', syncUIToForm);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur(); // This will trigger the blur event
                }
            });

            // Sync from form to UI (watch the Kendo formatted value)
            const feeIndex = input.getAttribute('data-fee-index');
            const formRow = formTable.querySelectorAll('tbody tr')[feeIndex];
            if (formRow) {
                const kendoInput = formRow.querySelector('.k-formatted-value');
                if (kendoInput) {
                    // Watch for changes to the Kendo widget's formatted value
                    const observer = new MutationObserver(() => {
                        if (isInitializing || isProgrammaticUpdate) return;
                        const newValue = kendoInput.value || kendoInput.textContent?.trim() || '$0.00';
                        if (input !== document.activeElement && input.value !== newValue) {
                            console.log(LOG_PREFIX, `[Fees] Form Kendo value changed: ${amountInputId} = ${newValue}`);
                            input.value = newValue;
                        }
                    });

                    observer.observe(kendoInput, {
                        attributes: true,
                        attributeFilter: ['value'],
                        characterData: true,
                        childList: true,
                        subtree: true
                    });
                }

                // Also watch the hidden input for direct changes
                const hiddenObserver = new MutationObserver(() => {
                    if (isInitializing || isProgrammaticUpdate) return;
                    const newRawValue = formInput.value;
                    if (input !== document.activeElement && newRawValue) {
                        const formattedValue = `$${parseFloat(newRawValue).toFixed(2)}`;
                        if (input.value !== formattedValue) {
                            console.log(LOG_PREFIX, `[Fees] Form hidden input changed: ${amountInputId} = ${formattedValue}`);
                            input.value = formattedValue;
                        }
                    }
                });

                hiddenObserver.observe(formInput, {
                    attributes: true,
                    attributeFilter: ['value']
                });

                // Also listen for input events on the hidden field
                formInput.addEventListener('input', () => {
                    if (isInitializing || isProgrammaticUpdate) return;
                    const newRawValue = formInput.value;
                    if (input !== document.activeElement && newRawValue) {
                        const formattedValue = `$${parseFloat(newRawValue).toFixed(2)}`;
                        if (input.value !== formattedValue) {
                            console.log(LOG_PREFIX, `[Fees] Form hidden input event: ${amountInputId} = ${formattedValue}`);
                            input.value = formattedValue;
                        }
                    }
                });
            }
        });

        console.log(LOG_PREFIX, `[Fees] Attached listeners to ${uiTaxableInputs.length} taxable checkboxes and ${uiAmountInputs.length} amount inputs`);
    }

    /**
     * Render fees table UI for display in on-page UI or popout
     * @param {Object} fieldData - Field data containing feeRows and summary
     * @returns {string} HTML string for fees table display
     */
    function renderFeesTableUI(fieldData) {
        if (!fieldData.feeRows || fieldData.feeRows.length === 0) {
            return '<div class="table-empty">No fees data</div>';
        }

        // Build fee rows HTML
        const feeRowsHtml = fieldData.feeRows.map(fee => {
            return `
                <div class="fees-table-row">
                    <div class="fee-name">${fee.name}</div>
                    <div class="fee-taxable">
                        <input type="checkbox" ${fee.taxable ? 'checked' : ''}
                               data-fee-index="${fee.index}"
                               data-fee-type="taxable"
                               data-taxable-checkbox-id="${fee.taxableCheckboxId}"
                               class="fee-input-taxable"
                               style="cursor: pointer;">
                    </div>
                    <div class="fee-amount">
                        <input type="text"
                               value="${fee.amount}"
                               data-fee-index="${fee.index}"
                               data-fee-type="amount"
                               data-amount-input-id="${fee.amountInputId}"
                               class="fee-input-amount"
                               placeholder="$0.00">
                    </div>
                </div>
            `;
        }).join('');

        // Build summary section HTML
        let summaryHtml = '';
        if (fieldData.summary) {
            const warningHtml = fieldData.summary.showHighPremiumWarning ? `
                <div class="fees-summary-row warning-row">
                    <div class="fees-summary-label" style="color: #dc3545; font-weight: bold;">
                        The Taxable Premium exceeds $500,000. Please verify before continuing.
                    </div>
                </div>
            ` : '';

            summaryHtml = `
                <div class="fees-summary">
                    <div class="fees-summary-row">
                        <div class="fees-summary-label">Total Fees:</div>
                        <div class="fees-summary-value" data-summary-type="totalFees">${fieldData.summary.totalFees}</div>
                    </div>
                    <div class="fees-summary-row">
                        <div class="fees-summary-label">Taxable Premium (Includes Fees):</div>
                        <div class="fees-summary-value" data-summary-type="taxablePremium">${fieldData.summary.taxablePremium}</div>
                    </div>
                    ${warningHtml}
                    <div class="fees-summary-row tax-row">
                        <div class="fees-summary-label"><strong>Estimated CA SL State Tax (3%):</strong></div>
                        <div class="fees-summary-value" data-summary-type="caStateTax"><strong>${fieldData.summary.caStateTax}</strong></div>
                    </div>
                    <div class="fees-summary-row stamping-fee-row">
                        <div class="fees-summary-label"><strong>${fieldData.summary.estimatedStampingFeeLabel}</strong></div>
                        <div class="fees-summary-value" data-summary-type="estimatedStampingFee"><strong>${fieldData.summary.estimatedStampingFee}</strong></div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="fees-table-container">
                <div class="fees-table-header">
                    <div class="fee-name-header">Fee Name</div>
                    <div class="fee-taxable-header">Taxable</div>
                    <div class="fee-amount-header">Fee Amount</div>
                </div>
                ${feeRowsHtml}
                ${summaryHtml}
            </div>
        `;
    }

    /**
     * Render table UI for display in on-page UI or popout
     * @param {Object} tableData - Table data with rows and column info
     * @param {Object} itemConfig - Table item configuration
     * @returns {string} HTML string for table display
     */
    function renderTableUI(tableData, itemConfig) {
        console.log(LOG_PREFIX, `[Table] renderTableUI: called with tableData:`, tableData);
        console.log(LOG_PREFIX, `[Table] renderTableUI: itemConfig:`, itemConfig);

        if (!tableData || !tableData.rows) {
            console.log(LOG_PREFIX, `[Table] renderTableUI: No data - returning empty message`);
            return '<div class="table-empty">No data</div>';
        }

        const { rows, rowCount } = tableData;
        console.log(LOG_PREFIX, `[Table] renderTableUI: rowCount = ${rowCount}`);

        if (rowCount === 0) {
            console.log(LOG_PREFIX, `[Table] renderTableUI: Empty table - returning empty message`);
            return '<div class="table-empty">Empty table</div>';
        }

        // Build table header
        const headerHtml = itemConfig.columns
            .map(col => `<th>${col.name}</th>`)
            .join('');

        // Build table rows with editable inputs
        const rowsHtml = rows.map((row, rowIndex) => {
            const cells = itemConfig.columns.map((col, colIndex) => {
                const value = row[`col${colIndex}`];
                let cellHtml = '';

                if (col.type === 'checkbox') {
                    cellHtml = `<input type="checkbox" class="table-cell-input" data-row="${rowIndex}" data-col="${colIndex}" ${value ? 'checked' : ''} style="cursor: pointer; margin: 0;">`;
                } else if (col.type === 'select') {
                    // For selects, we'd need options - for now show as text input
                    cellHtml = `<input type="text" class="table-cell-input" data-row="${rowIndex}" data-col="${colIndex}" value="${value || ''}" placeholder="—">`;
                } else if (col.type === 'label') {
                    // Labels are read-only
                    const displayValue = value || '<span style="color: #cbd5e0; font-style: italic;">—</span>';
                    cellHtml = `<span style="font-size: 12px; padding: 6px 8px; display: block;">${displayValue}</span>`;
                } else {
                    // Text inputs
                    cellHtml = `<input type="text" class="table-cell-input" data-row="${rowIndex}" data-col="${colIndex}" value="${value || ''}" placeholder="—">`;
                }

                return `<td>${cellHtml}</td>`;
            }).join('');

            return `<tr data-row-index="${rowIndex}">${cells}</tr>`;
        }).join('');

        return `
            <div class="mini-table-container">
                <table class="mini-table">
                    <thead><tr>${headerHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    }

    function renderOnPageUI(fieldData, state, uiState, viewMode) {
        viewMode = viewMode || 'single';

        // If uiState is not provided, check if container exists and preserve its visibility
        if (!uiState) {
            const existingContainer = document.getElementById('processing-checklist-container');
            uiState = { visible: existingContainer ? (existingContainer.style.display !== 'none') : false };
        }

        let container = document.getElementById('processing-checklist-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'processing-checklist-container';
            container.style.cssText = `position: fixed !important; top: 20px !important; right: 20px !important; z-index: 10000 !important; background: white !important; border: none !important; border-radius: 16px !important; padding: 20px !important; box-shadow: 0 8px 32px rgba(0,0,0,0.12) !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; font-size: 14px !important; max-width: 350px !important; min-width: 330px !important; animation: slideInRight 0.3s ease-out !important;`;
            document.body.appendChild(container);
        }
        container.style.display = uiState.visible ? 'block' : 'none';

        if (viewMode === 'full') {
            renderFullChecklistView(container, state);
            return;
        }

        // Single-step view (existing logic)
        container.classList.remove('full-view');
        container.style.maxHeight = '';

        const isReview = window.trackingHelper && window.trackingHelper.isReviewMode;
        const modeText = isReview ? '<div style="color: #3b82f6; font-weight: bold; text-align: center; margin-bottom: 10px;">REVIEW MODE</div>' : '';

        if (!fieldData) {
            const doneText = isReview ? 'All fields reviewed!' : 'All fields checked!';
            const doneColor = isReview ? '#3b82f6' : '#28a745';
            container.innerHTML = `${modeText}<div style="color: ${doneColor}; font-weight: bold; text-align: center;">${doneText}</div>`;
            return;
        }

        // Handle table type
        if (fieldData.type === 'table') {
            console.log(LOG_PREFIX, `[Table] renderOnPageUI: Rendering table type "${fieldData.name}"`);
            console.log(LOG_PREFIX, `[Table] renderOnPageUI: Table data:`, fieldData.tableData);
            console.log(LOG_PREFIX, `[Table] renderOnPageUI: Columns:`, fieldData.columns);

            const tableHtml = renderTableUI(fieldData.tableData, { columns: fieldData.columns, dynamic: fieldData.dynamic });
            console.log(LOG_PREFIX, `[Table] renderOnPageUI: Generated HTML length:`, tableHtml.length);

            const hasBackStep = canGoBack(state);
            container.innerHTML = `
                ${modeText}
                <div class="step-title">${fieldData.name}</div>
                ${tableHtml}
                <div class="button-row">
                    <button id="back-button-page" class="back-btn" ${!hasBackStep ? 'disabled' : ''}>← Back</button>
                    <button id="skip-button-page" class="skip-btn">Skip</button>
                    <button id="confirm-button-page" class="confirm-btn">✓ Confirm</button>
                </div>`;
            document.getElementById('confirm-button-page').addEventListener('click', () => handleConfirmField(currentIndex));
            document.getElementById('skip-button-page').addEventListener('click', () => handleSkipField(currentIndex));
            if (hasBackStep) {
                document.getElementById('back-button-page').addEventListener('click', () => handleGoBackToPreviousStep());
            }

            // Attach listeners to table cell inputs for bidirectional sync
            attachTableCellInputListeners(currentIndex);
            return;
        }

        // Handle custom type (fees table)
        if (fieldData.type === 'custom' && fieldData.feeRows) {
            console.log(LOG_PREFIX, `[Custom] renderOnPageUI: Rendering fees table "${fieldData.name}"`);

            const feesTableHtml = renderFeesTableUI(fieldData);
            const hasBackStep = canGoBack(state);

            container.innerHTML = `
                ${modeText}
                <div class="step-title">${fieldData.name}</div>
                ${feesTableHtml}
                <div class="button-row">
                    <button id="back-button-page" class="back-btn" ${!hasBackStep ? 'disabled' : ''}>← Back</button>
                    <button id="skip-button-page" class="skip-btn">Skip</button>
                    <button id="confirm-button-page" class="confirm-btn">✓ Confirm</button>
                </div>`;
            document.getElementById('confirm-button-page').addEventListener('click', () => handleConfirmField(currentIndex));
            document.getElementById('skip-button-page').addEventListener('click', () => handleSkipField(currentIndex));
            if (hasBackStep) {
                document.getElementById('back-button-page').addEventListener('click', () => handleGoBackToPreviousStep());
            }

            // Attach event listeners for fees table inputs
            attachFeesTableListeners(currentIndex);

            // Start observing summary values for changes
            startFeesTableSummaryObserver(currentIndex);

            return;
        }

        let fieldsHtml = fieldData.fields.map((field, index) => {
            let inputHtml;
            if (field.type === 'select') {
                const options = field.options.map(opt => `<option value="${opt.value}" ${field.value === opt.value ? 'selected' : ''}>${opt.text}</option>`).join('');
                inputHtml = `<select class="on-page-input" data-field-index="${index}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; transition: border-color 0.2s, box-shadow 0.2s;">${options}</select>`;
                return `<div class="field-container"><label class="field-label">${field.name}</label>${inputHtml}</div>`;
            } else if (field.type === 'checkbox') {
                return `<label class="checkbox-field"><input type="checkbox" class="on-page-input" data-field-index="${index}" ${field.value ? 'checked' : ''}> <span>${field.name}</span></label>`;
            } else if (field.type === 'radio') {
                return `<label class="checkbox-field"><input type="radio" class="on-page-input" name="${fieldData.name}" data-field-index="${index}" ${field.value ? 'checked' : ''}> <span>${field.name}</span></label>`;
            } else if (field.type === 'virtual') {
                return `<div class="field-container"><label class="field-label">${field.name}:</label><span class="virtual-value">${field.value}</span></div>`;
            } else if (field.type === 'labelWithDivText') {
                return `<div class="field-container label-with-text"><label class="field-label">${field.labelText}</label><span class="virtual-value">${field.divText}</span></div>`;
            } else if (field.type === 'kendo_widget') {
                // Handle Kendo widget - will be rendered separately after HTML insertion
                return `<div class="field-container"><label class="field-label">${field.name}</label><div class="kendo-widget-placeholder" data-field-index="${index}" data-field-selector="${field.selector}"></div></div>`;
            } else {
                inputHtml = `<input type="text" class="on-page-input" data-field-index="${index}" value="${field.value || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; transition: border-color 0.2s, box-shadow 0.2s;">`;
                return `<div class="field-container"><label class="field-label">${field.name}</label>${inputHtml}</div>`;
            }
        }).join('');

        const hasBackStep = canGoBack(state);
        container.innerHTML = `
            ${modeText}
            <div class="step-title">${fieldData.name}</div>
            <div class="fields-container">${fieldsHtml}</div>
            <div class="button-row">
                <button id="back-button-page" class="back-btn" ${!hasBackStep ? 'disabled' : ''}>← Back</button>
                <button id="skip-button-page" class="skip-btn">Skip</button>
                <button id="confirm-button-page" class="confirm-btn">✓ Confirm</button>
            </div>`;
        document.getElementById('confirm-button-page').addEventListener('click', () => handleConfirmField(currentIndex));
        document.getElementById('skip-button-page').addEventListener('click', () => handleSkipField(currentIndex));
        if (hasBackStep) {
            document.getElementById('back-button-page').addEventListener('click', () => handleGoBackToPreviousStep());
        }
        document.querySelectorAll('.on-page-input').forEach(input => {
            const fieldIndex = parseInt(input.getAttribute('data-field-index'), 10);
            input.addEventListener(input.type === 'checkbox' || input.type === 'select-one' || input.type === 'radio' ? 'change' : 'input', () => {
                if (isInitializing) return;
                const value = input.type === 'checkbox' ? input.checked : input.value;
                handleUpdateFieldValue({ index: currentIndex, fieldIndex, value }, true);
            });
        });

        // Initialize Kendo widgets after HTML is inserted
        renderKendoWidgets(container, fieldData);
    }

    function renderKendoWidgets(container, fieldData) {
        const placeholders = container.querySelectorAll('.kendo-widget-placeholder');
        placeholders.forEach(placeholder => {
            const fieldIndex = parseInt(placeholder.getAttribute('data-field-index'), 10);
            const field = fieldData.fields[fieldIndex];
            const selector = field.selector;

            // Check if KendoWidgetUtils is available
            if (typeof KendoWidgetUtils === 'undefined') {
                console.warn(LOG_PREFIX, "KendoWidgetUtils not loaded - falling back to basic input");
                placeholder.innerHTML = `<input type="text" class="on-page-input" data-field-index="${fieldIndex}" value="${field.value || ''}" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">`;
                return;
            }

            // Check if Kendo is available
            if (!KendoWidgetUtils.isKendoAvailable()) {
                console.log(LOG_PREFIX, `Kendo UI not available - using fallback for field "${field.name}"`);
                placeholder.innerHTML = KendoWidgetUtils.createFallbackInput(field, field.value);
                const input = placeholder.querySelector('input');
                if (input) {
                    KendoWidgetUtils.setupFallbackSync(input, selector);
                }
                return;
            }

            // Try to detect original widget
            const widgetType = KendoWidgetUtils.detectWidgetType(document.querySelector(selector));

            if (!widgetType) {
                console.log(LOG_PREFIX, `No Kendo widget detected for "${field.name}" - using read-only display`);
                placeholder.innerHTML = KendoWidgetUtils.createReadOnlyDisplay(field, field.value);
                KendoWidgetUtils.setupFocusButtons(placeholder);
                return;
            }

            console.log(LOG_PREFIX, `Detected ${widgetType} widget for field "${field.name}"`);

            // For now, use fallback with sync (widget cloning will be added in future iteration)
            placeholder.innerHTML = KendoWidgetUtils.createFallbackInput(field, field.value);
            const input = placeholder.querySelector('input');
            if (input) {
                input.classList.add('on-page-input');
                input.setAttribute('data-field-index', fieldIndex);
                KendoWidgetUtils.setupFallbackSync(input, selector);

                // Add event listener for value changes
                input.addEventListener('change', () => {
                    if (isInitializing) return;
                    handleUpdateFieldValue({ index: currentIndex, fieldIndex, value: input.value }, true);
                });
            }
        });
    }

    function renderFullChecklistView(container, state) {
        container.classList.add('full-view');

        // Calculate max height: window height - 250px
        const maxHeight = window.innerHeight - 250;
        container.style.maxHeight = `${maxHeight}px`;

        let itemsHtml = checklist.map((item, index) => {
            const itemState = state[index];
            let statusClass = '';
            if (itemState.processed) {
                statusClass = 'confirmed';
            } else if (itemState.skipped) {
                statusClass = 'skipped';
            }

            return `
                <div class="full-checklist-item ${statusClass}" data-item-index="${index}">
                    <input type="checkbox" class="full-checklist-item-checkbox" data-item-index="${index}" ${itemState.processed ? 'checked' : ''}>
                    <span class="full-checklist-item-name">${item.name}</span>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="step-title">Checklist Progress</div>
            <div style="display: flex; flex-direction: column;">${itemsHtml}</div>
        `;

        // Attach event listeners to checkboxes
        container.querySelectorAll('.full-checklist-item-checkbox').forEach(checkbox => {
            const itemIndex = parseInt(checkbox.getAttribute('data-item-index'), 10);
            checkbox.addEventListener('change', () => {
                if (isInitializing || isProgrammaticUpdate) return;
                if (checkbox.checked) {
                    handleConfirmField(itemIndex);
                } else {
                    unconfirmField(itemIndex);
                }
            });
        });

        // Update max height on window resize
        window.addEventListener('resize', () => {
            const keys = getStorageKeys();
            ext.storage.local.get([keys.viewMode, keys.uiState], (result) => {
                if (result[keys.viewMode] === 'full' && result[keys.uiState]?.visible) {
                    const newMaxHeight = window.innerHeight - 250;
                    container.style.maxHeight = `${newMaxHeight}px`;
                }
            });
        });
    }

    function handleMessage(message) {
        switch (message.action) {
            case 'init':
                myTabId = message.tabId;
                console.log(LOG_PREFIX, `Received tab ID: ${myTabId}`);

                // Check if this is a reconnection (UI elements might already exist in DOM)
                const floatingUI = document.getElementById('processing-checklist-floating-ui');
                const isReconnection = floatingUI !== null;

                if (isReconnection) {
                    console.log(LOG_PREFIX, "Detected reconnection - checking for missing UI elements");
                    // This is a reconnection after script reload - restore missing elements
                    initializeAfterReconnection();
                } else {
                    // Normal first-time initialization
                    initializeWithTabId();
                }
                break;
            case 'popout-ready':
                const keys = getStorageKeys();
                ext.storage.local.get(keys.checklistState, r => broadcastUpdate(r[keys.checklistState]));
                break;
            case 'updateFieldValue': handleUpdateFieldValue(message, false); break;
            case 'updateTableCell': handleUpdateTableCell(message); break;
            case 'updateFeeTaxable': handleUpdateFeeTaxable(message); break;
            case 'updateFeeAmount': handleUpdateFeeAmount(message); break;
            case 'confirmField': handleConfirmField(message.index); break;
            case 'skipField': handleSkipField(message.index); break;
            case 'getPolicyNumber': handleGetPolicyNumber(); break;
            case 'goBackToPreviousStep': handleGoBackToPreviousStep(); break;
            case 'toggleUI': toggleOnPageUI(); break;
            case 'changeViewMode':
                // View mode changed from menu - update storage
                if (message.mode) {
                    const keys = getStorageKeys();
                    ext.storage.local.set({ [keys.viewMode]: message.mode });
                }
                break;
            case 'start-review':
                // Enter review mode for this form
                if (window.trackingHelper && window.trackingHelper.enterReviewMode) {
                    window.trackingHelper.enterReviewMode();
                    window.trackingHelper.applyReviewStyling();

                    const keys = getStorageKeys();
                    const urlId = window.trackingHelper.currentUrlId;

                    // Load reviewedProgress from tracking history to initialize checkboxes
                    ext.storage.local.get('tracking_history', (storageResult) => {
                        const history = storageResult.tracking_history || [];
                        const formInHistory = history.find(h => h.urlId === urlId);

                        let reviewState;

                        if (formInHistory && formInHistory.reviewedProgress && formInHistory.reviewedProgress.current > 0) {
                            // Load saved reviewed state from history
                            // Convert progress object to checkbox state array
                            // Since we don't store which specific items were reviewed, start fresh
                            // The reviewedProgress tracks overall count, not individual items
                            reviewState = checklist.map(() => ({ processed: false, skipped: false }));
                            console.log(LOG_PREFIX, "Review mode activated - starting fresh (reviewedProgress: " +
                                       formInHistory.reviewedProgress.current + "/" + formInHistory.reviewedProgress.total + ")");
                        } else {
                            // No previous review progress - start with all unchecked
                            reviewState = checklist.map(() => ({ processed: false, skipped: false }));
                            console.log(LOG_PREFIX, "Review mode activated - no previous review progress, starting fresh");
                        }

                        ext.storage.local.set({ [keys.reviewState]: reviewState }, () => {
                            // Re-render UI with review state
                            ext.storage.local.get([keys.uiState, keys.viewMode], (result) => {
                                updateAndBroadcast(reviewState, result[keys.uiState], result[keys.viewMode]);
                                // Update visuals to show review state (all unchecked initially)
                                updateItemVisuals(reviewState);
                            });
                        });
                    });
                }
                break;
        }
    }

    function handleUpdateTableCell({ index, rowIndex, colIndex, value }) {
        const step = checklist[index];
        if (!step || step.type !== 'table') return;

        const table = document.querySelector(step.table_selector);
        if (!table) return;

        const rows = table.querySelectorAll(step.row_selector);
        if (rowIndex >= rows.length) return;

        const row = rows[rowIndex];
        const col = step.columns[colIndex];
        if (!col) return;

        const formElement = row.querySelector(col.selector);
        if (!formElement) return;

        // Update the form element
        if (formElement.type === 'checkbox') {
            formElement.checked = value;
        } else {
            formElement.value = value;
        }

        // Trigger change event
        const eventType = (col.type === 'checkbox' || col.type === 'select') ? 'change' : 'input';
        formElement.dispatchEvent(new Event(eventType, { bubbles: true }));
    }

    function handleUpdateFeeTaxable({ checkboxId, value }) {
        console.log(LOG_PREFIX, `[Fees] Popout updating taxable: ${checkboxId} = ${value}`);
        const checkbox = document.querySelector(`#${checkboxId}`);
        if (checkbox) {
            checkbox.checked = value;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function handleUpdateFeeAmount({ amountInputId, value }) {
        console.log(LOG_PREFIX, `[Fees] Popout updating amount: ${amountInputId} = ${value}`);
        const formInput = document.querySelector(`#${amountInputId}`);
        if (formInput) {
            // Parse value and update hidden input
            let numericValue = value.replace(/[$,]/g, '');
            if (!isNaN(parseFloat(numericValue))) {
                const parsedValue = parseFloat(numericValue);
                formInput.value = parsedValue.toFixed(2);

                // Try to update the Kendo widget if available
                if (typeof window.jQuery !== 'undefined' && typeof window.kendo !== 'undefined') {
                    const $ = window.jQuery;
                    let kendoWidget = $(formInput).data('kendoNumericTextBox');

                    if (kendoWidget) {
                        console.log(LOG_PREFIX, `[Fees] Updating Kendo widget from popout: ${parsedValue}`);
                        kendoWidget.value(parsedValue);
                    } else {
                        const kendoWrapper = formInput.closest('.k-numerictextbox');
                        if (kendoWrapper) {
                            kendoWidget = $(kendoWrapper).data('kendoNumericTextBox');
                            if (kendoWidget) {
                                console.log(LOG_PREFIX, `[Fees] Updating Kendo widget from popout (method 2): ${parsedValue}`);
                                kendoWidget.value(parsedValue);
                            }
                        }
                    }
                }
            } else {
                formInput.value = '0';
            }

            // Trigger change event
            formInput.dispatchEvent(new Event('input', { bubbles: true }));
            formInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function handleGetPolicyNumber() {
        const policyNumber = getPolicyNumber();
        console.log(LOG_PREFIX, `[Policy Number] Sending to popout: ${policyNumber}`);
        port.postMessage({
            action: 'updatePolicyNumber',
            policyNumber: policyNumber
        });
    }

    function canGoBack(state) {
        if (!state) return false;

        // Find the current step (first unprocessed/unskipped)
        let currentStep = -1;
        for (let i = 0; i < state.length; i++) {
            if (!state[i].processed && !state[i].skipped) {
                currentStep = i;
                break;
            }
        }

        // Find if there's a previous processed step (not skipped) before current
        const searchLimit = currentStep >= 0 ? currentStep : state.length;
        for (let i = searchLimit - 1; i >= 0; i--) {
            if (state[i].processed && !state[i].skipped) {
                return true;
            }
        }

        return false;
    }

    function handleGoBackToPreviousStep() {
        const keys = getStorageKeys();
        ext.storage.local.get(keys.checklistState, (result) => {
            const state = result[keys.checklistState];
            if (!state) return;

            // Find the current step (first unprocessed/unskipped)
            let currentStep = -1;
            for (let i = 0; i < state.length; i++) {
                if (!state[i].processed && !state[i].skipped) {
                    currentStep = i;
                    break;
                }
            }

            // Find the previous processed step (not skipped) before current
            let previousIndex = -1;
            const searchLimit = currentStep >= 0 ? currentStep : state.length;
            for (let i = searchLimit - 1; i >= 0; i--) {
                if (state[i].processed && !state[i].skipped) {
                    previousIndex = i;
                    break;
                }
            }

            if (previousIndex === -1) {
                console.log(LOG_PREFIX, '[Back] No previous processed step to go back to');
                return;
            }

            console.log(LOG_PREFIX, `[Back] Going back to step ${previousIndex}`);

            // Uncheck the previous step
            const newState = [...state];
            newState[previousIndex] = { processed: false, skipped: false };

            // Save and broadcast
            ext.storage.local.set({ [keys.checklistState]: newState }, () => {
                broadcastUpdate(newState);
            });
        });
    }

    function toggleOnPageUI() {
        const keys = getStorageKeys();
        ext.storage.local.get(keys.uiState, (result) => {
            const uiState = result[keys.uiState];
            uiState.visible = !uiState.visible;
            ext.storage.local.set({ [keys.uiState]: uiState });
        });
    }

    function handleUpdateFieldValue({ index, fieldIndex, value }, fromOnPageUI = false) {
        const field = checklist[index]?.fields[fieldIndex];
        if (!field || !field.selector) return;
        const element = document.querySelector(field.selector);
        if (element) {
            if (element.type === 'checkbox' || element.type === 'radio') element.checked = value; else element.value = value;
            if (!fromOnPageUI) {
                const onPageInputElement = document.querySelector(`.on-page-input[data-field-index="${fieldIndex}"]`);
                if(onPageInputElement) onPageInputElement.value = value;
            }
            const keys = getStorageKeys();
            ext.storage.local.get(keys.checklistState, r => broadcastUpdate(r[keys.checklistState]));
        }
    }

    function updateState(index, processed, skipped) {
        const keys = getStorageKeys();
        const isReview = window.trackingHelper && window.trackingHelper.isReviewMode;
        const stateKey = isReview ? keys.reviewState : keys.checklistState;

        console.log(LOG_PREFIX, `updateState called: index=${index}, processed=${processed}, skipped=${skipped}, isReview=${isReview}, stateKey=${stateKey}`);

        // OPTIMIZATION: Apply immediate visual feedback before storage round-trip
        // This makes checkboxes feel instantly responsive
        const itemState = { processed, skipped };
        const tempState = [...(window.currentChecklistState || [])];
        if (tempState[index]) {
            tempState[index] = itemState;
            // Update visuals immediately with temporary state
            updateItemVisualsForSingleItem(index, itemState, isReview);
        }

        ext.storage.local.get([stateKey, keys.uiState, keys.viewMode], (result) => {
            let currentState = result[stateKey];

            console.log(LOG_PREFIX, `Current state from storage:`, currentState);

            // If review state doesn't exist yet, initialize it
            if (!currentState && isReview) {
                console.warn(LOG_PREFIX, "Review state not found, initializing...");
                currentState = checklist.map(() => ({ processed: false, skipped: false }));
            }

            // If state still doesn't exist, log error and return
            if (!currentState) {
                console.error(LOG_PREFIX, `State ${stateKey} not found and could not be initialized`);
                return;
            }

            const newState = [...currentState];
            newState[index] = { processed, skipped };

            // Cache the state for immediate visual updates
            window.currentChecklistState = newState;

            console.log(LOG_PREFIX, `Saving new state to ${stateKey}:`, newState);

            // Update tracking progress BEFORE saving to storage
            // This ensures the correct value is saved and prevents race conditions
            if (window.trackingHelper && window.trackingHelper.updateProgress) {
                const checkedCount = newState.filter(item => item.processed).length;
                const total = newState.length;
                const isReview = window.trackingHelper.isReviewMode || false;
                console.log(LOG_PREFIX, `Calling updateProgress from updateState: ${checkedCount}/${total}, isReview=${isReview}`);
                window.trackingHelper.updateProgress(checkedCount, total, isReview);
            }

            // Set flag to indicate this is our own storage update
            // (so storage change handler won't call full updateAndBroadcast again)
            isOwnStorageUpdate = true;
            ext.storage.local.set({ [stateKey]: newState }, () => {
                // Only broadcast to other components (popout), don't re-render this page
                broadcastUpdate(newState);

                // Update next field indicator without full re-render
                const nextIndex = findNextStep(newState);
                const fieldData = getFieldData(nextIndex);
                currentIndex = nextIndex;
                renderOnPageUI(fieldData, newState, result[keys.uiState], result[keys.viewMode]);

                // Clear flag after a short delay to allow storage change event to fire
                setTimeout(() => {
                    isOwnStorageUpdate = false;
                }, 100);
            });
        });
    }

    function handleConfirmField(index) {
        if (index < 0 || index >= checklist.length) return;
        updateState(index, true, false);
    }

    function handleSkipField(index) {
        if (index < 0 || index >= checklist.length) return;
        updateState(index, false, true);
    }

    function unconfirmField(index) {
        if (index < 0 || index >= checklist.length) return;
        updateState(index, false, false);
    }

    function attachListenersToPageElements() {
        checklist.forEach((step, index) => {
            if (step.fields) {
                step.fields.forEach(field => {
                    const element = document.querySelector(field.selector);
                    if (element) {
                        const eventType = (element.type === 'checkbox' || element.type === 'select-one' || element.type === 'radio') ? 'change' : 'input';
                        element.addEventListener(eventType, () => {
                            if (isInitializing) return;
                            const keys = getStorageKeys();
                            ext.storage.local.get([keys.checklistState, keys.uiState, keys.viewMode], r => {
                                updateAndBroadcast(r[keys.checklistState], r[keys.uiState], r[keys.viewMode]);
                            });
                        });
                    }
                });
            }
        });

        // Inject validation UI for alphabetizing rules
        injectValidationUI();
    }

    /**
     * Convert a CSS selector to a valid ID suffix
     * Example: "#PrimaryInsuredName" -> "PrimaryInsuredName"
     * Example: "#Policy-Number_input" -> "Policy-Number_input"
     */
    function selectorToId(selector) {
        // Remove leading # and . and replace special chars with hyphens
        return selector.replace(/^[#.]/, '').replace(/[^\w-]/g, '-');
    }

    /**
     * Inject validation UI (warning icons and auto-fix buttons) for fields that need alphabetizing validation
     */
    function injectValidationUI() {
        console.log(LOG_PREFIX, '[AlphabetizeUI] Starting validation UI injection');
        console.log(LOG_PREFIX, '[AlphabetizeUI] AlphabetizeHelper available:', !!window.AlphabetizeHelper);
        console.log(LOG_PREFIX, '[AlphabetizeUI] Config available:', !!config);

        if (!window.AlphabetizeHelper || !config) {
            console.warn(LOG_PREFIX, '[AlphabetizeUI] Cannot inject - missing helper or config');
            return;
        }

        const validatableFields = window.AlphabetizeHelper.getValidatableFields(config);
        console.log(LOG_PREFIX, '[AlphabetizeUI] Found validatable fields:', validatableFields);

        validatableFields.forEach(fieldInfo => {
            console.log(LOG_PREFIX, '[AlphabetizeUI] Processing field:', fieldInfo);
            const inputElement = document.querySelector(fieldInfo.selector);
            console.log(LOG_PREFIX, '[AlphabetizeUI] Input element found:', !!inputElement, fieldInfo.selector);

            if (!inputElement) {
                console.warn(LOG_PREFIX, '[AlphabetizeUI] Input element not found for selector:', fieldInfo.selector);
                return;
            }

            // Generate unique ID from selector
            const fieldId = selectorToId(fieldInfo.selector);
            const containerId = `alphabetize-validation-${fieldId}`;

            // Check if validation UI already exists
            const existingContainer = document.getElementById(containerId);
            if (existingContainer) {
                console.log(LOG_PREFIX, '[AlphabetizeUI] Validation UI already exists for:', fieldInfo.selector);
                return;
            }

            // Create validation container with unique ID
            const validationContainer = document.createElement('div');
            validationContainer.id = containerId;
            validationContainer.className = 'alphabetize-validation-container';
            validationContainer.setAttribute('data-field-selector', fieldInfo.selector);
            validationContainer.setAttribute('data-field-type', fieldInfo.type);
            validationContainer.style.cssText = `
                position: absolute;
                right: 0px;
                top: 50%;
                transform: translateY(-50%);
                display: none;
                align-items: center;
                gap: 5px;
                z-index: 1000;
            `;

            // Create warning icon
            const warningIcon = document.createElement('span');
            warningIcon.className = 'alphabetize-warning-icon';
            warningIcon.textContent = '⚠';
            warningIcon.style.cssText = `
                color: #ffc107;
                font-size: 18px;
                cursor: help;
            `;
            warningIcon.title = 'This field can be improved';

            // Create auto-fix button
            const fixButton = document.createElement('button');
            fixButton.className = 'alphabetize-fix-button';
            fixButton.textContent = '🛠';
            fixButton.style.cssText = `
                background: #667eea;
                color: white;
                border: none;
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 14px;
                line-height: 1;
                transition: all 0.2s;
            `;
            fixButton.title = 'Click to auto-fix';

            // Hover effects
            fixButton.addEventListener('mouseenter', () => {
                fixButton.style.background = '#5568d3';
                fixButton.style.transform = 'scale(1.05)';
            });
            fixButton.addEventListener('mouseleave', () => {
                fixButton.style.background = '#667eea';
                fixButton.style.transform = 'scale(1)';
            });

            validationContainer.appendChild(warningIcon);
            validationContainer.appendChild(fixButton);

            // Make input's parent relative for absolute positioning
            const inputParent = inputElement.parentElement;
            if (window.getComputedStyle(inputParent).position === 'static') {
                inputParent.style.position = 'relative';
            }
            inputParent.appendChild(validationContainer);

            // Validation function
            const validateField = () => {
                const value = inputElement.value;
                console.log(LOG_PREFIX, '[AlphabetizeUI] Validating field:', fieldInfo.selector, 'value:', value);
                let result;

                if (fieldInfo.type === 'policyNumber') {
                    result = window.AlphabetizeHelper.validatePolicyNumber(value);
                } else if (fieldInfo.type === 'namedInsured') {
                    result = window.AlphabetizeHelper.validateNamedInsured(value);
                }

                console.log(LOG_PREFIX, '[AlphabetizeUI] Validation result:', result);

                if (!result.isValid && value.trim() !== '') {
                    console.log(LOG_PREFIX, '[AlphabetizeUI] Showing validation UI for:', fieldInfo.selector);
                    validationContainer.style.display = 'flex';
                    warningIcon.title = result.message || 'This field can be improved';
                    fixButton.title = `Click to auto-fix: "${result.fixedValue}"`;
                } else {
                    console.log(LOG_PREFIX, '[AlphabetizeUI] Hiding validation UI for:', fieldInfo.selector);
                    validationContainer.style.display = 'none';
                }
            };

            console.log(LOG_PREFIX, '[AlphabetizeUI] Validation UI created for:', fieldInfo.selector);

            // Auto-fix handler
            fixButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const value = inputElement.value;
                let result;

                if (fieldInfo.type === 'policyNumber') {
                    result = window.AlphabetizeHelper.validatePolicyNumber(value);
                } else if (fieldInfo.type === 'namedInsured') {
                    result = window.AlphabetizeHelper.validateNamedInsured(value);
                }

                if (!result.isValid && result.fixedValue) {
                    // Apply the fix
                    const oldValue = inputElement.value;
                    inputElement.value = result.fixedValue;

                    // Trigger change event to update state
                    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                    inputElement.dispatchEvent(new Event('change', { bubbles: true }));

                    // Briefly highlight the field
                    inputElement.style.transition = 'background-color 0.3s ease';
                    inputElement.style.backgroundColor = '#d4edda';
                    setTimeout(() => {
                        inputElement.style.backgroundColor = '';
                    }, 1000);

                    // Log the correction
                    console.log(LOG_PREFIX, `Alphabetizing rule applied: "${oldValue}" → "${result.fixedValue}"`);

                    // Re-validate to hide the UI
                    validateField();
                }
            });

            // Attach validation on input/change
            inputElement.addEventListener('input', validateField);
            inputElement.addEventListener('change', validateField);

            // Initial validation
            validateField();
        });
    }

    function getElementForStep(index) {
        const step = checklist[index];
        if (!step) return null;
        if (step.container_selector) {
            let el = document.querySelector(step.container_selector);
            if (!el) return null;
            let levelsUp = step.container_levels_up || 0;
            for (let i = 0; i < levelsUp; i++) {
                if (el.parentElement) {
                    el = el.parentElement;
                } else {
                    break;
                }
            }
            return el;
        }
        const selector = step.selector || (step.fields && step.fields.length > 0 ? step.fields[0].selector : null);
        if (!selector) return null;
        return document.querySelector(selector)?.closest('.form-group, .details-row, .row') || null;
    }

    function injectConfirmationCheckboxes(state) {
        checklist.forEach((step, index) => {
            // Try zone checkboxes if this item uses them
            if (itemUsesZoneCheckboxes(index)) {
                const zoneSuccess = injectZoneCheckboxes(index, state);

                if (zoneSuccess) {
                    console.log(LOG_PREFIX, `Using zone checkboxes for item "${step.name}"`);
                    return; // Zone checkboxes succeeded, don't inject traditional checkbox
                } else {
                    console.warn(LOG_PREFIX,
                        `Zone checkboxes failed for item "${step.name}" - falling back to traditional checkbox`
                    );
                    // Fall through to inject traditional checkbox
                }
            }

            // Inject traditional checkbox (either zones not used, or zones failed)
            const container = getElementForStep(index);
            if (container && !document.getElementById(`checklist-confirm-cb-${index}`)) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `checklist-confirm-cb-${index}`;
                checkbox.classList.add('processing-checklist-checkbox');

                // Add unique ID based on field selector for CSS targeting
                const selector = step.selector || (step.fields && step.fields.length > 0 ? step.fields[0].selector : null);
                if (selector) {
                    const fieldId = selectorToId(selector);
                    checkbox.setAttribute('data-field-id', fieldId);
                    checkbox.setAttribute('data-field-selector', selector);
                    // Add a second ID for direct CSS targeting: checkbox-FieldName
                    checkbox.classList.add(`checkbox-${fieldId}`);
                }
                checkbox.setAttribute('data-item-index', index);
                checkbox.setAttribute('data-item-name', step.name);

                if (step.name === "NAICS Code") {
                    checkbox.classList.add("naics-checkbox");
                }
                checkbox.addEventListener('change', () => {
                    if (isInitializing || isProgrammaticUpdate) return;
                    if (checkbox.checked) handleConfirmField(index); else unconfirmField(index);
                });
                // Ensure container can position the absolute checkbox
                container.classList.add('checklist-item-container');
                if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative';
                container.insertBefore(checkbox, container.firstChild);
            }
            if (state && state[index]) {
                updateOnPageCheckbox(index, state[index].processed);
            }
        });
    }

    /**
     * Inject zone-based checkboxes for an item
     * @param {number} index - The checklist item index
     * @param {Array} state - The checklist state array
     * @returns {boolean} True if at least one checkbox was successfully created, false otherwise
     */
    function injectZoneCheckboxes(index, state) {
        const step = checklist[index];
        if (!step.highlight_zones || step.highlight_zones.length === 0) return false;

        // Don't re-inject if already exists
        if (zoneCheckboxes.has(index)) return true;

        const itemState = state && state[index] ? state[index] : { processed: false, skipped: false };
        const checkboxes = [];

        step.highlight_zones.forEach((zoneConfig, zoneIndex) => {
            if (zoneConfig.show_checkbox !== true) return;

            try {
                const rect = calculateZoneRect(zoneConfig, index, zoneIndex);

                if (!rect) {
                    console.warn(LOG_PREFIX,
                        `Item "${step.name}" zone ${zoneIndex} has show_checkbox:true but zone rect calculation failed`
                    );
                    return;
                }

                if (rect.width <= 0 || rect.height <= 0) {
                    console.warn(LOG_PREFIX,
                        `Item "${step.name}" zone ${zoneIndex} has show_checkbox:true but zone has invalid dimensions`
                    );
                    return;
                }

                const checkbox = createZoneCheckbox(index, zoneIndex, rect, itemState);
                if (checkbox) {
                    checkboxes.push({ checkbox, zoneIndex });
                }
            } catch (error) {
                console.error(LOG_PREFIX, `Failed to inject zone checkbox for item ${index}, zone ${zoneIndex}:`, error);
            }
        });

        if (checkboxes.length > 0) {
            zoneCheckboxes.set(index, checkboxes);
            return true;
        }

        // All zone checkboxes failed - return false to trigger fallback
        return false;
    }

    function updateOnPageCheckbox(index, isChecked) {
        const checkbox = document.getElementById(`checklist-confirm-cb-${index}`);
        if (checkbox && checkbox.checked !== isChecked) {
            isProgrammaticUpdate = true;
            checkbox.checked = isChecked;
            // Use setTimeout to ensure the flag is cleared after all events
            setTimeout(() => {
                isProgrammaticUpdate = false;
            }, 0);
        }
    }

    let updateItemVisualsInProgress = false;

    /**
     * OPTIMIZATION: Update visuals for a single item only (fast path for checkbox clicks)
     * This avoids re-rendering all items when only one changes
     */
    function updateItemVisualsForSingleItem(index, itemState, isReviewMode) {
        const step = checklist[index];

        // Try highlight zones if defined
        let zonesSucceeded = false;
        if (step && step.highlight_zones && step.highlight_zones.length > 0) {
            zonesSucceeded = updateHighlightZones(index, itemState, isReviewMode);
        }

        // Fallback to container highlighting if zones not defined or all failed
        if (!zonesSucceeded) {
            const container = getElementForStep(index);
            if (container) {
                container.classList.remove('skipped-item', 'confirmed-item');
                if (itemState.skipped) {
                    container.classList.add('skipped-item');
                } else if (itemState.processed) {
                    container.classList.add('confirmed-item');
                }
            }
        } else {
            // Zones succeeded - make sure container highlighting is removed
            const container = getElementForStep(index);
            if (container) {
                container.classList.remove('skipped-item', 'confirmed-item');
            }
        }

        // Update traditional checkbox to match state (if it exists)
        const checkbox = document.getElementById(`checklist-confirm-cb-${index}`);
        if (checkbox && checkbox.checked !== itemState.processed) {
            isProgrammaticUpdate = true;
            checkbox.checked = itemState.processed;
            setTimeout(() => {
                isProgrammaticUpdate = false;
            }, 0);
        }

        // Update zone checkboxes to match state (if they exist)
        updateZoneCheckboxes(index, itemState.processed);
    }

    function updateItemVisuals(state) {
        // Prevent recursive/concurrent calls
        if (updateItemVisualsInProgress) {
            return;
        }

        updateItemVisualsInProgress = true;
        isProgrammaticUpdate = true;
        const isReviewMode = window.trackingHelper && window.trackingHelper.isReviewMode;

        // Commented out to reduce console spam
        // console.log(LOG_PREFIX, `updateItemVisuals called, isReviewMode=${isReviewMode}, state=`, state);

        state.forEach((itemState, index) => {
            const step = checklist[index];

            // Try highlight zones if defined
            let zonesSucceeded = false;
            if (step && step.highlight_zones && step.highlight_zones.length > 0) {
                zonesSucceeded = updateHighlightZones(index, itemState, isReviewMode);
            }

            // Fallback to container highlighting if zones not defined or all failed
            if (!zonesSucceeded) {
                const container = getElementForStep(index);
                if (container) {
                    container.classList.remove('skipped-item', 'confirmed-item');
                    if (itemState.skipped) {
                        container.classList.add('skipped-item');
                    } else if (itemState.processed) {
                        container.classList.add('confirmed-item');
                    }
                }
            } else {
                // Zones succeeded - make sure container highlighting is removed
                const container = getElementForStep(index);
                if (container) {
                    container.classList.remove('skipped-item', 'confirmed-item');
                }
            }

            // Update traditional checkbox to match state (if it exists)
            const checkbox = document.getElementById(`checklist-confirm-cb-${index}`);
            if (checkbox && checkbox.checked !== itemState.processed) {
                checkbox.checked = itemState.processed;
            }

            // Update zone checkboxes to match state (if they exist)
            updateZoneCheckboxes(index, itemState.processed);
        });
        setTimeout(() => {
            isProgrammaticUpdate = false;
            updateItemVisualsInProgress = false;
        }, 50);
    }

    /**
     * Check if a checklist item uses zone-based checkboxes
     * @param {number} index - The checklist item index
     * @returns {boolean} True if any zone has show_checkbox: true
     */
    function itemUsesZoneCheckboxes(index) {
        const step = checklist[index];
        if (!step || !step.highlight_zones) return false;
        return step.highlight_zones.some(zone => zone.show_checkbox === true);
    }

    /**
     * Calculate checkbox position with overflow handling
     * @param {Object} zoneRect - Zone rectangle {top, left, width, height}
     * @param {number} checkboxWidth - Checkbox width in pixels
     * @param {number} checkboxHeight - Checkbox height in pixels
     * @returns {Object} Position {top, left}
     */
    function calculateCheckboxPosition(zoneRect, checkboxWidth, checkboxHeight) {
        const padding = 10;
        let left, top;

        // Horizontal positioning
        if (checkboxWidth > zoneRect.width - (2 * padding)) {
            // Center horizontally - checkbox too wide for zone with padding
            left = zoneRect.left + (zoneRect.width / 2) - (checkboxWidth / 2);
        } else {
            // Default: top-left with padding
            left = zoneRect.left + padding;
        }

        // Vertical positioning
        if (checkboxHeight > zoneRect.height - (2 * padding)) {
            // Center vertically - checkbox too tall for zone with padding
            top = zoneRect.top + (zoneRect.height / 2) - (checkboxHeight / 2);
        } else {
            // Default: top-left with padding
            top = zoneRect.top + padding;
        }

        return { top, left };
    }

    /**
     * Create a zone-positioned checkbox
     * @param {number} itemIndex - The checklist item index
     * @param {number} zoneIndex - The zone index within the item
     * @param {Object} zoneRect - Zone rectangle {top, left, width, height}
     * @param {Object} itemState - Item state {processed, skipped}
     * @returns {HTMLElement|null} The created checkbox element or null
     */
    function createZoneCheckbox(itemIndex, zoneIndex, zoneRect, itemState) {
        try {
            const step = checklist[itemIndex];
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'zone-checkbox';
            checkbox.setAttribute('data-zone-checkbox', 'true');
            checkbox.setAttribute('data-item-index', itemIndex);
            checkbox.setAttribute('data-zone-index', zoneIndex);
            checkbox.setAttribute('data-item-name', step.name);

            // Add unique ID based on field selector for CSS targeting
            const selector = step.selector || (step.fields && step.fields.length > 0 ? step.fields[0].selector : null);
            if (selector) {
                const fieldId = selectorToId(selector);
                checkbox.setAttribute('data-field-id', fieldId);
                checkbox.setAttribute('data-field-selector', selector);
                // Add a class for direct CSS targeting: zone-checkbox-FieldName
                checkbox.classList.add(`zone-checkbox-${fieldId}`);
            }

            checkbox.checked = itemState.processed;

            // Get checkbox dimensions (using known size from CSS)
            const checkboxWidth = 18 + 4; // 18px + 2px padding on each side
            const checkboxHeight = 18 + 4;

            // Calculate position with overflow handling
            const position = calculateCheckboxPosition(zoneRect, checkboxWidth, checkboxHeight);

            // Position relative to document (with scroll offset)
            checkbox.style.top = `${position.top + window.scrollY}px`;
            checkbox.style.left = `${position.left + window.scrollX}px`;

            // Add event listener
            checkbox.addEventListener('change', () => {
                if (isInitializing || isProgrammaticUpdate) return;
                if (checkbox.checked) {
                    handleConfirmField(itemIndex);
                } else {
                    unconfirmField(itemIndex);
                }
            });

            document.body.appendChild(checkbox);
            return checkbox;
        } catch (error) {
            console.error(LOG_PREFIX, `Failed to create zone checkbox for item ${itemIndex}, zone ${zoneIndex}:`, error);
            return null;
        }
    }

    /**
     * Remove all zone checkboxes for a specific item index
     * @param {number} index - The checklist item index
     */
    function removeZoneCheckboxes(index) {
        const checkboxData = zoneCheckboxes.get(index);
        if (checkboxData) {
            checkboxData.forEach(({ checkbox }) => {
                if (checkbox.parentNode) {
                    checkbox.parentNode.removeChild(checkbox);
                }
            });
            zoneCheckboxes.delete(index);
        }
    }

    /**
     * Update zone checkbox checked state
     * @param {number} index - The checklist item index
     * @param {boolean} isChecked - Whether the checkbox should be checked
     */
    function updateZoneCheckboxes(index, isChecked) {
        const checkboxData = zoneCheckboxes.get(index);
        if (checkboxData) {
            isProgrammaticUpdate = true;
            checkboxData.forEach(({ checkbox }) => {
                if (checkbox.checked !== isChecked) {
                    checkbox.checked = isChecked;
                }
            });
            setTimeout(() => {
                isProgrammaticUpdate = false;
            }, 0);
        }
    }

    /**
     * Create or update highlight zones for a checklist item
     * @param {number} index - The checklist item index
     * @param {Object} itemState - The state object {processed, skipped}
     * @returns {boolean} True if at least one zone was successfully created, false otherwise
     */
    function updateHighlightZones(index, itemState, isReviewMode = false) {
        // Remove existing zones for this index (but NOT checkboxes - they stay visible)
        removeHighlightZones(index);

        const step = checklist[index];
        if (!step.highlight_zones || step.highlight_zones.length === 0) return false;

        // Determine state class (blue for review mode, green/yellow for normal)
        let stateClass = '';
        if (itemState.processed) {
            stateClass = isReviewMode ? 'review-confirmed-zone' : 'confirmed-zone';
        } else if (itemState.skipped) {
            stateClass = 'skipped-zone';
        }

        // If no state, don't create zones (but checkboxes remain visible)
        if (!stateClass) return true; // Return true because zones aren't needed, not failed

        const zoneDivs = [];

        step.highlight_zones.forEach((zoneConfig, zoneIndex) => {
            try {
                const rect = calculateZoneRect(zoneConfig, index, zoneIndex);

                if (!rect) {
                    // Elements not found or invalid
                    return;
                }

                // Skip zones that are fully off-screen
                if (rect.width <= 0 || rect.height <= 0) {
                    return;
                }

                // Create zone div
                const zoneDiv = document.createElement('div');
                zoneDiv.className = `highlight-zone-overlay ${stateClass}`;
                zoneDiv.setAttribute('data-item-index', index);
                zoneDiv.setAttribute('data-zone-index', zoneIndex);
                zoneDiv.style.top = `${rect.top + window.scrollY}px`;
                zoneDiv.style.left = `${rect.left + window.scrollX}px`;
                zoneDiv.style.width = `${rect.width}px`;
                zoneDiv.style.height = `${rect.height}px`;

                document.body.appendChild(zoneDiv);
                zoneDivs.push(zoneDiv);
            } catch (error) {
                console.warn(LOG_PREFIX, `Failed to create zone ${zoneIndex} for item "${step.name}":`, error);
            }
        });

        if (zoneDivs.length > 0) {
            highlightZones.set(index, zoneDivs);
            return true;
        }

        // All zones failed - return false to trigger fallback
        return false;
    }

    /**
     * Calculate the rectangle for a highlight zone from edge definitions
     * @param {Object} zoneConfig - Zone configuration with top, bottom, left, right edges
     * @param {number} itemIndex - The item index (for error logging)
     * @param {number} zoneIndex - The zone index (for error logging)
     * @returns {Object|null} Rectangle {top, left, width, height} or null if invalid
     */
    function calculateZoneRect(zoneConfig, itemIndex, zoneIndex) {
        const edges = { top: null, bottom: null, left: null, right: null };

        // Calculate each edge position
        for (const edgeName of ['top', 'bottom', 'left', 'right']) {
            const edgeConfig = zoneConfig[edgeName];
            const element = document.querySelector(edgeConfig.selector);

            if (!element) {
                // Only log each unique warning once to avoid spam
                const warningKey = `zone-element-not-found:${itemIndex}:${zoneIndex}:${edgeName}:${edgeConfig.selector}`;
                if (!loggedWarnings.has(warningKey)) {
                    loggedWarnings.add(warningKey);
                    console.warn(LOG_PREFIX,
                        `Item "${checklist[itemIndex].name}" (index ${itemIndex}), zone ${zoneIndex}: ` +
                        `Element not found for ${edgeName} edge (selector: "${edgeConfig.selector}")`
                    );
                }
                return null;
            }

            const rect = element.getBoundingClientRect();
            let position;

            switch (edgeConfig.edge) {
                case 'top':
                    position = rect.top;
                    break;
                case 'bottom':
                    position = rect.bottom;
                    break;
                case 'left':
                    position = rect.left;
                    break;
                case 'right':
                    position = rect.right;
                    break;
                default:
                    console.warn(LOG_PREFIX,
                        `Invalid edge type "${edgeConfig.edge}" for ${edgeName} in item ${itemIndex}, zone ${zoneIndex}`
                    );
                    return null;
            }

            edges[edgeName] = position + (edgeConfig.offset || 0);
        }

        // Calculate final rectangle
        return {
            top: edges.top,
            left: edges.left,
            width: edges.right - edges.left,
            height: edges.bottom - edges.top
        };
    }

    /**
     * Remove all highlight zone divs for a specific item index
     * @param {number} index - The checklist item index
     */
    function removeHighlightZones(index) {
        const zoneDivs = highlightZones.get(index);
        if (zoneDivs) {
            zoneDivs.forEach(div => {
                if (div.parentNode) {
                    div.parentNode.removeChild(div);
                }
            });
            highlightZones.delete(index);
        }
    }

    /**
     * Remove all highlight zones for all items
     */
    function removeAllHighlightZones() {
        highlightZones.forEach((zoneDivs, index) => {
            zoneDivs.forEach(div => {
                if (div.parentNode) {
                    div.parentNode.removeChild(div);
                }
            });
        });
        highlightZones.clear();
    }

    /**
     * Remove all zone checkboxes for all items
     */
    function removeAllZoneCheckboxes() {
        zoneCheckboxes.forEach((checkboxData, index) => {
            checkboxData.forEach(({ checkbox }) => {
                if (checkbox.parentNode) {
                    checkbox.parentNode.removeChild(checkbox);
                }
            });
        });
        zoneCheckboxes.clear();
    }

    /**
     * Recalculate zone checkbox positions
     */
    function recalculateZoneCheckboxes() {
        zoneCheckboxes.forEach((checkboxData, index) => {
            const step = checklist[index];
            if (!step || !step.highlight_zones) return;

            checkboxData.forEach(({ checkbox, zoneIndex }) => {
                try {
                    const zoneConfig = step.highlight_zones[zoneIndex];
                    if (!zoneConfig) return;

                    const rect = calculateZoneRect(zoneConfig, index, zoneIndex);
                    if (!rect || rect.width <= 0 || rect.height <= 0) return;

                    // Get checkbox dimensions
                    const checkboxWidth = 18 + 4;
                    const checkboxHeight = 18 + 4;

                    // Calculate new position
                    const position = calculateCheckboxPosition(rect, checkboxWidth, checkboxHeight);

                    // Update position
                    checkbox.style.top = `${position.top + window.scrollY}px`;
                    checkbox.style.left = `${position.left + window.scrollX}px`;
                } catch (error) {
                    console.warn(LOG_PREFIX, `Failed to recalculate checkbox position for item ${index}, zone ${zoneIndex}:`, error);
                }
            });
        });
    }

    /**
     * Recalculate all visible highlight zones (for window resize)
     */
    function recalculateHighlightZones() {
        const keys = getStorageKeys();
        const isReview = window.trackingHelper && window.trackingHelper.isReviewMode;
        const stateKey = isReview ? keys.reviewState : keys.checklistState;

        ext.storage.local.get(stateKey, (result) => {
            if (result[stateKey]) {
                updateItemVisuals(result[stateKey]);
            }
        });
        // Also recalculate zone checkbox positions
        recalculateZoneCheckboxes();
    }

    // Add window resize listener for zone recalculation
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            recalculateHighlightZones();
        }, 250); // Debounce resize events
    });

    /**
     * MutationObserver to watch for DOM changes that might affect positioning
     * This handles cases where elements move due to animations, dynamic content, etc.
     */
    let positionObserver = null;
    let observerTimeout = null;

    function startPositionObserver() {
        if (positionObserver) return; // Already observing

        let recalcInProgress = false;

        positionObserver = new MutationObserver(() => {
            // Debounce the recalculation to avoid excessive updates
            clearTimeout(observerTimeout);
            observerTimeout = setTimeout(() => {
                // Prevent recursive calls
                if (recalcInProgress) return;
                recalcInProgress = true;
                recalculateHighlightZones();
                setTimeout(() => {
                    recalcInProgress = false;
                }, 100);
            }, 100);
        });

        // Observe the entire document body for:
        // - childList: elements being added/removed
        // - attributes: style/class changes that might affect layout
        // - subtree: watch all descendants
        positionObserver.observe(document.body, {
            childList: true,
            attributes: true,
            attributeFilter: ['style', 'class'],
            subtree: true
        });

        console.log(LOG_PREFIX, "Position observer started - will reposition elements on DOM changes");
    }

    function stopPositionObserver() {
        if (positionObserver) {
            positionObserver.disconnect();
            positionObserver = null;
            clearTimeout(observerTimeout);
            console.log(LOG_PREFIX, "Position observer stopped");
        }
    }

    /**
     * Restore UI elements (checkboxes and zones)
     * This is called when elements might be missing from the DOM
     */
    function restoreUIElements() {
        if (!configLoaded || !myTabId) return;

        const keys = getStorageKeys();
        const isReview = window.trackingHelper && window.trackingHelper.isReviewMode;
        const stateKey = isReview ? keys.reviewState : keys.checklistState;

        ext.storage.local.get([stateKey, keys.uiState, keys.viewMode], (result) => {
            if (!result[stateKey]) return;

            // Check if any checkboxes are missing
            let missingCount = 0;
            checklist.forEach((step, index) => {
                const hasTraditionalCheckbox = document.getElementById(`checklist-confirm-cb-${index}`);
                const hasZoneCheckboxes = zoneCheckboxes.has(index);

                if (!hasTraditionalCheckbox && !hasZoneCheckboxes) {
                    missingCount++;
                }
            });

            if (missingCount > 0) {
                console.log(LOG_PREFIX, `Found ${missingCount} items with missing checkboxes - reinjecting`);

                // Clear existing zone tracking to force recreation
                zoneCheckboxes.clear();
                highlightZones.clear();

                // Reinject all checkboxes
                injectConfirmationCheckboxes(result[stateKey]);
            }

            // Always update visual states and recalculate positions
            updateItemVisuals(result[stateKey]);
            recalculateZoneCheckboxes();

            // Restart position observer if it was stopped
            if (!positionObserver) {
                startPositionObserver();
            }
        });
    }

    /**
     * Periodic recovery check to handle script reloads (e.g., after Firefox downloads)
     * Runs every 2 seconds to detect and restore missing UI elements
     */
    let periodicRecoveryInterval = null;

    function startPeriodicRecoveryCheck() {
        // Don't start multiple intervals
        if (periodicRecoveryInterval) return;

        console.log(LOG_PREFIX, "Starting periodic recovery check (every 2 seconds)");

        periodicRecoveryInterval = setInterval(() => {
            if (!configLoaded || !myTabId) return;

            // Quick check: are checkboxes missing?
            const firstCheckbox = document.getElementById('checklist-confirm-cb-0');
            const hasZoneCheckbox = zoneCheckboxes.size > 0;

            if (!firstCheckbox && !hasZoneCheckbox) {
                console.log(LOG_PREFIX, "Periodic check detected missing checkboxes - attempting recovery");
                restoreUIElements();
            }
        }, 2000); // Check every 2 seconds
    }

    function stopPeriodicRecoveryCheck() {
        if (periodicRecoveryInterval) {
            clearInterval(periodicRecoveryInterval);
            periodicRecoveryInterval = null;
            console.log(LOG_PREFIX, "Periodic recovery check stopped");
        }
    }

    /**
     * Handle page visibility changes (e.g., when download dialogs appear)
     * This ensures checkboxes and zones are restored when the page becomes visible again
     */
    let visibilityRecoveryInterval = null;

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && configLoaded && myTabId) {
            // Don't run recovery during review mode - it interferes with review state
            if (window.trackingHelper && window.trackingHelper.isReviewMode) {
                console.log(LOG_PREFIX, "Skipping recovery - in review mode");
                return;
            }

            console.log(LOG_PREFIX, "Page became visible - starting recovery process");

            // Clear any existing recovery interval
            if (visibilityRecoveryInterval) {
                clearInterval(visibilityRecoveryInterval);
                visibilityRecoveryInterval = null;
            }

            // Immediate attempt
            setTimeout(() => restoreUIElements(), 100);

            // Periodic recovery attempts for 10 seconds
            // This handles cases where DOM isn't fully settled immediately
            let attemptCount = 0;
            visibilityRecoveryInterval = setInterval(() => {
                attemptCount++;
                console.log(LOG_PREFIX, `Recovery attempt ${attemptCount}/10`);
                restoreUIElements();

                // Stop after 10 attempts (10 seconds)
                if (attemptCount >= 10) {
                    clearInterval(visibilityRecoveryInterval);
                    visibilityRecoveryInterval = null;
                    console.log(LOG_PREFIX, "Recovery process completed");
                }
            }, 1000);
        } else if (document.hidden) {
            // Page became hidden - stop recovery attempts
            if (visibilityRecoveryInterval) {
                clearInterval(visibilityRecoveryInterval);
                visibilityRecoveryInterval = null;
                console.log(LOG_PREFIX, "Page hidden - stopping recovery process");
            }
        }
    });

    // Storage for pre-mark-checked state (to enable undo)
    let preMarkCheckedState = null;

    /**
     * Inject "Mark Checked" button next to Mark for Review or Register button
     */
    function injectMarkCheckedButton() {
        // Check if button already exists
        if (document.getElementById('btnMarkChecked')) {
            return;
        }

        // Try to find either Mark for Review or Register button
        // List of possible button IDs to search for
        const possibleButtonIds = ['btnMarkForReview', 'btnRegister'];
        let targetButton = null;
        let buttonName = '';

        for (const buttonId of possibleButtonIds) {
            targetButton = document.getElementById(buttonId);
            if (targetButton) {
                buttonName = buttonId === 'btnMarkForReview' ? 'Mark for Review' : 'Register';
                console.log(LOG_PREFIX, `Found ${buttonName} button (${buttonId})`);
                break;
            }
        }

        // If no button found by ID, try finding by form and button attributes
        if (!targetButton) {
            const form = document.getElementById('ProcessActionForm');
            if (form) {
                // Look for primary button in the form's right-aligned column
                const rightColumn = form.querySelector('.col-md-4.text-right');
                if (rightColumn) {
                    targetButton = rightColumn.querySelector('button.btn.btn-primary[type="submit"]');
                    if (targetButton) {
                        buttonName = targetButton.textContent.trim();
                        console.log(LOG_PREFIX, `Found form action button: "${buttonName}"`);
                    }
                }
            }
        }

        if (!targetButton) {
            console.log(LOG_PREFIX, "No suitable target button found (tried: btnMarkForReview, btnRegister, and form primary button) - cannot inject Mark Checked button");
            return;
        }

        // Get the parent container (the <span> that wraps the button, or the button itself)
        let insertionPoint = targetButton.closest('span') || targetButton;

        // Create the Mark Checked button
        const markCheckedBtn = document.createElement('button');
        markCheckedBtn.type = 'button';
        markCheckedBtn.id = 'btnMarkChecked';
        markCheckedBtn.className = 'btn btn-success';
        markCheckedBtn.style.marginRight = '8px';
        markCheckedBtn.textContent = 'Mark Checked';
        markCheckedBtn.title = 'Check all unchecked items';

        // Add click handler
        markCheckedBtn.addEventListener('click', () => {
            toggleMarkChecked();
        });

        // Insert before the target button (or its wrapper span)
        insertionPoint.insertAdjacentElement('beforebegin', markCheckedBtn);

        console.log(LOG_PREFIX, `Mark Checked button injected next to "${buttonName}" button`);
    }

    /**
     * Inject "Find Similar Policies" button next to Mark Checked button
     */
    function injectFindSimilarPoliciesButton() {
        // Check if button already exists
        if (document.getElementById('btnFindSimilarPolicies')) {
            return;
        }

        // Find the Mark Checked button to insert before it
        const markCheckedBtn = document.getElementById('btnMarkChecked');
        if (!markCheckedBtn) {
            console.log(LOG_PREFIX, "Mark Checked button not found - cannot inject Find Similar Policies button");
            return;
        }

        // Create the Find Similar Policies button
        const similarPoliciesBtn = document.createElement('button');
        similarPoliciesBtn.type = 'button';
        similarPoliciesBtn.id = 'btnFindSimilarPolicies';
        similarPoliciesBtn.className = 'btn btn-info';
        similarPoliciesBtn.style.marginRight = '8px';
        similarPoliciesBtn.textContent = 'Search';
        similarPoliciesBtn.title = 'Search for similar policies from this broker/insurer in the past month';

        // Add click handler
        similarPoliciesBtn.addEventListener('click', () => {
            handleFindSimilarPolicies();
        });

        // Insert before Mark Checked button
        markCheckedBtn.insertAdjacentElement('beforebegin', similarPoliciesBtn);

        console.log(LOG_PREFIX, "Find Similar Policies button injected");
    }

    /**
     * Handle Find Similar Policies button click
     */
    function handleFindSimilarPolicies() {
        // Extract broker ID
        const brokerIdInput = document.querySelector('#SlaBrokerNumber');
        const brokerId = brokerIdInput ? brokerIdInput.value : null;

        // Extract transaction type from the form
        const transactionTypeSelect = document.querySelector('#TransactionTypeId');
        let transactionType = null;
        if (transactionTypeSelect) {
            // Get the selected option value (e.g., "5" for New Business, "6" for Renewal, etc.)
            const selectedOption = transactionTypeSelect.options[transactionTypeSelect.selectedIndex];
            transactionType = selectedOption ? selectedOption.value : null;
        }
        console.log(LOG_PREFIX, 'Extracted transaction type:', transactionType);

        // Extract insurer data from the structured display elements
        // Format: [SLA#] INSURER NAME (#NAIC#) - STATUS
        let insurerName = null;
        let insurerId = null;
        let slaNumber = null;
        let naicNumber = null;
        let insurerStatus = null;

        // Primary: selectedInsurerName (from the row-buffer display)
        const insurerNameLink = document.querySelector('#selectedInsurerName');
        if (insurerNameLink) {
            insurerName = insurerNameLink.textContent.trim();
            // Extract ID from href: /Financial/CompanySearch/Company/CompanyDetails.aspx?Id=757
            const href = insurerNameLink.getAttribute('href');
            const idMatch = href ? href.match(/Id=(\d+)/) : null;
            insurerId = idMatch ? idMatch[1] : null;
        }

        // Extract additional details from the same row
        slaNumber = document.querySelector('#selectedSlaNumber')?.textContent.trim();
        naicNumber = document.querySelector('#selectedNAICNumber')?.textContent.trim();
        insurerStatus = document.querySelector('#selectedInsurerStatus')?.textContent.trim();

        console.log(LOG_PREFIX, 'Insurer extraction results:', {
            insurerName,
            insurerId,
            slaNumber,
            naicNumber,
            insurerStatus
        });

        // Fallback: singleSelectedInsurerName (alternate display)
        if (!insurerName) {
            const insurerNameSpan = document.querySelector('#singleSelectedInsurerName');
            if (insurerNameSpan) {
                const insurerLink = insurerNameSpan.querySelector('a');
                if (insurerLink) {
                    insurerName = insurerLink.textContent.trim();
                    const href = insurerLink.getAttribute('href');
                    const idMatch = href ? href.match(/Id=(\d+)/) : null;
                    insurerId = idMatch ? idMatch[1] : null;
                } else {
                    insurerName = insurerNameSpan.textContent.trim();
                }
            }
        }

        // Final fallback: SingleSelectedInsurerId_input (Kendo input)
        if (!insurerName) {
            const insurerInput = document.querySelector('#SingleSelectedInsurerId_input');
            insurerName = insurerInput ? insurerInput.value.trim() : null;
        }

        // If we have an ID, also get it from the hidden input
        if (!insurerId) {
            const insurerIdInput = document.querySelector('#SingleSelectedInsurerId');
            insurerId = insurerIdInput ? insurerIdInput.value : null;
        }

        // Extract submission date from link text
        const submissionLink = document.querySelector('#LaunchSubmissionInfoModal');
        let dateFrom, dateTo;

        if (submissionLink) {
            const submissionText = submissionLink.textContent.trim(); // "2025-10-14/0814"
            const datePart = submissionText.split('/')[0]; // "2025-10-14"
            const submissionDate = new Date(datePart);

            // Calculate date range: (submission - 1 month) to (submission - 1 day)
            const oneMonthBefore = new Date(submissionDate);
            oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1);
            oneMonthBefore.setDate(oneMonthBefore.getDate() + 1); // Start one day after month ago

            const oneDayBefore = new Date(submissionDate);
            oneDayBefore.setDate(oneDayBefore.getDate() - 1); // End one day before submission

            // Format as MM/DD/YYYY
            dateFrom = formatDateMMDDYYYY(oneMonthBefore);
            dateTo = formatDateMMDDYYYY(oneDayBefore);
        } else {
            // Fallback: use last month to yesterday
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const oneMonthAgo = new Date(today);
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

            dateFrom = formatDateMMDDYYYY(oneMonthAgo);
            dateTo = formatDateMMDDYYYY(yesterday);
        }

        // Validate required fields
        if (!brokerId && !insurerName) {
            showNotification('⚠️ Cannot find broker or insurer information', 'warning');
            return;
        }

        // Prepare search parameters for transaction search
        const searchParams = {
            brokerId: brokerId || '',
            insurerName: insurerName || '',
            insurerId: insurerId || '',
            slaNumber: slaNumber || '',
            naicNumber: naicNumber || '',
            insurerStatus: insurerStatus || '',
            transactionType: transactionType || '', // Transaction type ID from form (e.g., "5" for New Business)
            transactionStatus: 'R', // "R" for Registered (the value, not the display text)
            dateFrom: dateFrom,
            dateTo: dateTo,
            timestamp: Date.now()
        };

        // Store in browser storage for auto-fill
        console.log(LOG_PREFIX, 'Storing transaction search params:', searchParams);
        ext.storage.local.set({ pendingTransactionSearch: searchParams }, () => {
            if (ext.runtime.lastError) {
                console.error(LOG_PREFIX, 'Error storing params:', ext.runtime.lastError);
                showNotification('⚠️ Failed to save search parameters', 'warning');
                return;
            }

            console.log(LOG_PREFIX, 'Transaction search params stored successfully');

            // Open transaction search page (not policy search)
            const transactionSearchUrl = 'https://rapid.slacal.com/policy/transactionSearch';
            console.log(LOG_PREFIX, 'Opening transaction search:', transactionSearchUrl);
            window.open(transactionSearchUrl, '_blank');

            // Show confirmation
            showNotification('✓ Opening transaction search...', 'success');
        });
    }

    /**
     * Format date as MM/DD/YYYY
     */
    function formatDateMMDDYYYY(date) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
    }

    /**
     * Inject "Quick Fill Insurer" button if insurer details are incomplete
     */
    function injectInsurerQuickFillButton() {
        // Check if button already exists
        if (document.getElementById('btnQuickFillInsurer')) {
            return;
        }

        // Check for missing insurer details
        const slaNumber = document.querySelector('#selectedSlaNumber')?.textContent.trim();
        const naicNumber = document.querySelector('#selectedNAICNumber')?.textContent.trim();
        const insurerStatus = document.querySelector('#selectedInsurerStatus')?.textContent.trim();

        // Check if insurer name exists (try multiple sources)
        let insurerName = null;
        const insurerNameSpan = document.querySelector('#singleSelectedInsurerName');
        if (insurerNameSpan) {
            const insurerLink = insurerNameSpan.querySelector('a');
            insurerName = insurerLink ? insurerLink.textContent.trim() : insurerNameSpan.textContent.trim();
        }

        // Only inject button if SLA, NAIC, and Status are missing but Insurer Name exists
        if ((!slaNumber || !naicNumber || !insurerStatus) && insurerName) {
            console.log(LOG_PREFIX, "Incomplete insurer details detected - injecting Quick Fill button");
            console.log(LOG_PREFIX, `  SLA: "${slaNumber}", NAIC: "${naicNumber}", Status: "${insurerStatus}", Name: "${insurerName}"`);

            // Find the Insurer Name label (in the display row, not the search row)
            // The label is in the same parent div as #singleSelectedInsurerName
            const insurerNameColumn = insurerNameSpan?.closest('.col-md-4');
            if (!insurerNameColumn) {
                console.log(LOG_PREFIX, "Insurer Name column not found - cannot inject Quick Fill button");
                return;
            }

            const insurerLabel = insurerNameColumn.querySelector('label');
            if (!insurerLabel) {
                console.log(LOG_PREFIX, "Insurer Name label not found - cannot inject Quick Fill button");
                return;
            }

            // Extract first two words for tooltip
            const searchText = insurerName.split(' ').slice(0, 2).join(' ');

            // Create small arrow button
            const quickFillBtn = document.createElement('button');
            quickFillBtn.type = 'button';
            quickFillBtn.id = 'btnQuickFillInsurer';
            quickFillBtn.style.cssText = `
                margin-left: 6px;
                padding: 0px 4px 2px 4px;
                font-size: 12px;
                background-color: #5bc0de;
                border: 1px solid #46b8da;
                border-radius: 3px;
                color: white;
                cursor: pointer;
                vertical-align: middle;
                line-height: 1;
            `;
            quickFillBtn.innerHTML = '⬆';
            quickFillBtn.title = `Auto-fill the Insurer Search with "${searchText}"`;

            // Hover effects
            quickFillBtn.addEventListener('mouseenter', () => {
                quickFillBtn.style.backgroundColor = '#31b0d5';
            });
            quickFillBtn.addEventListener('mouseleave', () => {
                quickFillBtn.style.backgroundColor = '#5bc0de';
            });

            // Add click handler
            quickFillBtn.addEventListener('click', () => {
                handleInsurerQuickFill(insurerName);
            });

            // Insert button right after the label text
            insurerLabel.appendChild(quickFillBtn);

            console.log(LOG_PREFIX, "Quick Fill Insurer arrow button injected next to Insurer Name label");
        } else {
            console.log(LOG_PREFIX, "Insurer details are complete or missing name - no Quick Fill button needed");
        }
    }

    /**
     * Handle Quick Fill Insurer button click
     */
    function handleInsurerQuickFill(insurerName) {
        console.log(LOG_PREFIX, "handleInsurerQuickFill called with:", insurerName);

        // Extract first two words from insurer name
        const words = insurerName.trim().split(/\s+/);
        const searchText = words.slice(0, 2).join(' ');
        console.log(LOG_PREFIX, `Extracted search text: "${searchText}" from "${insurerName}"`);

        // Show notification
        showNotification(`🔍 Filling Insurer Search with "${searchText}"...`, 'info');

        // Try to fill using Kendo widget first, then fallback to direct input
        fillInsurerSearchField(searchText);
    }

    /**
     * Fill the Insurer Search field (Kendo ComboBox)
     */
    function fillInsurerSearchField(searchText) {
        console.log(LOG_PREFIX, `fillInsurerSearchField called with: "${searchText}"`);

        // Try jQuery/Kendo method first
        if (window.jQuery && typeof window.kendo !== 'undefined') {
            console.log(LOG_PREFIX, "jQuery and Kendo available - using widget method");

            const element = window.jQuery('#SingleSelectedInsurerId');
            if (element.length > 0) {
                const widget = element.data('kendoComboBox');

                if (widget) {
                    console.log(LOG_PREFIX, "Kendo ComboBox widget found");
                    try {
                        // Set the text in the search field
                        widget.text(searchText);
                        widget.search(searchText);

                        // Focus and trigger change to activate the dropdown
                        widget.trigger('change');
                        const visibleInput = document.querySelector('input[name="SingleSelectedInsurerId_input"]');
                        if (visibleInput) {
                            visibleInput.focus();
                        }

                        console.log(LOG_PREFIX, `✓ Successfully filled Insurer Search with: "${searchText}"`);
                        showNotification(`✓ Filled with "${searchText}" - please select from dropdown`, 'success');
                        return true;
                    } catch (error) {
                        console.error(LOG_PREFIX, "Error using Kendo widget:", error);
                    }
                } else {
                    console.warn(LOG_PREFIX, "Kendo ComboBox widget not found");
                }
            } else {
                console.warn(LOG_PREFIX, "Element #SingleSelectedInsurerId not found");
            }
        }

        // Fallback: Direct input manipulation
        console.log(LOG_PREFIX, "Using direct input fallback");
        const visibleInput = document.querySelector('input[name="SingleSelectedInsurerId_input"]');

        if (visibleInput) {
            console.log(LOG_PREFIX, "Found visible input, setting value");
            visibleInput.value = searchText;

            // Trigger events to activate Kendo search
            const events = ['input', 'change', 'focus', 'keydown'];
            events.forEach(eventType => {
                const event = new Event(eventType, { bubbles: true, cancelable: true });
                visibleInput.dispatchEvent(event);
            });

            // Focus the input
            visibleInput.focus();

            console.log(LOG_PREFIX, `✓ Directly filled Insurer Search with: "${searchText}"`);
            showNotification(`✓ Filled with "${searchText}" - please select from dropdown`, 'success');
            return true;
        } else {
            console.error(LOG_PREFIX, "Visible input not found - cannot fill");
            showNotification('⚠️ Could not find Insurer Search field', 'warning');
            return false;
        }
    }

    /**
     * Inject drag handles next to fee amount fields for swapping fees
     */
    function injectFeeSwapHandles() {
        console.log(LOG_PREFIX, "Injecting fee swap drag handles...");

        // Find all fee amount cells in the fees table
        // Pattern: TransactionFees_0__FeeAmount through TransactionFees_3__FeeAmount
        const feeIndices = [0, 1, 2, 3]; // POLICY, INSPECTION, BROKER, OTHER

        feeIndices.forEach(index => {
            // Check if drag handle already exists for this index
            const existingHandle = document.querySelector(`.fee-drag-handle[data-fee-index="${index}"]`);
            if (existingHandle) {
                console.log(LOG_PREFIX, `Drag handle already exists for fee index ${index}`);
                return;
            }

            // Find the hidden input (actual value)
            const hiddenInput = document.querySelector(`#TransactionFees_${index}__FeeAmount`);
            if (!hiddenInput) {
                console.warn(LOG_PREFIX, `Fee input not found for index ${index}`);
                return;
            }

            // Find the visible Kendo widget container
            const kendoContainer = hiddenInput.closest('.k-widget.k-numerictextbox');
            if (!kendoContainer) {
                console.warn(LOG_PREFIX, `Kendo container not found for fee index ${index}`);
                return;
            }

            // Get the parent div (policyFee, inspectionFee, etc.)
            const parentDiv = kendoContainer.parentElement;
            if (!parentDiv) {
                console.warn(LOG_PREFIX, `Parent div not found for fee index ${index}`);
                return;
            }

            // Create drag handle
            const dragHandle = document.createElement('span');
            dragHandle.className = 'fee-drag-handle';
            dragHandle.innerHTML = '⋮⋮'; // Grippy dots
            dragHandle.draggable = true;
            dragHandle.setAttribute('data-fee-index', index);
            dragHandle.title = 'Drag to swap with another fee';

            // Wrap both handle and kendo widget in a flex container for inline display
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display: flex; align-items: center; gap: 0px;';

            // Insert wrapper before kendo container
            parentDiv.insertBefore(wrapper, kendoContainer);

            // Move kendo container into wrapper and add handle (handle on the RIGHT)
            wrapper.appendChild(kendoContainer);
            wrapper.appendChild(dragHandle);

            console.log(LOG_PREFIX, `Drag handle injected for fee index ${index}`);
        });

        // Set up drag event handlers only once
        setupFeeDragHandlers();
    }

    /**
     * Set up drag-and-drop event handlers for fee handles
     */
    function setupFeeDragHandlers() {
        const dragHandles = document.querySelectorAll('.fee-drag-handle');
        let dragSourceIndex = null;

        dragHandles.forEach(handle => {
            // Skip if handlers already attached
            if (handle.hasAttribute('data-handlers-attached')) {
                return;
            }
            handle.setAttribute('data-handlers-attached', 'true');

            // dragstart - user starts dragging
            handle.addEventListener('dragstart', (e) => {
                dragSourceIndex = parseInt(handle.getAttribute('data-fee-index'));
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragSourceIndex);

                handle.classList.add('dragging');
                console.log(LOG_PREFIX, `Drag started from fee index ${dragSourceIndex}`);
            });

            // dragend - cleanup after drag completes or is cancelled
            handle.addEventListener('dragend', (e) => {
                handle.classList.remove('dragging');

                // Remove drop target highlighting from all rows
                document.querySelectorAll('.fee-drop-target').forEach(row => {
                    row.classList.remove('fee-drop-target');
                });

                dragSourceIndex = null;
                console.log(LOG_PREFIX, "Drag ended");
            });
        });

        // Set up drop zones on the fee table rows
        const feeRows = document.querySelectorAll('tbody tr');
        feeRows.forEach((row, rowIndex) => {
            // Check if this row has a fee amount input
            const feeInput = row.querySelector('input[id*="TransactionFees_"][id*="__FeeAmount"]');
            if (!feeInput) return;

            // Extract fee index from input ID (e.g., "TransactionFees_2__FeeAmount" -> 2)
            const match = feeInput.id.match(/TransactionFees_(\d+)__FeeAmount/);
            if (!match) return;

            const targetIndex = parseInt(match[1]);

            // Skip if handlers already attached
            if (row.hasAttribute('data-fee-drop-handlers')) {
                return;
            }
            row.setAttribute('data-fee-drop-handlers', 'true');

            // dragover - allow drop on valid targets
            row.addEventListener('dragover', (e) => {
                if (dragSourceIndex === null || dragSourceIndex === targetIndex) {
                    return; // Can't drop on same row
                }

                e.preventDefault(); // Allow drop
                e.dataTransfer.dropEffect = 'move';
            });

            // dragenter - highlight drop zone
            row.addEventListener('dragenter', (e) => {
                if (dragSourceIndex === null || dragSourceIndex === targetIndex) {
                    return;
                }

                row.classList.add('fee-drop-target');
            });

            // dragleave - remove highlight when leaving
            row.addEventListener('dragleave', (e) => {
                // Only remove if we're actually leaving the row (not entering a child)
                if (e.target === row || !row.contains(e.relatedTarget)) {
                    row.classList.remove('fee-drop-target');
                }
            });

            // drop - execute the swap
            row.addEventListener('drop', (e) => {
                e.preventDefault();

                if (dragSourceIndex === null || dragSourceIndex === targetIndex) {
                    return;
                }

                row.classList.remove('fee-drop-target');

                console.log(LOG_PREFIX, `Dropping fee ${dragSourceIndex} onto fee ${targetIndex}`);
                swapFeeValues(dragSourceIndex, targetIndex);
            });
        });

        console.log(LOG_PREFIX, `Fee drag handlers set up for ${dragHandles.length} handles`);
    }

    /**
     * Swap fee values and taxable checkboxes between two fee rows
     */
    function swapFeeValues(sourceIndex, targetIndex) {
        console.log(LOG_PREFIX, `Swapping fees: ${sourceIndex} <-> ${targetIndex}`);

        // Access page context jQuery/Kendo (content scripts run in isolated environment)
        const pageWindow = window.wrappedJSObject || window;
        const jQuery = pageWindow.jQuery;
        const kendo = pageWindow.kendo;

        // Check if jQuery is available (needed for Kendo widgets)
        if (!jQuery || typeof kendo === 'undefined') {
            console.error(LOG_PREFIX, "jQuery or Kendo not available - cannot swap fees");
            showNotification('⚠️ Cannot swap fees - required libraries not loaded', 'warning');
            return;
        }

        try {
            // Get Kendo NumericTextBox widgets
            const sourceWidget = jQuery(`#TransactionFees_${sourceIndex}__FeeAmount`).data('kendoNumericTextBox');
            const targetWidget = jQuery(`#TransactionFees_${targetIndex}__FeeAmount`).data('kendoNumericTextBox');

            if (!sourceWidget || !targetWidget) {
                console.error(LOG_PREFIX, "Kendo widgets not found for fee amounts");
                showNotification('⚠️ Fee widgets not found', 'warning');
                return;
            }

            // Get current values
            const sourceAmount = sourceWidget.value();
            const targetAmount = targetWidget.value();

            console.log(LOG_PREFIX, `Source amount: ${sourceAmount}, Target amount: ${targetAmount}`);

            // Get taxable checkboxes
            const sourceCheckbox = document.querySelector(`#TransactionFees_${sourceIndex}__IsTaxable`);
            const targetCheckbox = document.querySelector(`#TransactionFees_${targetIndex}__IsTaxable`);

            if (!sourceCheckbox || !targetCheckbox) {
                console.error(LOG_PREFIX, "Taxable checkboxes not found");
                showNotification('⚠️ Taxable checkboxes not found', 'warning');
                return;
            }

            const sourceTaxable = sourceCheckbox.checked;
            const targetTaxable = targetCheckbox.checked;

            console.log(LOG_PREFIX, `Source taxable: ${sourceTaxable}, Target taxable: ${targetTaxable}`);

            // Perform the swap
            sourceWidget.value(targetAmount);
            targetWidget.value(sourceAmount);

            sourceCheckbox.checked = targetTaxable;
            targetCheckbox.checked = sourceTaxable;

            // Trigger change events for form validation
            sourceWidget.trigger('change');
            targetWidget.trigger('change');

            // Visual feedback - highlight both rows briefly
            const sourceRow = document.querySelector(`#TransactionFees_${sourceIndex}__FeeAmount`).closest('tr');
            const targetRow = document.querySelector(`#TransactionFees_${targetIndex}__FeeAmount`).closest('tr');

            if (sourceRow && targetRow) {
                sourceRow.classList.add('fee-swapped');
                targetRow.classList.add('fee-swapped');

                setTimeout(() => {
                    sourceRow.classList.remove('fee-swapped');
                    targetRow.classList.remove('fee-swapped');
                }, 300);
            }

            console.log(LOG_PREFIX, "Fee swap completed successfully");
            showNotification('✓ Fees swapped', 'success');

        } catch (error) {
            console.error(LOG_PREFIX, "Error swapping fees:", error);
            showNotification('⚠️ Error swapping fees', 'warning');
        }
    }

    /**
     * Format search parameters for clipboard
     */
    function formatSearchParamsForClipboard(params) {
        let text = '[Policy Search Parameters]\n';
        if (params.brokerId) text += `Broker ID: ${params.brokerId}\n`;

        // Format insurer with full details: [SLA#] NAME (#NAIC#) - STATUS
        if (params.insurerName) {
            let insurerText = params.insurerName;
            if (params.slaNumber && params.naicNumber) {
                insurerText = `[${params.slaNumber}] ${params.insurerName} (#${params.naicNumber})`;
                if (params.insurerStatus) {
                    insurerText += ` - ${params.insurerStatus}`;
                }
            }
            text += `Insurer: ${insurerText}\n`;
        }

        text += `SLA Submission Date Range: ${params.dateFrom} to ${params.dateTo}\n`;
        text += '\n→ Parameters saved! Open Policy Search tab to auto-fill, or paste these values manually.';
        return text;
    }

    /**
     * Show notification with policy search info
     */
    function showPolicySearchNotification(params) {
        const notification = document.createElement('div');
        notification.id = 'policy-search-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10002;
            background: #17a2b8;
            color: white;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            max-width: 350px;
            box-sizing: border-box;
        `;

        let html = '<div style="font-weight: bold; margin-bottom: 8px;">✓ Search Parameters Ready!</div>';
        if (params.brokerId) html += `<div style="font-size: 12px; margin-bottom: 3px;">Broker: ${params.brokerId}</div>`;
        if (params.insurerName) {
            const truncatedName = params.insurerName.length > 35 ? params.insurerName.substring(0, 35) + '...' : params.insurerName;
            html += `<div style="font-size: 12px; margin-bottom: 3px;" title="${params.insurerName}">Insurer: ${truncatedName}</div>`;
        }
        html += `<div style="font-size: 12px; margin-bottom: 8px;">Date: ${params.dateFrom} to ${params.dateTo}</div>`;
        html += '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.3);">';
        html += '<button id="openPolicySearchBtn" style="background: white; color: #17a2b8; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: 600; width: 100%; font-size: 13px; box-sizing: border-box;">Open Policy Search →</button>';
        html += '</div>';
        html += '<div style="margin-top: 8px; font-size: 11px; opacity: 0.85; line-height: 1.3;">Copied to clipboard. Will auto-fill when search opens.</div>';

        notification.innerHTML = html;
        document.body.appendChild(notification);

        // Add click handler for open button
        document.getElementById('openPolicySearchBtn').addEventListener('click', () => {
            window.open('/policy/search', '_blank');
            notification.remove();
        });

        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'fadeOut 0.3s ease-out';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 10000);
    }

    /**
     * Show simple notification
     */
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10002;
            background: ${type === 'warning' ? '#f0ad4e' : '#5bc0de'};
            color: white;
            border-radius: 8px;
            padding: 15px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            max-width: 350px;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    /**
     * Toggle between marking all items as checked and restoring previous state
     */
    function toggleMarkChecked() {
        const keys = getStorageKeys();
        ext.storage.local.get([keys.checklistState, keys.uiState, keys.viewMode], (result) => {
            const state = result[keys.checklistState] || checklist.map(() => ({ processed: false, skipped: false }));
            const btn = document.getElementById('btnMarkChecked');

            // Check if we're in "marked" mode (have a saved state to restore)
            if (preMarkCheckedState !== null) {
                // UNMARK: Restore previous state
                console.log(LOG_PREFIX, 'Restoring pre-mark-checked state');

                ext.storage.local.set({ [keys.checklistState]: preMarkCheckedState }, () => {
                    // Force update tracking progress to original percentage (bypassing formIsComplete check)
                    if (window.trackingHelper && window.trackingHelper.updateProgress) {
                        const checkedCount = preMarkCheckedState.filter(item => item.processed).length;
                        const total = preMarkCheckedState.length;
                        const isReview = window.trackingHelper.isReviewMode || false;
                        console.log(LOG_PREFIX, `Force restoring progress to ${checkedCount}/${total} via Unmark Checked button`);
                        window.trackingHelper.updateProgress(checkedCount, total, isReview, true); // force=true
                    }

                    // IMPORTANT: Reset formIsComplete flag to allow future tracking updates
                    if (window.trackingHelper) {
                        window.trackingHelper.formIsComplete = false;
                        console.log(LOG_PREFIX, 'Reset formIsComplete = false to allow progress updates');
                    }

                    // Update UI
                    updateAndBroadcast(preMarkCheckedState, result[keys.uiState], result[keys.viewMode], true); // skipTrackingUpdate=true

                    // Clear saved state
                    preMarkCheckedState = null;

                    // Update button
                    if (btn) {
                        btn.textContent = 'Mark Checked';
                        btn.title = 'Check all unchecked items';
                        btn.className = 'btn btn-success';
                    }

                    console.log(LOG_PREFIX, 'State restored successfully');
                });
            } else {
                // MARK: Save current state and mark all items
                console.log(LOG_PREFIX, 'Saving state and marking all unchecked items');

                // Deep clone the current state before modifying
                preMarkCheckedState = JSON.parse(JSON.stringify(state));

                let markedCount = 0;
                state.forEach((item, index) => {
                    if (!item.processed && !item.skipped) {
                        item.processed = true;
                        markedCount++;
                    }
                });

                if (markedCount > 0) {
                    ext.storage.local.set({ [keys.checklistState]: state }, () => {
                        console.log(LOG_PREFIX, `Marked ${markedCount} items as checked`);

                        // Force update tracking progress to 100% (bypassing formIsComplete check)
                        if (window.trackingHelper && window.trackingHelper.updateProgress) {
                            const checkedCount = state.filter(item => item.processed).length;
                            const total = state.length;
                            const isReview = window.trackingHelper.isReviewMode || false;
                            console.log(LOG_PREFIX, 'Force updating progress to 100% via Mark Checked button');
                            window.trackingHelper.updateProgress(checkedCount, total, isReview, true); // force=true
                        }

                        // Set formIsComplete = true to prevent subsequent automatic updates
                        if (window.trackingHelper) {
                            window.trackingHelper.formIsComplete = true;
                            console.log(LOG_PREFIX, 'Set formIsComplete = true to lock progress at 100%');
                        }

                        // Update UI
                        updateAndBroadcast(state, result[keys.uiState], result[keys.viewMode], true); // skipTrackingUpdate=true

                        // Update button to show undo option
                        if (btn) {
                            btn.textContent = 'Unmark Checked';
                            btn.title = 'Restore previous checkbox state';
                            btn.className = 'btn btn-warning';
                        }
                    });
                } else {
                    console.log(LOG_PREFIX, "All items already checked");
                    // Clear the saved state since nothing changed
                    preMarkCheckedState = null;
                }
            }
        });
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (visibilityRecoveryInterval) {
            clearInterval(visibilityRecoveryInterval);
            visibilityRecoveryInterval = null;
        }
        stopPeriodicRecoveryCheck();
        stopPositionObserver();
        removeAllHighlightZones();
        removeAllZoneCheckboxes();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            init().catch(err => console.error(LOG_PREFIX, "Initialization failed:", err));
        });
    } else {
        init().catch(err => console.error(LOG_PREFIX, "Initialization failed:", err));
    }

})();