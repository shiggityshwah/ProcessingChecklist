/*************************************************************************************************
 *  content.js - The main content script for the Processing Checklist extension.
 *  This script is responsible for interacting with the RAPID website, managing the checklist,
 *  and communicating with the popout window.
/*************************************************************************************************/
(function() {
    "use strict";
    const LOG_PREFIX = "[ProcessingChecklist]";
    try {
        let contentPort = null;
        let currentIndex = 0;
        const checklist = [
            { name: "Policy Number", fields: [{ name: "Policy Number", selector: "#PolicyNumber", type: "text" }], type: "group", processed: false, skipped: false },
            { name: "Binder Checkbox", fields: [{ name: "Binder Checkbox", selector: "#IncludesBinder", type: "checkbox" }], type: "group", processed: false, skipped: false },
            { name: "Link/Check Previous Policy", selector: "#btnCopyOrLinkPolicy", type: "virtual", processed: false, skipped: false },
            { 
                name: "Named Insured", 
                type: "group",
                processed: false, skipped: false,
                fields: [
                    { name: "Primary Insured", selector: "#PrimaryInsuredName", type: "text" },
                    { name: "Secondary Insured", selector: "#SecondaryInsuredName", type: "text" },
                    { name: "DBA Name", selector: "#InsuredDbaName", type: "text" }
                ]
            },
            { name: "NAICS Code", fields: [{ name: "NAICS Code", selector: "#NaicsCode_input", type: "text" }], type: "group", processed: false, skipped: false },
            { 
                name: "Insured Address", 
                type: "group",
                processed: false, skipped: false,
                fields: [
                    { name: "Address Line 1", selector: "#Address1", type: "text" },
                    { name: "Address Line 2", selector: "#Address2", type: "text" },
                    { name: "City", selector: "#cityInput", type: "text" },
                    { name: "State", selector: "#State", type: "select" },
                    { name: "ZIP", selector: "#zipCodeInput", type: "text" },
                    { name: "Country", selector: "#Country", type: "select" }
                ]
            },
            { 
                name: "Location of Risk", 
                type: "group",
                processed: false, skipped: false,
                fields: [
                    { name: "Same as Insured Address", selector: "#SameAddress", type: "checkbox" },
                    { name: "Various locations", selector: "#VariousLocations", type: "checkbox" },
                    { name: "Address Line 1", selector: "#RiskAddress1", type: "text" },
                    { name: "Address Line 2", selector: "#RiskAddress2", type: "text" },
                    { name: "City", selector: "#RiskCity", type: "text" },
                    { name: "State", selector: "#RiskState", type: "select" },
                    { name: "ZIP", selector: "#RiskZip", type: "text" },
                    { name: "Country", selector: "#RiskCountry", type: "select" }
                ]
            },
        ];

        // --- Core Logic ---

        function init() {
            console.log(LOG_PREFIX, "Content script initialized.");
            // Ensure DOM is ready before querying or injecting DOM elements.
            injectConfirmationCheckboxes();
            contentPort = browser.runtime.connect({ name: "content-script-port" });
            contentPort.onMessage.addListener(handleMessage);
            // Render the first unchecked field immediately so the on-page UI appears
            try {
                updateNextFieldDisplay();
            } catch (e) {
                console.error(LOG_PREFIX, "Failed to render initial checklist UI:", e);
            }
        }

        function getFieldData(index) {
            if (index === -1) return null;
            const step = checklist[index];
            console.log(LOG_PREFIX, `Getting data for step: ${step.name} at index ${index}`);

            const fieldData = { name: step.name, type: step.type, fields: [] };

            if (step.type === 'group') {
                fieldData.fields = step.fields.map(field => {
                    const element = document.querySelector(field.selector);
                    const individualFieldData = { name: field.name, type: field.type, value: '', options: [] };
                    if (element) {
                        switch (field.type) {
                            case 'select':
                                individualFieldData.value = element.value;
                                individualFieldData.options = Array.from(element.options).map(opt => ({ text: opt.text, value: opt.value }));
                                break;
                            case 'checkbox':
                                individualFieldData.value = element.checked;
                                break;
                            default:
                                individualFieldData.value = element.value;
                                break;
                        }
                    } else {
                        individualFieldData.name = `(Not Found) ${field.name}`;
                    }
                    return individualFieldData;
                });
            } else if (step.type === 'virtual') {
                 fieldData.name = step.name;
            }
            return fieldData;
        }

        function updateNextFieldDisplay() {
            const nextIndex = findNextStep();
            currentIndex = nextIndex;
            const fieldData = getFieldData(nextIndex);
            renderOnPageUI(fieldData);
            if (contentPort) {
                contentPort.postMessage({ action: 'updateDisplay', fieldData: fieldData, index: currentIndex });
            }
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

            let fieldsHtml = '';
            if (fieldData.type === 'group') {
                fieldsHtml = fieldData.fields.map((field, index) => {
                    let inputHtml = '';
                    switch (field.type) {
                        case 'select':
                            const options = field.options.map(opt => `<option value="${opt.value}" ${field.value === opt.value ? 'selected' : ''}>${opt.text}</option>`).join('');
                            inputHtml = `<select class="on-page-input" data-field-index="${index}" style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;">${options}</select>`;
                            break;
                        case 'checkbox':
                            inputHtml = `<label style="display: flex; align-items: center;"><input type="checkbox" class="on-page-input" data-field-index="${index}" ${field.value ? 'checked' : ''}> <span style="margin-left: 5px;">${field.name}</span></label>`;
                            return inputHtml;
                        default:
                            inputHtml = `<input type="text" class="on-page-input" data-field-index="${index}" value="${field.value || ''}" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">`;
                            break;
                    }
                    return `<div style="margin-bottom: 8px;"><label style="font-weight: bold; display: block; margin-bottom: 4px;">${field.name}</label>${inputHtml}</div>`;
                }).join('');
            } else {
                fieldsHtml = `<p style="color: #666; font-style: italic;">Please perform this action on the page.</p>`;
            }

            container.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 8px; color: #007cba;">${fieldData.name}</div>
                <div>${fieldsHtml}</div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;">
                    <button id="confirm-button-page" style="background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">✓</button>
                    <button id="skip-button-page" style="background: #6c757d; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Skip</button>
                </div>`;

            document.getElementById('confirm-button-page').addEventListener('click', () => handleConfirmField(currentIndex));
            document.getElementById('skip-button-page').addEventListener('click', () => handleSkipField(currentIndex));
            
            document.querySelectorAll('.on-page-input').forEach(input => {
                const fieldIndex = parseInt(input.getAttribute('data-field-index'), 10);
                const eventType = input.type === 'checkbox' || input.type === 'select-one' ? 'change' : 'input';
                input.addEventListener(eventType, () => {
                    const value = input.type === 'checkbox' ? input.checked : input.value;
                    handleUpdateFieldValue({ index: currentIndex, fieldIndex, value });
                });
            });
        }

        function handleMessage(message) {
            if (message.action === 'popout-ready-ping') {
                if(contentPort) contentPort.postMessage({ action: 'content-script-ready' });
                updateNextFieldDisplay(); // Initial load
                return;
            }

            switch (message.action) {
                case 'getNextField': updateNextFieldDisplay(); break;
                case 'updateFieldValue': handleUpdateFieldValue(message); break;
                case 'confirmField': handleConfirmField(message.index); break;
                case 'skipField': handleSkipField(message.index); break;
            }
        }

        function handleUpdateFieldValue({ index, fieldIndex, value }) {
            const field = checklist[index]?.fields[fieldIndex];
            if (!field || !field.selector) return;
            const element = document.querySelector(field.selector);
            if (element) {
                if (element.type === 'checkbox') element.checked = value;
                else element.value = value;
            }
        }

        function handleConfirmField(index) {
            if (index < 0 || index >= checklist.length) return;
            checklist[index].processed = true;
            checklist[index].skipped = false;
            updateOnPageCheckbox(index, true);
            updateNextFieldDisplay();
        }

        function handleSkipField(index) {
            if (index < 0 || index >= checklist.length) return;
            checklist[index].skipped = true;
            updateNextFieldDisplay();
        }

        function unconfirmField(index) {
            if (index < 0 || index >= checklist.length) return;
            checklist[index].processed = false;
            checklist[index].skipped = false;
            updateOnPageCheckbox(index, false);
            currentIndex = index;
            updateNextFieldDisplay();
        }

        function getElementForStep(index) {
            const step = checklist[index];
            if (!step) return null;
            const selector = step.selector || (step.fields && step.fields.length > 0 ? step.fields[0].selector : null);
            if (!selector) return null;
            const firstElement = document.querySelector(selector);
            return firstElement ? (firstElement.closest('.form-group, .details-row, .row') || firstElement.parentElement) : null;
        }

        function injectConfirmationCheckboxes() {
            checklist.forEach((step, index) => {
                const container = getElementForStep(index);
                if (container) {
                    const checkboxId = `checklist-confirm-cb-${index}`;
                    if (document.getElementById(checkboxId)) return;

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = checkboxId;
                    checkbox.style.cssText = `position: absolute; top: 5px; left: 5px; z-index: 1000; width: 18px; height: 18px; cursor: pointer;`;
                    
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) {
                            handleConfirmField(index);
                        } else {
                            unconfirmField(index);
                        }
                    });

                    if (window.getComputedStyle(container).position === 'static') {
                        container.style.position = 'relative';
                    }
                    container.insertBefore(checkbox, container.firstChild);
                }
            });
        }

        function updateOnPageCheckbox(index, isChecked) {
            const checkbox = document.getElementById(`checklist-confirm-cb-${index}`);
            if (checkbox) {
                checkbox.checked = isChecked;
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }

    } catch (e) {
        console.error(LOG_PREFIX, "A fatal error occurred:", e);
    }
})();
