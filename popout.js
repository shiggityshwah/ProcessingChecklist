/*************************************************************************************************
 *  popout.js - The script for the popout window.
/*************************************************************************************************/
(function() {
    "use strict";
    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    let port = null;
    let currentIndex = -1;
    let boundTabId = null;
    let currentWindowId = null;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let storagePollingTimer = null;
    let lastKnownState = null;
    let isConnected = false;
    let checklistNames = []; // Store checklist item names

    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_RECONNECT_DELAY = 1000; // 1 second
    const MAX_RECONNECT_DELAY = 30000; // 30 seconds
    const STORAGE_POLL_INTERVAL = 2000; // 2 seconds

    function connect() {
        try {
            port = ext.runtime.connect({ name: "popout" });
            port.onMessage.addListener(handleMessage);
            port.onDisconnect.addListener(handleDisconnect);

            // Get current window ID
            ext.windows.getCurrent().then((window) => {
                currentWindowId = window.id;
                // Send initialization with tab ID and window ID
                port.postMessage({
                    action: "popout-init",
                    tabId: boundTabId,
                    windowId: currentWindowId
                });

                // Connection successful
                isConnected = true;
                reconnectAttempts = 0;
                stopStoragePolling();
                clearReconnectTimer();
            });
        } catch (error) {
            handleDisconnect();
        }
    }

    function handleDisconnect() {
        isConnected = false;
        port = null;

        // Check if tab still exists before attempting reconnection
        ext.tabs.get(boundTabId).then(() => {
            // Tab exists, attempt reconnection
            attemptReconnect();
        }).catch(() => {
            // Tab closed
            displayError("Connection lost. Tab has been closed.");
            stopStoragePolling();
        });
    }

    function attemptReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            displayError("Connection lost. Falling back to storage sync.");
            startStoragePolling();
            return;
        }

        const delay = Math.min(
            BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
            MAX_RECONNECT_DELAY
        );

        reconnectAttempts++;

        clearReconnectTimer();
        reconnectTimer = setTimeout(() => {
            connect();
        }, delay);

        // Start storage polling as fallback while reconnecting
        if (!storagePollingTimer) {
            startStoragePolling();
        }
    }

    function clearReconnectTimer() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function startStoragePolling() {
        if (storagePollingTimer) return;

        storagePollingTimer = setInterval(() => {
            const storageKey = `checklistState_${boundTabId}`;
            ext.storage.local.get(storageKey, (result) => {
                if (result[storageKey]) {
                    const newState = result[storageKey];
                    // Check if state has changed
                    if (JSON.stringify(newState) !== JSON.stringify(lastKnownState)) {
                        lastKnownState = newState;
                        handleStateChange(newState);
                    }
                }
            });
        }, STORAGE_POLL_INTERVAL);
    }

    function stopStoragePolling() {
        if (storagePollingTimer) {
            clearInterval(storagePollingTimer);
            storagePollingTimer = null;
        }
    }

    function init() {
        // Parse tab ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        boundTabId = parseInt(urlParams.get('tabId'), 10);

        if (!boundTabId) {
            displayError("No tab ID specified. Please open from the menu.");
            return;
        }

        connect();

        const storageKey = `checklistState_${boundTabId}`;
        const viewModeKey = `viewMode_${boundTabId}`;

        ext.storage.local.get([storageKey, viewModeKey, 'defaultViewMode'], (result) => {
            if (result[storageKey]) {
                handleStateChange(result[storageKey], result[viewModeKey] || result.defaultViewMode || 'single');
            }
        });

        ext.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                if (changes[storageKey]) {
                    const newValue = changes[storageKey].newValue;
                    if (newValue) {
                        ext.storage.local.get(viewModeKey, (result) => {
                            handleStateChange(newValue, result[viewModeKey] || 'single');
                        });
                    }
                    // If newValue is undefined, storage was cleared (reset)
                    // The content script will recreate it and trigger another change
                } else if (changes[viewModeKey]) {
                    // View mode changed - re-render
                    ext.storage.local.get(storageKey, (result) => {
                        if (result[storageKey]) {
                            handleStateChange(result[storageKey], changes[viewModeKey].newValue || 'single');
                        }
                    });
                }
            }
        });
        renderField(null, null, 'single'); // Initial loading state
    }

    function handleStateChange(state, viewMode) {
        viewMode = viewMode || 'single';
        const nextIndex = findNextStep(state);

        // Always update lastKnownState
        lastKnownState = state;

        if (viewMode === 'full') {
            // Render full checklist view
            renderFullChecklistViewPopout(state);
            return;
        }

        // Single-step view
        if (port && isConnected) {
            port.postMessage({ action: 'getUpdatedFieldData', index: nextIndex });
        } else {
            // Fallback: When disconnected, show a simplified view
            // The popout will show basic info until reconnection
            if (nextIndex === -1) {
                renderField(null, null, viewMode);
            } else {
                // Show placeholder until we can get real data
                const placeholderData = {
                    name: `Step ${nextIndex + 1} (Reconnecting...)`,
                    fields: []
                };
                if (nextIndex !== currentIndex) {
                    currentIndex = nextIndex;
                    renderField(placeholderData, null, viewMode);
                }
            }
        }
    }

    function getFieldDataFromState(state, index) {
        // This is a simplified fallback that shows basic state info
        // when the port is disconnected
        if (index === -1) return null;

        // Read the stored field data if available
        ext.storage.local.get(`fieldData_${boundTabId}_${index}`, (result) => {
            const key = `fieldData_${boundTabId}_${index}`;
            if (result[key]) {
                return result[key];
            }
        });

        // Return basic structure if no cached data
        return {
            name: `Step ${index + 1}`,
            fields: []
        };
    }

    function handleMessage(message) {
        // Respond to ping with pong (keep-alive)
        if (message.action === 'ping') {
            if (port && isConnected) {
                port.postMessage({ action: 'pong' });
            }
            return;
        }

        // Handle view mode change
        if (message.action === 'changeViewMode') {
            const viewModeKey = `viewMode_${boundTabId}`;
            ext.storage.local.set({ [viewModeKey]: message.mode });
            return;
        }

        // Handle reset complete message
        if (message.action === 'resetComplete') {
            const display = document.getElementById('next-field-display');
            if (display) {
                display.innerHTML = '<div style="text-align: center; padding: 20px;"><div style="color: #007cba; font-weight: bold; margin-bottom: 10px;">Checklist Reset</div><div style="margin-bottom: 10px;">Please refresh the page to continue</div><button id="refresh-popout-button" style="background-color: #007cba; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;">Refresh Page</button></div>';

                const refreshBtn = document.getElementById('refresh-popout-button');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        // Get the bound tab and reload it
                        ext.tabs.reload(boundTabId);
                    });
                }
            }
            return;
        }

        if (message.action === 'updateDisplay') {
            // Store checklist names for full view
            if (message.checklistNames) {
                checklistNames = message.checklistNames;
            }
            if (message.state) {
                lastKnownState = message.state;
            }

            // Check current view mode
            const viewModeKey = `viewMode_${boundTabId}`;
            ext.storage.local.get(viewModeKey, (result) => {
                const viewMode = result[viewModeKey] || 'single';

                if (viewMode === 'full') {
                    renderFullChecklistViewPopout(message.state || lastKnownState);
                } else {
                    if (message.index !== currentIndex) {
                        currentIndex = message.index;
                        renderField(message.fieldData, message.policyNumber, viewMode);
                    } else {
                        updateFieldValues(message.fieldData);
                    }
                    // Update policy number if provided
                    if (message.policyNumber !== undefined) {
                        updatePolicyNumber(message.policyNumber);
                    }
                }
            });
        }
    }

    function updatePolicyNumber(policyNumber) {
        const policyNumberDisplay = document.getElementById('policy-number-display');
        if (policyNumberDisplay) {
            policyNumberDisplay.textContent = policyNumber || 'No Policy #';
        }
    }

    function findNextStep(state) {
        if (!state || !Array.isArray(state)) return -1;
        for (let i = 0; i < state.length; i++) {
            if (!state[i].processed && !state[i].skipped) {
                return i;
            }
        }
        for (let i = 0; i < state.length; i++) {
            if (state[i].skipped) {
                return i;
            }
        }
        return -1;
    }

    function updateFieldValues(fieldData) {
        if (!fieldData || !fieldData.fields) return;
        fieldData.fields.forEach((field, index) => {
            const inputElement = document.querySelector(`.display-input[data-field-index="${index}"]`);
            if (inputElement) {
                if (inputElement.type === 'checkbox') {
                    if (inputElement.checked !== field.value) inputElement.checked = field.value;
                } else {
                    if (inputElement.value !== field.value) inputElement.value = field.value;
                }
            }
        });
    }

    function renderFullChecklistViewPopout(state) {
        const display = document.getElementById('next-field-display');
        if (!display) return;

        if (!state) return;

        const checklistCount = state.length;
        let itemsHtml = '';

        for (let i = 0; i < checklistCount; i++) {
            const itemState = state[i];
            let statusClass = '';
            if (itemState.processed) {
                statusClass = 'confirmed';
            } else if (itemState.skipped) {
                statusClass = 'skipped';
            }

            const itemName = checklistNames[i] || `Item ${i + 1}`;

            itemsHtml += `
                <div class="full-checklist-item ${statusClass}" style="display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
                    <input type="checkbox" class="full-checklist-item-checkbox" data-item-index="${i}" ${itemState.processed ? 'checked' : ''} style="margin-right: 10px; cursor: pointer; flex-shrink: 0;">
                    <span class="full-checklist-item-name" style="flex: 1; font-size: 13px; color: ${itemState.processed ? '#28a745' : (itemState.skipped ? '#ffc107' : '#333')};">${itemName}</span>
                </div>
            `;
        }

        display.innerHTML = `
            <div class="step-title">Checklist Progress</div>
            <div style="max-height: 500px; overflow-y: auto; display: flex; flex-direction: column;">${itemsHtml}</div>
        `;

        // Attach event listeners
        display.querySelectorAll('.full-checklist-item-checkbox').forEach(checkbox => {
            const itemIndex = parseInt(checkbox.getAttribute('data-item-index'), 10);
            checkbox.addEventListener('change', () => {
                const storageKey = `checklistState_${boundTabId}`;
                ext.storage.local.get(storageKey, (result) => {
                    if (result[storageKey]) {
                        const newState = [...result[storageKey]];
                        newState[itemIndex] = {
                            processed: checkbox.checked,
                            skipped: false
                        };
                        ext.storage.local.set({ [storageKey]: newState });
                    }
                });
            });
        });

        resizeWindow();
    }

    function renderField(fieldData, policyNumber, viewMode) {
        viewMode = viewMode || 'single';
        const display = document.getElementById('next-field-display');
        if (!display) return;

        // Update policy number display
        updatePolicyNumber(policyNumber);

        if (!fieldData) {
            display.innerHTML = '<div class="completion-message">All fields checked!</div>';
            resizeWindow();
            return;
        }

        let fieldsHtml = fieldData.fields.map((field, index) => {
            let inputHtml;
            if (field.type === 'select') {
                const options = field.options.map(opt => `<option value="${opt.value}" ${field.value === opt.value ? 'selected' : ''}>${opt.text}</option>`).join('');
                inputHtml = `<select class="display-input" data-field-index="${index}">${options}</select>`;
                return `<div class="field-container"><label class="field-label">${field.name}</label>${inputHtml}</div>`;
            } else if (field.type === 'checkbox') {
                return `<label class="checkbox-field"><input type="checkbox" class="display-input" data-field-index="${index}" ${field.value ? 'checked' : ''}> <span>${field.name}</span></label>`;
            } else if (field.type === 'radio') {
                return `<label class="checkbox-field"><input type="radio" class="display-input" name="${fieldData.name}" data-field-index="${index}" ${field.value ? 'checked' : ''}> <span>${field.name}</span></label>`;
            } else if (field.type === 'virtual') {
                return `<div class="field-container"><label class="field-label">${field.name}:</label><span class="virtual-value">${field.value}</span></div>`;
            } else if (field.type === 'labelWithDivText') {
                return `<div class="field-container label-with-text"><label class="field-label">${field.labelText}</label><span class="virtual-value">${field.divText}</span></div>`;
            } else if (field.type === 'kendo_widget') {
                // Handle Kendo widget - will be rendered separately after HTML insertion
                return `<div class="field-container"><label class="field-label">${field.name}</label><div class="kendo-widget-placeholder" data-field-index="${index}" data-field-selector="${field.selector}"></div></div>`;
            } else {
                inputHtml = `<input type="text" class="display-input" data-field-index="${index}" value="${field.value || ''}">`;
                return `<div class="field-container"><label class="field-label">${field.name}</label>${inputHtml}</div>`;
            }
        }).join('');

        display.innerHTML = `
            <div class="step-title">${fieldData.name}</div>
            <div class="fields-container">${fieldsHtml}</div>
            <div class="button-row">
                <button id="skip-button" class="skip-btn">Skip</button>
                <button id="confirm-button" class="confirm-btn">✓ Confirm</button>
            </div>
        `;
        setupEventListeners(fieldData);

        // Initialize Kendo widgets after HTML is inserted
        renderKendoWidgetsPopout(display, fieldData);

        resizeWindow();
    }

    function renderKendoWidgetsPopout(container, fieldData) {
        const placeholders = container.querySelectorAll('.kendo-widget-placeholder');
        placeholders.forEach(placeholder => {
            const fieldIndex = parseInt(placeholder.getAttribute('data-field-index'), 10);
            const field = fieldData.fields[fieldIndex];
            const selector = field.selector;

            // Check if KendoWidgetUtils is available
            if (typeof KendoWidgetUtils === 'undefined') {
                console.warn("[Popout] KendoWidgetUtils not loaded - falling back to basic input");
                placeholder.innerHTML = `<input type="text" class="display-input" data-field-index="${fieldIndex}" value="${field.value || ''}">`;
                return;
            }

            // Popout doesn't have direct access to page widgets, so use read-only display
            console.log("[Popout] Rendering read-only display for Kendo widget:", field.name);
            placeholder.innerHTML = KendoWidgetUtils.createReadOnlyDisplay(field, field.value);
            KendoWidgetUtils.setupFocusButtons(placeholder);
        });
    }

    function resizeWindow() {
        // Wait for DOM to render and styles to apply
        setTimeout(() => {
            // Get the next-field-display element which contains our content
            const displayElement = document.getElementById('next-field-display');
            if (!displayElement) return;

            // Use getBoundingClientRect for accurate height measurement
            const displayRect = displayElement.getBoundingClientRect();

            // Also check scrollHeight in case content overflows
            const scrollHeight = displayElement.scrollHeight;

            // Use the larger of the two measurements
            const contentHeight = Math.max(displayRect.height, scrollHeight);

            // Calculate body padding and policy number display height
            const bodyStyles = window.getComputedStyle(document.body);
            const paddingTop = parseInt(bodyStyles.paddingTop) || 0;
            const paddingBottom = parseInt(bodyStyles.paddingBottom) || 0;

            // Account for policy number display at top
            const policyDisplay = document.getElementById('policy-number-display');
            const policyHeight = policyDisplay ? policyDisplay.offsetHeight : 0;

            // Calculate total needed height
            const neededHeight = contentHeight + paddingTop + paddingBottom + policyHeight;

            // Update window size with buffer for window chrome
            // Use 30px buffer (reduced from 70px to eliminate gap)
            // Cap at 850px and add scrollbar if content exceeds
            ext.windows.getCurrent().then((window) => {
                const calculatedHeight = neededHeight + 30;
                const finalHeight = Math.round(Math.min(Math.max(calculatedHeight, 180), 850));
                console.log('[Popout Resize]', {
                    contentHeight,
                    scrollHeight,
                    displayRectHeight: displayRect.height,
                    paddingTop,
                    paddingBottom,
                    policyHeight,
                    neededHeight,
                    calculatedHeight,
                    finalHeight
                });
                ext.windows.update(window.id, {
                    width: 300,
                    height: finalHeight // Now properly rounded to integer
                });
            });
        }, 200);
    }

    function displayError(message) {
        const display = document.getElementById('next-field-display');
        if (display) {
            display.innerHTML = `<div class="error-message">${message}</div>`;
            resizeWindow();
        }
    }

    function setupEventListeners(fieldData) {
        document.getElementById('confirm-button').addEventListener('click', () => {
            if (port && isConnected) {
                port.postMessage({ action: 'confirmField', index: currentIndex });
            } else {
                // Fallback: update storage directly
                const storageKey = `checklistState_${boundTabId}`;
                ext.storage.local.get(storageKey, (result) => {
                    if (result[storageKey]) {
                        const newState = [...result[storageKey]];
                        newState[currentIndex] = { processed: true, skipped: false };
                        ext.storage.local.set({ [storageKey]: newState });
                    }
                });
            }
        });

        document.getElementById('skip-button').addEventListener('click', () => {
            if (port && isConnected) {
                port.postMessage({ action: 'skipField', index: currentIndex });
            } else {
                // Fallback: update storage directly
                const storageKey = `checklistState_${boundTabId}`;
                ext.storage.local.get(storageKey, (result) => {
                    if (result[storageKey]) {
                        const newState = [...result[storageKey]];
                        newState[currentIndex] = { processed: false, skipped: true };
                        ext.storage.local.set({ [storageKey]: newState });
                    }
                });
            }
        });

        document.querySelectorAll('.display-input').forEach(input => {
            const fieldIndex = parseInt(input.getAttribute('data-field-index'), 10);
            const field = fieldData.fields[fieldIndex];
            const eventType = (field.type === 'checkbox' || field.type === 'select') ? 'change' : 'input';
            input.addEventListener(eventType, () => {
                const value = (field.type === 'checkbox') ? input.checked : input.value;
                if (port && isConnected) {
                    port.postMessage({ action: 'updateFieldValue', index: currentIndex, fieldIndex, value });
                }
                // Note: field value updates require content script access to DOM
                // so we can't provide a direct fallback here
            });
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
