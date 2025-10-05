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
    let isProgrammaticUpdate = false; // Flag to prevent change event loops
    let isResetting = false; // Flag to track reset in progress
    let highlightZones = new Map(); // Track created zone divs by index
    let zoneCheckboxes = new Map(); // Track zone checkboxes by index: Map<itemIndex, Array<{checkbox, zoneIndex}>>

    const RECONNECT_DELAY = 2000; // 2 seconds

    // Configuration will be loaded dynamically
    let checklist = [];
    let config = null;
    let configLoaded = false;

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

    function handleDisconnect() {
        isConnected = false;
        port = null;

        // Attempt to reconnect after a delay
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }

        reconnectTimer = setTimeout(() => {
            console.log(LOG_PREFIX, "Attempting to reconnect...");
            connect();

            // If reconnected, broadcast current state
            if (isConnected && myTabId) {
                const keys = getStorageKeys();
                ext.storage.local.get(keys.checklistState, (result) => {
                    if (result[keys.checklistState]) {
                        broadcastUpdate(result[keys.checklistState]);
                    }
                });
            }
        }, RECONNECT_DELAY);
    }

    function getStorageKeys() {
        return {
            checklistState: `checklistState_${myTabId}`,
            uiState: `uiState_${myTabId}`,
            viewMode: `viewMode_${myTabId}`
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

    function initializeWithTabId() {
        const keys = getStorageKeys();
        ext.storage.local.get([keys.checklistState, keys.uiState, keys.viewMode, 'defaultUIVisible', 'defaultViewMode'], (result) => {
            let storedState = result[keys.checklistState];
            let uiState = result[keys.uiState];
            let viewMode = result[keys.viewMode];

            if (!uiState) {
                // Use the defaultUIVisible setting, defaulting to true if not set
                const defaultVisible = result.defaultUIVisible !== false;
                uiState = { visible: defaultVisible };
                ext.storage.local.set({ [keys.uiState]: uiState });
            }

            if (!viewMode) {
                // Use defaultViewMode, or fall back to 'single'
                viewMode = result.defaultViewMode || 'single';
                ext.storage.local.set({ [keys.viewMode]: viewMode });
            }

            if (!storedState || storedState.length !== checklist.length) {
                storedState = checklist.map(() => ({ processed: false, skipped: false }));
                ext.storage.local.set({ [keys.checklistState]: storedState }, () => {
                    injectConfirmationCheckboxes(storedState);
                    attachListenersToPageElements();
                    updateAndBroadcast(storedState, uiState, viewMode);
                    setTimeout(() => {
                        isInitializing = false;
                    }, 500);
                });
            } else {
                injectConfirmationCheckboxes(storedState);
                attachListenersToPageElements();
                updateAndBroadcast(storedState, uiState, viewMode);
                setTimeout(() => {
                    isInitializing = false;
                }, 500);
            }
        });
        ext.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                const keys = getStorageKeys();
                if (changes[keys.checklistState]) {
                    if (changes[keys.checklistState].newValue) {
                        // Skip if we're in the middle of a reset
                        if (isResetting) {
                            return;
                        }
                        // Normal state update
                        ext.storage.local.get([keys.uiState, keys.viewMode], (result) => {
                            const state = changes[keys.checklistState].newValue;
                            updateAndBroadcast(state, result[keys.uiState], result[keys.viewMode]);
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
        try {
            port.postMessage({
                action: 'updateDisplay',
                fieldData: fieldData,
                index: nextIndex,
                policyNumber: policyNumber,
                checklistNames: checklistNames,
                state: state
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
        } else if (step.type === 'custom') {
            try {
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
            } catch (e) {
                console.error(LOG_PREFIX, `Error parsing custom table ${step.table_id}:`, e);
                fieldData.fields.push({ name: `Error parsing ${step.name}`, type: 'error', value: '' });
            }
        }
        return fieldData;
    }

    function updateAndBroadcast(state, uiState, viewMode) {
        viewMode = viewMode || 'single';
        const nextIndex = findNextStep(state);
        const fieldData = getFieldData(nextIndex);
        // Always re-render to ensure view mode switches properly
        currentIndex = nextIndex;
        renderOnPageUI(fieldData, state, uiState, viewMode);
        broadcastUpdate(state);
        updateItemVisuals(state);
    }

    function updateOnPageUIValues(fieldData) {
        if (!fieldData || !fieldData.fields) return;
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

    function renderOnPageUI(fieldData, state, uiState, viewMode) {
        viewMode = viewMode || 'single';
        let container = document.getElementById('processing-checklist-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'processing-checklist-container';
            container.style.cssText = `position: fixed !important; top: 20px !important; right: 20px !important; z-index: 10000 !important; background: #fff !important; border: 2px solid #007cba !important; border-radius: 8px !important; padding: 15px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important; font-family: Arial, sans-serif !important; font-size: 14px !important; max-width: 300px !important; min-width: 250px !important;`;
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

        if (!fieldData) {
            container.innerHTML = '<div style="color: #28a745; font-weight: bold; text-align: center;">All fields checked!</div>';
            return;
        }
        let fieldsHtml = fieldData.fields.map((field, index) => {
            let inputHtml;
            if (field.type === 'select') {
                const options = field.options.map(opt => `<option value="${opt.value}" ${field.value === opt.value ? 'selected' : ''}>${opt.text}</option>`).join('');
                inputHtml = `<select class="on-page-input" data-field-index="${index}" style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;">${options}</select>`;
            } else if (field.type === 'checkbox') {
                return `<label style="display: flex; align-items: center;"><input type="checkbox" style="width: fit-content;" class="on-page-input" data-field-index="${index}" ${field.value ? 'checked' : ''}> <span style="margin-left: 5px; width: 100%;">${field.name}</span></label>`;
            } else if (field.type === 'radio') {
                return `<label style="display: flex; align-items: center;"><input type="radio" style="width: fit-content;" class="on-page-input" name="${fieldData.name}" data-field-index="${index}" ${field.value ? 'checked' : ''}> <span style="margin-left: 5px; width: 100%;">${field.name}</span></label>`;
            } else if (field.type === 'virtual') {
                return `<div style="margin-bottom: 8px;"><label style="font-weight: bold; display: block; margin-bottom: 4px;">${field.name}: </label><span>${field.value}</span></div>`;
            } else if (field.type === 'labelWithDivText') {
                return `<div style="display: flex; align-items: center;"><label style="font-weight: bold;">${field.labelText}</label><div style="margin-left: 8px; margin-top:0px; color: #333;">${field.divText}</div></div>`;
            } else if (field.type === 'kendo_widget') {
                // Handle Kendo widget - will be rendered separately after HTML insertion
                return `<div class="kendo-widget-placeholder" data-field-index="${index}" data-field-selector="${field.selector}"></div>`;
            } else {
                inputHtml = `<input type="text" class="on-page-input" data-field-index="${index}" value="${field.value || ''}" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">`;
            }
            return `<div style="margin-bottom: 8px;"><label style="font-weight: bold; display: block; margin-bottom: 4px;">${field.name}</label>${inputHtml}</div>`;
        }).join('');

        container.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px; color: #007cba;">${fieldData.name}</div>
            <div>${fieldsHtml}</div>
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;">
                <button id="confirm-button-page">✓</button>
                <button id="skip-button-page">Skip</button>
            </div>`;
        document.getElementById('confirm-button-page').addEventListener('click', () => handleConfirmField(currentIndex));
        document.getElementById('skip-button-page').addEventListener('click', () => handleSkipField(currentIndex));
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
            <div style="font-weight: bold; margin-bottom: 12px; color: #007cba;">Checklist Progress</div>
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
                initializeWithTabId();
                break;
            case 'popout-ready':
                const keys = getStorageKeys();
                ext.storage.local.get(keys.checklistState, r => broadcastUpdate(r[keys.checklistState]));
                break;
            case 'updateFieldValue': handleUpdateFieldValue(message, false); break;
            case 'confirmField': handleConfirmField(message.index); break;
            case 'skipField': handleSkipField(message.index); break;
            case 'toggleUI': toggleOnPageUI(); break;
            case 'changeViewMode':
                // View mode changed from menu - update storage
                if (message.mode) {
                    const keys = getStorageKeys();
                    ext.storage.local.set({ [keys.viewMode]: message.mode });
                }
                break;
        }
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
        ext.storage.local.get(keys.checklistState, (result) => {
            const newState = [...result[keys.checklistState]];
            newState[index] = { processed, skipped };
            ext.storage.local.set({ [keys.checklistState]: newState });
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
                            ext.storage.local.get(keys.checklistState, r => updateAndBroadcast(r[keys.checklistState]));
                        });
                    }
                });
            }
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
            // Skip traditional checkbox injection if this item uses zone checkboxes
            if (itemUsesZoneCheckboxes(index)) {
                console.log(LOG_PREFIX, `Skipping traditional checkbox for item "${step.name}" - using zone checkboxes`);
                // Inject zone checkboxes instead
                injectZoneCheckboxes(index, state);
                return;
            }

            const container = getElementForStep(index);
            if (container && !document.getElementById(`checklist-confirm-cb-${index}`)) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `checklist-confirm-cb-${index}`;
                checkbox.classList.add('processing-checklist-checkbox');
                if (step.name === "NAICS Code") {
                    checkbox.classList.add("naics-checkbox");
                }
                checkbox.addEventListener('change', () => {
                    if (isInitializing || isProgrammaticUpdate) return;
                    if (checkbox.checked) handleConfirmField(index); else unconfirmField(index);
                });
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
     */
    function injectZoneCheckboxes(index, state) {
        const step = checklist[index];
        if (!step.highlight_zones || step.highlight_zones.length === 0) return;

        // Don't re-inject if already exists
        if (zoneCheckboxes.has(index)) return;

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
        }
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

    function updateItemVisuals(state) {
        isProgrammaticUpdate = true;
        state.forEach((itemState, index) => {
            const step = checklist[index];

            // Handle highlight zones if defined
            if (step && step.highlight_zones && step.highlight_zones.length > 0) {
                updateHighlightZones(index, itemState);
            } else {
                // Fallback to container highlighting
                const container = getElementForStep(index);
                if (container) {
                    container.classList.remove('skipped-item', 'confirmed-item');
                    if (itemState.skipped) {
                        container.classList.add('skipped-item');
                    } else if (itemState.processed) {
                        container.classList.add('confirmed-item');
                    }
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
        }, 0);
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
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'zone-checkbox';
            checkbox.setAttribute('data-zone-checkbox', 'true');
            checkbox.setAttribute('data-item-index', itemIndex);
            checkbox.setAttribute('data-zone-index', zoneIndex);
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
     */
    function updateHighlightZones(index, itemState) {
        // Remove existing zones for this index (but NOT checkboxes - they stay visible)
        removeHighlightZones(index);

        const step = checklist[index];
        if (!step.highlight_zones || step.highlight_zones.length === 0) return;

        // Determine state class
        let stateClass = '';
        if (itemState.processed) {
            stateClass = 'confirmed-zone';
        } else if (itemState.skipped) {
            stateClass = 'skipped-zone';
        }

        // If no state, don't create zones (but checkboxes remain visible)
        if (!stateClass) return;

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
        }
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
                console.warn(LOG_PREFIX,
                    `Item "${checklist[itemIndex].name}" (index ${itemIndex}), zone ${zoneIndex}: ` +
                    `Element not found for ${edgeName} edge (selector: "${edgeConfig.selector}")`
                );
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
        ext.storage.local.get(keys.checklistState, (result) => {
            if (result[keys.checklistState]) {
                updateItemVisuals(result[keys.checklistState]);
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

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
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