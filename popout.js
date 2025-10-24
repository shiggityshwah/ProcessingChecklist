/*************************************************************************************************
 *  popout.js - The script for the popout window.
/*************************************************************************************************/
(function() {
    "use strict";
    const logger = Logger.create('Popout');
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

        // Handle policy number update
        if (message.action === 'updatePolicyNumber') {
            updatePolicyNumber(message.policyNumber);
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
                        renderField(message.fieldData, message.policyNumber, viewMode, message.canGoBack);
                    } else {
                        updateFieldValues(message.fieldData);
                        // Update back button state
                        updateBackButtonState(message.canGoBack);
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

    function updateBackButtonState(canGoBack) {
        const backButton = document.getElementById('back-button');
        if (backButton) {
            backButton.disabled = !canGoBack;
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
        if (!fieldData) return;

        // Handle table type
        if (fieldData.type === 'table') {
            const cellInputs = document.querySelectorAll('.table-cell-input-popout');
            cellInputs.forEach(input => {
                const rowIndex = parseInt(input.getAttribute('data-row'), 10);
                const colIndex = parseInt(input.getAttribute('data-col'), 10);
                const value = fieldData.tableData?.rows[rowIndex]?.[`col${colIndex}`];

                if (value !== undefined) {
                    if (input.type === 'checkbox') {
                        if (input.checked !== value) input.checked = value;
                    } else {
                        // Only update if different and not currently focused
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
            const escapedItemName = window.ProcessingChecklistUtils ?
                window.ProcessingChecklistUtils.escapeHtml(itemName) : itemName;

            itemsHtml += `
                <div class="full-checklist-item ${statusClass}" style="display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
                    <input type="checkbox" class="full-checklist-item-checkbox" data-item-index="${i}" ${itemState.processed ? 'checked' : ''} style="margin-right: 10px; cursor: pointer; flex-shrink: 0;">
                    <span class="full-checklist-item-name" style="flex: 1; font-size: 13px; color: ${itemState.processed ? '#28a745' : (itemState.skipped ? '#ffc107' : '#333')};">${escapedItemName}</span>
                </div>
            `;
        }

        display.innerHTML = `
            <div class="step-title">Checklist Progress</div>
            <div style="max-height: 850px; overflow-y: auto; display: flex; flex-direction: column;">${itemsHtml}</div>
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

        // Request policy number update when rendering full view
        if (port && isConnected) {
            port.postMessage({ action: 'getPolicyNumber' });
        }

        resizeWindow();
    }

    /**
     * Render fees table UI for display in popout
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
                               class="fee-input-taxable-popout"
                               style="cursor: pointer;">
                    </div>
                    <div class="fee-amount">
                        <input type="text"
                               value="${fee.amount}"
                               data-fee-index="${fee.index}"
                               data-fee-type="amount"
                               data-amount-input-id="${fee.amountInputId}"
                               class="fee-input-amount-popout"
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
     * Render table UI for display in popout
     * @param {Object} tableData - Table data with rows and column info
     * @param {Object} itemConfig - Table item configuration (columns, dynamic)
     * @returns {string} HTML string for table display
     */
    function renderTableUI(tableData, itemConfig) {
        if (!tableData || !tableData.rows) {
            return '<div class="table-empty">No data</div>';
        }

        const { rows, rowCount } = tableData;

        if (rowCount === 0) {
            return '<div class="table-empty">Empty table</div>';
        }

        // Build table header
        const headerHtml = itemConfig.columns
            .map(col => `<th>${col.name}</th>`)
            .join('');

        // Build table rows with editable inputs (same as on-page UI)
        const rowsHtml = rows.map((row, rowIndex) => {
            const cells = itemConfig.columns.map((col, colIndex) => {
                const value = row[`col${colIndex}`];
                let cellHtml = '';

                if (col.type === 'checkbox') {
                    cellHtml = `<input type="checkbox" class="table-cell-input-popout" data-row="${rowIndex}" data-col="${colIndex}" ${value ? 'checked' : ''} style="cursor: pointer; margin: 0;">`;
                } else if (col.type === 'select') {
                    cellHtml = `<input type="text" class="table-cell-input-popout" data-row="${rowIndex}" data-col="${colIndex}" value="${value || ''}" placeholder="—">`;
                } else if (col.type === 'label') {
                    const displayValue = value || '<span style="color: #cbd5e0; font-style: italic;">—</span>';
                    cellHtml = `<span style="font-size: 12px; padding: 6px 8px; display: block;">${displayValue}</span>`;
                } else {
                    cellHtml = `<input type="text" class="table-cell-input-popout" data-row="${rowIndex}" data-col="${colIndex}" value="${value || ''}" placeholder="—">`;
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

    function renderField(fieldData, policyNumber, viewMode, canGoBack) {
        viewMode = viewMode || 'single';
        canGoBack = canGoBack !== undefined ? canGoBack : false;
        const display = document.getElementById('next-field-display');
        if (!display) return;

        // Update policy number display
        updatePolicyNumber(policyNumber);

        if (!fieldData) {
            display.innerHTML = '<div class="completion-message">All fields checked!</div>';
            resizeWindow();
            return;
        }

        // Handle table type
        if (fieldData.type === 'table') {
            const tableHtml = renderTableUI(fieldData.tableData, { columns: fieldData.columns, dynamic: fieldData.dynamic });
            display.innerHTML = `
                <div class="step-title">${fieldData.name}</div>
                ${tableHtml}
                <div class="button-row">
                    <button id="back-button" class="back-btn" ${!canGoBack ? 'disabled' : ''}>← Back</button>
                    <button id="skip-button" class="skip-btn">Skip</button>
                    <button id="confirm-button" class="confirm-btn">✓ Confirm</button>
                </div>
            `;
            setupEventListeners(fieldData);

            // Attach listeners to popout table inputs
            attachPopoutTableInputListeners(fieldData);

            resizeWindow(true); // Pass true to indicate table type for wider window
            return;
        }

        // Handle custom type (fees table)
        if (fieldData.type === 'custom' && fieldData.feeRows) {
            const feesTableHtml = renderFeesTableUI(fieldData);
            display.innerHTML = `
                <div class="step-title">${fieldData.name}</div>
                ${feesTableHtml}
                <div class="button-row">
                    <button id="back-button" class="back-btn" ${!canGoBack ? 'disabled' : ''}>← Back</button>
                    <button id="skip-button" class="skip-btn">Skip</button>
                    <button id="confirm-button" class="confirm-btn">✓ Confirm</button>
                </div>
            `;
            setupEventListeners(fieldData);
            attachPopoutFeesTableListeners(); // Attach fees input listeners
            resizeWindowForFees(); // Use fixed sizing for fees table
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
                <button id="back-button" class="back-btn" ${!canGoBack ? 'disabled' : ''}>← Back</button>
                <button id="skip-button" class="skip-btn">Skip</button>
                <button id="confirm-button" class="confirm-btn">✓ Confirm</button>
            </div>
        `;
        setupEventListeners(fieldData);

        // Initialize Kendo widgets after HTML is inserted
        renderKendoWidgetsPopout(display, fieldData);

        resizeWindow();
    }

    /**
     * Attach event listeners to popout fees table inputs
     */
    function attachPopoutFeesTableListeners() {
        const taxableInputs = document.querySelectorAll('.fee-input-taxable-popout');
        const amountInputs = document.querySelectorAll('.fee-input-amount-popout');

        // Attach listeners for taxable checkboxes
        taxableInputs.forEach(input => {
            input.addEventListener('change', () => {
                const checkboxId = input.getAttribute('data-taxable-checkbox-id');
                const feeIndex = input.getAttribute('data-fee-index');

                console.log('[Popout Fees] Taxable checkbox changed:', checkboxId, input.checked);

                // Send message to content script to update form
                if (port && isConnected) {
                    port.postMessage({
                        action: 'updateFeeTaxable',
                        checkboxId: checkboxId,
                        value: input.checked
                    });
                }
            });
        });

        // Attach listeners for amount inputs
        amountInputs.forEach(input => {
            input.addEventListener('blur', () => {
                const amountInputId = input.getAttribute('data-amount-input-id');
                const feeIndex = input.getAttribute('data-fee-index');

                console.log('[Popout Fees] Amount input changed:', amountInputId, input.value);

                // Send message to content script to update form
                if (port && isConnected) {
                    port.postMessage({
                        action: 'updateFeeAmount',
                        amountInputId: amountInputId,
                        value: input.value
                    });
                }
            });

            // Also handle Enter key
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
        });

        console.log('[Popout Fees] Attached listeners to', taxableInputs.length, 'taxable checkboxes and', amountInputs.length, 'amount inputs');
    }

    /**
     * Attach event listeners to popout table inputs
     */
    function attachPopoutTableInputListeners(fieldData) {
        const inputs = document.querySelectorAll('.table-cell-input-popout');

        inputs.forEach(input => {
            const rowIndex = parseInt(input.getAttribute('data-row'), 10);
            const colIndex = parseInt(input.getAttribute('data-col'), 10);
            const col = fieldData.columns[colIndex];

            if (!col) return;

            const eventType = (col.type === 'checkbox' || col.type === 'select') ? 'change' : 'input';

            input.addEventListener(eventType, () => {
                const newValue = input.type === 'checkbox' ? input.checked : input.value;

                // Update the table data in fieldData
                if (!fieldData.tableData.rows[rowIndex]) return;

                fieldData.tableData.rows[rowIndex][`col${colIndex}`] = newValue;

                // Send message to content script to update the actual form
                if (port && isConnected) {
                    port.postMessage({
                        action: 'updateTableCell',
                        index: currentIndex,
                        rowIndex: rowIndex,
                        colIndex: colIndex,
                        value: newValue
                    });
                }
            });
        });
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

    function resizeWindow(isTable = false) {
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
                const finalWidth = isTable ? 450 : 350; // Wider for tables, min 330 for back button

                logger.debug(, {
                    contentHeight,
                    scrollHeight,
                    displayRectHeight: displayRect.height,
                    paddingTop,
                    paddingBottom,
                    policyHeight,
                    neededHeight,
                    calculatedHeight,
                    finalHeight,
                    finalWidth,
                    isTable
                });
                ext.windows.update(window.id, {
                    width: finalWidth,
                    height: finalHeight
                });
            });
        }, 200);
    }

    function resizeWindowForFees() {
        // Fixed size for fees table to avoid resizing issues
        setTimeout(() => {
            ext.windows.getCurrent().then((window) => {
                const finalHeight = 650; // Fixed height as specified
                const finalWidth = 362;  // Fixed width as specified

                console.log('[Popout Resize - Fees] Using fixed dimensions:', {
                    finalHeight,
                    finalWidth
                });
                ext.windows.update(window.id, {
                    width: finalWidth,
                    height: finalHeight
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
        const backButton = document.getElementById('back-button');
        if (backButton && !backButton.disabled) {
            backButton.addEventListener('click', () => {
                if (port && isConnected) {
                    port.postMessage({ action: 'goBackToPreviousStep' });
                }
            });
        }

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
