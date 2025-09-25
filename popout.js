/*************************************************************************************************
 *  popout.js - The script for the popout window.
 *  This script is responsible for rendering the UI for the current checklist step and
 *  sending user actions (confirm, skip, update value) to the content script.
/*************************************************************************************************/

(function() {
    "use strict";

    let port = null;
    let currentIndex = -1;

    function init() {
        try {
            port = browser.runtime.connect({ name: "popout-port" });
            port.onMessage.addListener(handleMessage);
            port.onDisconnect.addListener(() => {
                displayError("Connection to the page was lost. Please refresh the page and try again.");
                port = null;
            });

            port.postMessage({ action: "popout-ready-ping" });

        } catch (error) {
            displayError("An unexpected error occurred while connecting.");
        }
    }

    function renderField(fieldData) {
        const display = document.getElementById('next-field-display');
        if (!display) return;

        if (!fieldData) {
            display.innerHTML = '<div class="completion-message">All fields checked!</div>';
            return;
        }

        let fieldsHtml = '';
        if (fieldData.type === 'group') {
            fieldsHtml = fieldData.fields.map((field, index) => {
                let inputHtml = '';
                switch (field.type) {
                    case 'select':
                        const options = field.options.map(opt => 
                            `<option value="${opt.value}" ${field.value === opt.value ? 'selected' : ''}>${opt.text}</option>`
                        ).join('');
                        inputHtml = `<select class="display-input" data-field-index="${index}">${options}</select>`;
                        break;
                    case 'checkbox':
                        inputHtml = `<input type="checkbox" class="display-input" data-field-index="${index}" ${field.value ? 'checked' : ''}>`;
                        break;
                    default:
                        inputHtml = `<input type="text" class="display-input" data-field-index="${index}" value="${field.value || ''}">`;
                        break;
                }
                return `<div class="field-group"><b>${field.name}</b>${inputHtml}</div>`;
            }).join('');
        } else if (fieldData.type === 'virtual') {
            fieldsHtml = `<p class="virtual-step">Please perform this action on the page.</p>`;
        }

        display.innerHTML = `
            <div id="display-content-wrapper">
              <div id="step-name">${fieldData.name}</div>
              <div id="display-content">
                ${fieldsHtml}
              </div>
              <div id="button-container">
                <button id="confirm-button">✓</button>
                <button id="skip-button">Skip</button>
              </div>
            </div>
        `;

        setupEventListeners(fieldData);
    }

    function displayError(message) {
        const display = document.getElementById('next-field-display');
        if (display) {
            display.innerHTML = `<div class="error-message">${message}</div>`;
        }
    }

    function setupEventListeners(fieldData) {
        document.getElementById('confirm-button').addEventListener('click', () => {
            if (port) port.postMessage({ action: 'confirmField', index: currentIndex });
        });

        document.getElementById('skip-button').addEventListener('click', () => {
            if (port) port.postMessage({ action: 'skipField', index: currentIndex });
        });

        if (fieldData.type === 'group') {
            document.querySelectorAll('.display-input').forEach(inputElement => {
                const fieldIndex = parseInt(inputElement.getAttribute('data-field-index'), 10);
                const field = fieldData.fields[fieldIndex];
                const eventType = (field.type === 'checkbox' || field.type === 'select') ? 'change' : 'input';

                inputElement.addEventListener(eventType, () => {
                    const value = (field.type === 'checkbox') ? inputElement.checked : inputElement.value;
                    if (port) {
                        port.postMessage({ 
                            action: 'updateFieldValue', 
                            index: currentIndex, 
                            fieldIndex: fieldIndex,
                            value: value,
                            fromPopout: true 
                        });
                    }
                });

                if (fieldIndex === 0) {
                    inputElement.focus();
                    if (field.type === 'text' && inputElement.value) {
                        inputElement.select();
                    }
                }
            });
        }
    }

    function handleMessage(message) {
        if (message.action === 'content-script-ready') {
            requestNextField();
            return;
        }

        try {
            if (message.action === 'updateDisplay') {
                currentIndex = message.index;
                renderField(message.fieldData);
            } else {
            }
        } catch (error) {
            displayError("An error occurred while rendering the checklist step.");
        }
    }

    function requestNextField() {
        if (port) {
            port.postMessage({ action: 'getNextField' });
        } else {
            displayError("Cannot request field: connection not established.");
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
