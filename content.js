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

    const RECONNECT_DELAY = 2000; // 2 seconds

    const checklist = [{ name: "Link/Check Previous Policy", selector: "#btnCopyOrLinkPolicy", type: "virtual" },
    { name: "Policy Number", fields: [{ name: "Policy Number", selector: "#PolicyNumber", type: "text" }], type: "group" },
    { name: "Binder Checkbox", fields: [{ name: "Binder Checkbox", selector: "#IncludesBinder", type: "checkbox" }], type: "group", container_selector: "#IncludesBinder", container_levels_up: 2 },
    
    { name: "Named Insured", type: "group", container_selector:"#PrimaryInsuredName", container_levels_up: 3, fields: [{ name: "Primary Insured", selector: "#PrimaryInsuredName", type: "text" }, { name: "Secondary Insured", selector: "#SecondaryInsuredName", type: "text" }, { name: "DBA Name", selector: "#InsuredDbaName", type: "text" }] },
    { name: "NAICS Code", fields: [{ name: "NAICS Code", selector: "#NaicsCode_input", type: "text" }], type: "group", container_selector: "#policyNAICSContainer", container_levels_up: 2 },
    { name: "Insured Address", type: "group", container_selector: "#Address1", container_levels_up: 3, fields: [{ name: "Address Line 1", selector: "#Address1", type: "text" }, { name: "Address Line 2", selector: "#Address2", type: "text" }, { name: "City", selector: "#cityInput", type: "text" }, { name: "State", selector: "#State", type: "select" }, { name: "ZIP", selector: "#zipCodeInput", type: "text" }, { name: "Country", selector: "#Country", type: "select" }] },
    { name: "Location of Risk", type: "group", container_selector: "#SameAddress", container_levels_up: 4, fields: [{ name: "Same as Insured Address", selector: "#SameAddress", type: "checkbox" }, { name: "Various locations", selector: "#VariousLocations", type: "checkbox" }, { name: "Address Line 1", selector: "#RiskAddress1", type: "text" }, { name: "Address Line 2", selector: "#RiskAddress2", type: "text" }, { name: "City", selector: "#RiskCity", type: "text" }, { name: "State", selector: "#RiskState", type: "select" }, { name: "ZIP", selector: "#RiskZip", type: "text" }, { name: "Country", selector: "#RiskCountry", type: "select" }] },
    { name: "Policy Notes and ECP/CI Checkbox", container_selector: "#NeedsSpecialHandling", container_levels_up: 4, fields: [{ name: "Exempt Commercial Purchaser", selector: "#IsExemptCommercialPurchaser", type: "checkbox" }], type: "group" },
    { name: "Transaction Type", fields: [{ name: "Transaction Type", selector: "#TransactionTypeId", type: "select" }], type: "group" },
    { name: "Late Explanation Provided", container_selector: "label[for='IsLate']", container_levels_up: 1, fields: [
        { name: "Late", selector: "label[for='IsLate']", type: "labelWithDivText", divSelector: "label[for='IsLate']" },
        { name: "Explanation Provided", selector: "#ExplanationProvided", type: "checkbox" }
    ], type: "group" },
    { name: "Checkboxes", fields: [{ name: "SL1 Included", selector: "#SL1Included", type: "checkbox" }, { name: "SL2 Included", selector: "#SL2Included", type: "checkbox" }, { name: "New SL2", selector: "#NewSL2", type: "checkbox" }, { name: "SL2 Addendum", selector: "#SL2Addendum", type: "checkbox" }, { name: "Multi-State", selector: "#IsMultiState", type: "checkbox" }, { name: "WC Policy", selector: "#WCPolicy", type: "checkbox" }], type: "group", container_selector: "#SL1Included", container_levels_up: 4 },
    { name: "Effective Date", container_selector: "#transactionEffectiveDate", container_levels_up: 4, fields:[{ name: "Effective Date", selector: "#transactionEffectiveDate", type: "text" }, { name: "Expiration Date", selector: "#transactionExpirationDate", type: "text" }, { name: "Open Ended", selector: "#IsOpenEnded", type: "checkbox" }], type: "group" },
        { name: "Invoice Date", fields: [{ name: "Invoice Date", selector: "#transactionInsurerInvoiceDate", type: "text" }], type: "group" },
        { name: "Insurer Details", container_selector: "#radSingleInsurer", container_levels_up: 4,fields: [{ name: "Single Insurer", selector: "#radSingleInsurer", type: "radio" }, { name: "Multiple Insurers", selector: "#radMultiInsurers", type: "radio" }, { name: "Include Prior Names", selector: "#IncludePriorNames", type: "checkbox" }, { name: "SLA Number Search", selector: "#SLANumber", type: "text" }, { name: "Insurer Search", selector: "#SingleSelectedInsurerId_input", type: "text" }], type: "group" },
        { name: "Coverage", fields: [], type: "custom", table_id: "coveragesTable", container_selector: "#coveragesTable" },
        { name: "Reason Code", fields: [{ name: "Reason Code", selector: "#ReasonCode", type: "select" }], type: "group", container_selector: "#ReasonsJson", container_levels_up:1},
        { name: "Fees", fields: [], type: "custom", table_id: "feesTable", container_selector: "div.col-md-7:has(> div.k-widget.k-grid)",  }
    ];

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
            uiState: `uiState_${myTabId}`
        };
    }

    function init() {
        isInitializing = true;
        connect();
        // Wait for tab ID from background script before initializing
    }

    function initializeWithTabId() {
        const keys = getStorageKeys();
        ext.storage.local.get([keys.checklistState, keys.uiState, 'defaultUIVisible'], (result) => {
            let storedState = result[keys.checklistState];
            let uiState = result[keys.uiState];

            if (!uiState) {
                // Use the defaultUIVisible setting, defaulting to true if not set
                const defaultVisible = result.defaultUIVisible !== false;
                uiState = { visible: defaultVisible };
                ext.storage.local.set({ [keys.uiState]: uiState });
            }

            if (!storedState || storedState.length !== checklist.length) {
                storedState = checklist.map(() => ({ processed: false, skipped: false }));
                ext.storage.local.set({ [keys.checklistState]: storedState }, () => {
                    injectConfirmationCheckboxes(storedState);
                    attachListenersToPageElements();
                    updateAndBroadcast(storedState, uiState);
                    setTimeout(() => {
                        isInitializing = false;
                    }, 500);
                });
            } else {
                injectConfirmationCheckboxes(storedState);
                attachListenersToPageElements();
                updateAndBroadcast(storedState, uiState);
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
                        ext.storage.local.get(keys.uiState, (result) => {
                            const state = changes[keys.checklistState].newValue;
                            updateAndBroadcast(state, result[keys.uiState]);
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
                    ext.storage.local.get(keys.checklistState, (result) => {
                        const checklistState = result[keys.checklistState];
                        const nextIndex = findNextStep(checklistState);
                        const fieldData = getFieldData(nextIndex);
                        renderOnPageUI(fieldData, checklistState, changes[keys.uiState].newValue);
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
        try {
            port.postMessage({ action: 'updateDisplay', fieldData: fieldData, index: nextIndex, policyNumber: policyNumber });
        } catch (e) {
            console.error(LOG_PREFIX, "Failed to broadcast update:", e);
            handleDisconnect();
        }
    }

    function getPolicyNumber() {
        const policyNumberElement = document.querySelector('#PolicyNumber');
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

    function updateAndBroadcast(state, uiState) {
        const nextIndex = findNextStep(state);
        const fieldData = getFieldData(nextIndex);
        if (nextIndex !== currentIndex) {
            currentIndex = nextIndex;
            renderOnPageUI(fieldData, state, uiState);
        } else {
            updateOnPageUIValues(fieldData);
        }
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

    function renderOnPageUI(fieldData, state, uiState) {
        let container = document.getElementById('processing-checklist-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'processing-checklist-container';
            container.style.cssText = `position: fixed !important; top: 20px !important; right: 20px !important; z-index: 10000 !important; background: #fff !important; border: 2px solid #007cba !important; border-radius: 8px !important; padding: 15px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important; font-family: Arial, sans-serif !important; font-size: 14px !important; max-width: 300px !important; min-width: 250px !important;`;
            document.body.appendChild(container);
        }
        container.style.display = uiState.visible ? 'block' : 'none';

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
            const container = getElementForStep(index);
            if (container) {
                container.classList.remove('skipped-item', 'confirmed-item');
                if (itemState.skipped) {
                    container.classList.add('skipped-item');
                } else if (itemState.processed) {
                    container.classList.add('confirmed-item');
                }
            }
            // Also update checkbox to match state
            const checkbox = document.getElementById(`checklist-confirm-cb-${index}`);
            if (checkbox && checkbox.checked !== itemState.processed) {
                checkbox.checked = itemState.processed;
            }
        });
        setTimeout(() => {
            isProgrammaticUpdate = false;
        }, 0);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();