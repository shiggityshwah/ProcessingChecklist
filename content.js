/*************************************************************************************************
 *  content.js - The main content script for the Processing Checklist extension.
/*************************************************************************************************/
(function() {
    "use strict";
    const LOG_PREFIX = "[ProcessingChecklist]";
    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    let port = null;
    let currentIndex = -1;

    const checklist = [
        { name: "Policy Number", fields: [{ name: "Policy Number", selector: "#PolicyNumber", type: "text" }], type: "group", processed: false, skipped: false },
        { name: "Binder Checkbox", fields: [{ name: "Binder Checkbox", selector: "#IncludesBinder", type: "checkbox" }], type: "group", processed: false, skipped: false },
        { name: "Link/Check Previous Policy", selector: "#btnCopyOrLinkPolicy", type: "virtual", processed: false, skipped: false },
        { name: "Named Insured", type: "group", processed: false, skipped: false, fields: [{ name: "Primary Insured", selector: "#PrimaryInsuredName", type: "text" }, { name: "Secondary Insured", selector: "#SecondaryInsuredName", type: "text" }, { name: "DBA Name", selector: "#InsuredDbaName", type: "text" }] },
        { name: "NAICS Code", fields: [{ name: "NAICS Code", selector: "#NaicsCode_input", type: "text" }], type: "group", processed: false, skipped: false },
        { name: "Insured Address", type: "group", processed: false, skipped: false, fields: [{ name: "Address Line 1", selector: "#Address1", type: "text" }, { name: "Address Line 2", selector: "#Address2", type: "text" }, { name: "City", selector: "#cityInput", type: "text" }, { name: "State", selector: "#State", type: "select" }, { name: "ZIP", selector: "#zipCodeInput", type: "text" }, { name: "Country", selector: "#Country", type: "select" }] },
        { name: "Location of Risk", type: "group", processed: false, skipped: false, fields: [{ name: "Same as Insured Address", selector: "#SameAddress", type: "checkbox" }, { name: "Various locations", selector: "#VariousLocations", type: "checkbox" }, { name: "Address Line 1", selector: "#RiskAddress1", type: "text" }, { name: "Address Line 2", selector: "#RiskAddress2", type: "text" }, { name: "City", selector: "#RiskCity", type: "text" }, { name: "State", selector: "#RiskState", type: "select" }, { name: "ZIP", selector: "#RiskZip", type: "text" }, { name: "Country", selector: "#RiskCountry", type: "select" }] },
    ];

    function connect() {
        try {
            port = ext.runtime.connect({ name: "content-script" });
            console.log(LOG_PREFIX, "Connecting to background script.");
            port.onMessage.addListener(handleMessage);
            port.onDisconnect.addListener(() => {
                console.error(LOG_PREFIX, "Disconnected from background.");
                port = null;
            });
        } catch (e) { console.error(LOG_PREFIX, "Connection failed:", e); }
    }

    function init() {
        console.log(LOG_PREFIX, "Initialized.");
        connect();
        injectConfirmationCheckboxes();
        attachListenersToPageElements();
        updateAndBroadcast();
    }

    function broadcastUpdate() {
        if (!port) return;
        const nextIndex = findNextStep();
        const fieldData = getFieldData(nextIndex);
        port.postMessage({ action: 'updateDisplay', fieldData: fieldData, index: nextIndex });
        console.log(LOG_PREFIX, "Broadcasted update.");
    }

    function findNextStep() {
        const startIndex = currentIndex === -1 ? 0 : currentIndex;
        for (let i = 0; i < checklist.length; i++) {
            const index = (startIndex + i) % checklist.length;
            if (!checklist[index].processed && !checklist[index].skipped) return index;
        }
        return -1;
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
                    if (field.type === 'select') {
                        individualFieldData.value = element.value;
                        individualFieldData.options = Array.from(element.options).map(opt => ({ text: opt.text, value: opt.value }));
                    } else if (field.type === 'checkbox') {
                        individualFieldData.value = element.checked;
                    } else {
                        individualFieldData.value = element.value;
                    }
                } else { individualFieldData.name = `(Not Found) ${field.name}`; }
                return individualFieldData;
            });
        } else if (step.type === 'virtual') { fieldData.name = step.name; }
        return fieldData;
    }

    function updateAndBroadcast() {
        const nextIndex = findNextStep();
        const fieldData = getFieldData(nextIndex);

        // If step has changed, do a full re-render of on-page UI
        if (nextIndex !== currentIndex) {
            currentIndex = nextIndex;
            renderOnPageUI(fieldData);
        } else {
            // Otherwise, just update the values of the existing on-page UI
            updateOnPageUIValues(fieldData);
        }
        broadcastUpdate(); // Always broadcast to popout
    }

    function updateOnPageUIValues(fieldData) {
        if (!fieldData || !fieldData.fields) return;
        console.log(LOG_PREFIX, "Performing intelligent value update on on-page UI.");
        fieldData.fields.forEach((field, index) => {
            const inputElement = document.querySelector(`.on-page-input[data-field-index="${index}"]`);
            if (inputElement) {
                if (inputElement.type === 'checkbox') {
                    if (inputElement.checked !== field.value) inputElement.checked = field.value;
                } else {
                    if (inputElement.value !== field.value) inputElement.value = field.value;
                }
            }
        });
    }

    function renderOnPageUI(fieldData) {
        let container = document.getElementById('processing-checklist-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'processing-checklist-container';
            container.style.cssText = `position: fixed !important; bottom: 20px !important; right: 20px !important; z-index: 10000 !important; background: #fff !important; border: 2px solid #007cba !important; border-radius: 8px !important; padding: 15px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important; font-family: Arial, sans-serif !important; font-size: 14px !important; max-width: 300px !important; min-width: 250px !important;`;
            document.body.appendChild(container);
        }
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
                return `<label style="display: flex; align-items: center;"><input type="checkbox" class="on-page-input" data-field-index="${index}" ${field.value ? 'checked' : ''}> <span style="margin-left: 5px;">${field.name}</span></label>`;
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
            input.addEventListener(input.type === 'checkbox' || input.type === 'select-one' ? 'change' : 'input', () => {
                const value = input.type === 'checkbox' ? input.checked : input.value;
                handleUpdateFieldValue({ index: currentIndex, fieldIndex, value }, true);
            });
        });
    }

    function handleMessage(message) {
        console.log(LOG_PREFIX, "Received message:", message);
        switch (message.action) {
            case 'popout-ready': broadcastUpdate(); break;
            case 'updateFieldValue': handleUpdateFieldValue(message, false); break;
            case 'confirmField': handleConfirmField(message.index); break;
            case 'skipField': handleSkipField(message.index); break;
            case 'toggleUI': toggleOnPageUI(); break;
        }
    }

    function toggleOnPageUI() {
        const container = document.getElementById('processing-checklist-container');
        if (container) container.style.display = container.style.display === 'none' ? 'block' : 'none';
    }

    // fromOnPageUI is a boolean to prevent an infinite loop
    function handleUpdateFieldValue({ index, fieldIndex, value }, fromOnPageUI = false) {
        const field = checklist[index]?.fields[fieldIndex];
        if (!field || !field.selector) return;
        const element = document.querySelector(field.selector);
        if (element) {
            if (element.type === 'checkbox') element.checked = value; else element.value = value;
            // If the change came from the popout, update the on-page UI's value without re-rendering
            if (!fromOnPageUI) {
                const onPageInputElement = document.querySelector(`.on-page-input[data-field-index="${fieldIndex}"]`);
                if(onPageInputElement) onPageInputElement.value = value;
            }
            broadcastUpdate();
        }
    }

    function handleConfirmField(index) {
        if (index < 0 || index >= checklist.length) return;
        checklist[index].processed = true;
        checklist[index].skipped = false;
        updateOnPageCheckbox(index, true);
        updateAndBroadcast();
    }

    function handleSkipField(index) {
        if (index < 0 || index >= checklist.length) return;
        checklist[index].skipped = true;
        checklist[index].processed = false;
        updateAndBroadcast();
    }

    function unconfirmField(index) {
        if (index < 0 || index >= checklist.length) return;
        checklist[index].processed = false;
        checklist[index].skipped = false;
        updateOnPageCheckbox(index, false);
        currentIndex = index;
        updateAndBroadcast();
    }

    function attachListenersToPageElements() {
        console.log(LOG_PREFIX, "Attaching listeners to page elements.");
        checklist.forEach(step => {
            if (step.fields) {
                step.fields.forEach(field => {
                    const element = document.querySelector(field.selector);
                    if (element) {
                        const eventType = (element.type === 'checkbox' || element.type === 'select-one') ? 'change' : 'input';
                        element.addEventListener(eventType, () => {
                            console.log(LOG_PREFIX, `Detected change on page element: ${field.name}`);
                            updateAndBroadcast();
                        });
                    }
                });
            }
        });
    }

    function getElementForStep(index) {
        const step = checklist[index];
        if (!step) return null;
        const selector = step.selector || (step.fields && step.fields.length > 0 ? step.fields[0].selector : null);
        if (!selector) return null;
        return document.querySelector(selector)?.closest('.form-group, .details-row, .row') || null;
    }

    function injectConfirmationCheckboxes() {
        checklist.forEach((step, index) => {
            const container = getElementForStep(index);
            if (container && !document.getElementById(`checklist-confirm-cb-${index}`)) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `checklist-confirm-cb-${index}`;
                checkbox.style.cssText = `position: absolute; top: 5px; left: 5px; z-index: 1000; width: 18px; height: 18px; cursor: pointer;`;
                checkbox.addEventListener('change', () => { if (checkbox.checked) handleConfirmField(index); else unconfirmField(index); });
                if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative';
                container.insertBefore(checkbox, container.firstChild);
            }
        });
    }

    function updateOnPageCheckbox(index, isChecked) {
        const checkbox = document.getElementById(`checklist-confirm-cb-${index}`);
        if (checkbox) checkbox.checked = isChecked;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();